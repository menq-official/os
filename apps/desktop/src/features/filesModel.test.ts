import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { establishedContentSize, isGuardDenied, MAX_EDIT_BYTES, parseModified } from './filesModel';
import { parseTimestamp } from './timestamps';

// The production half of `src-tauri/src/files.rs` — everything above its test module. Vitest
// runs with the desktop package as its working directory.
const FILES_RS = readFileSync(resolve(process.cwd(), 'src-tauri/src/files.rs'), 'utf8').split('#[cfg(test)]')[0];

/** `const MAX_EDIT_BYTES: u64 = 2 * 1024 * 1024;` in files.rs, multiplied out. */
function rustMaxEditBytes(): number {
  const decl = /const MAX_EDIT_BYTES: u64 = ([0-9_ *]+);/.exec(FILES_RS);
  if (!decl) throw new Error('files.rs no longer declares MAX_EDIT_BYTES as a product of integers');
  return decl[1].split('*').reduce((acc, n) => acc * Number(n.replace(/_/g, '').trim()), 1);
}

/**
 * Every message a file command can put in its `Err`, read out of files.rs: a literal turned
 * into a `String` (`"…".to_string()`), the generic handed to `fs_err`, a `&str` constant, and
 * the one `format!`. `fs_err`'s `detail` and every `eprintln!` go to the log, not the caller.
 */
function rustErrStrings(): string[] {
  const found = new Set<string>();
  for (const shape of [
    /"([^"\n]*)"\.to_string\(\)/g,
    /fs_err\("([^"\n]*)"/g,
    /const [A-Z_]+: &str = "([^"\n]*)"/g,
    /Err\(format!\("([^"\n]*)"/g,
  ]) {
    for (const m of FILES_RS.matchAll(shape)) {
      found.add(m[1].replace('{MAX_EDIT_BYTES}', String(rustMaxEditBytes())));
    }
  }
  return [...found].sort();
}

// The Err strings the Rust file commands can return (src-tauri/src/files.rs). The first test
// below reads files.rs and fails when this table and the file disagree, so a backend wording
// change that the classifier silently stops matching shows up as a failing test rather than
// as a badge that quietly stops appearing.
const BACKEND_ERRORS = {
  filesRootNotAllowed: 'the configured files root is not allowed',
  workspaceNotConfigured: 'file workspace is not configured',
  workspaceUnavailable: 'file workspace is unavailable',
  pathRefused: 'path is not accessible in this workspace',
  cannotList: 'cannot list directory',
  cannotRead: 'cannot read file',
  cannotWrite: 'cannot write file',
  notEditable: 'not an editable file',
  fileReadOnly: 'the file is read-only',
  overEditLimit: `content exceeds the ${MAX_EDIT_BYTES}-byte edit limit`,
};

/** What `isGuardDenied` must answer for each of them. A new error needs a row here to compile. */
const IS_GUARD_DENIAL: Record<keyof typeof BACKEND_ERRORS, boolean> = {
  filesRootNotAllowed: true,
  workspaceNotConfigured: false,
  workspaceUnavailable: false,
  pathRefused: false,
  cannotList: false,
  cannotRead: false,
  cannotWrite: false,
  notEditable: false,
  fileReadOnly: false,
  overEditLimit: false,
};

describe('the Rust file commands and this module agree', () => {
  it('BACKEND_ERRORS is exactly the set of Err strings files.rs can return', () => {
    expect(Object.values(BACKEND_ERRORS).sort()).toEqual(rustErrStrings());
  });

  it('every one of them is classified the way the table says', () => {
    for (const key of Object.keys(BACKEND_ERRORS) as Array<keyof typeof BACKEND_ERRORS>) {
      expect(isGuardDenied(BACKEND_ERRORS[key]), key).toBe(IS_GUARD_DENIAL[key]);
    }
  });

  it('MAX_EDIT_BYTES is the edit cap files.rs enforces', () => {
    expect(MAX_EDIT_BYTES).toBe(rustMaxEditBytes());
  });
});

describe('parseModified', () => {
  it('parses the epoch-milliseconds text list_dir returns', () => {
    expect(parseModified('1700000000000')?.getTime()).toBe(1700000000000);
    expect(parseModified(' 1700000000000 ')?.getTime()).toBe(1700000000000);
  });

  it('returns null when the platform reported no time, or one that is not a time', () => {
    expect(parseModified(null)).toBeNull();
    expect(parseModified(undefined)).toBeNull();
    expect(parseModified('')).toBeNull();
    expect(parseModified('not a date')).toBeNull();
    expect(parseModified('Infinity')).toBeNull();
  });

  it('is the one backend-timestamp parser, so it reads whatever that reads', () => {
    for (const raw of ['1700000000000', '2026-08-07T14:44:11.166Z', 'not a date', '', null]) {
      expect(parseModified(raw)?.getTime()).toBe(parseTimestamp(raw)?.getTime());
    }
    expect(parseModified('2026-08-07T14:44:11.166Z')?.toISOString()).toBe('2026-08-07T14:44:11.166Z');
  });
});

describe('establishedContentSize', () => {
  it('does not report the read cap as the size of an over-cap file', () => {
    // files.rs reads `take(MAX_EDIT_BYTES + 1)` and reports `buf.len()`, so EVERY over-cap file
    // comes back as exactly this number. It used to be rendered as "2.0 MB" for a 40 MB file.
    expect(establishedContentSize({ readonly: true, sizeBytes: MAX_EDIT_BYTES + 1 })).toBeNull();
  });

  it('does not report the placeholder zero of a non-regular file', () => {
    expect(establishedContentSize({ readonly: true, sizeBytes: 0 })).toBeNull();
  });

  it('reports a size the read really measured', () => {
    expect(establishedContentSize({ readonly: false, sizeBytes: 128 })).toBe(128);
    // Binary: the whole file was read and failed the UTF-8 parse, so its length IS its size.
    expect(establishedContentSize({ readonly: true, sizeBytes: 4096 })).toBe(4096);
  });
});

describe('isGuardDenied', () => {
  it('classifies the files-root clamp as a guard denial', () => {
    expect(isGuardDenied(BACKEND_ERRORS.filesRootNotAllowed)).toBe(true);
  });

  it('does NOT claim a guard denial for the unified path refusal', () => {
    // files.rs returns ONE string for does-not-exist, cannot-canonicalize,
    // outside-the-root and denylisted, so that the renderer cannot use the
    // wording to probe whether an arbitrary absolute path exists. Because the
    // backend no longer establishes which of those happened, the page must not
    // announce `sealed` — a deleted file is not a refused one.
    expect(isGuardDenied(BACKEND_ERRORS.pathRefused)).toBe(false);
  });

  it('does not classify availability / transport failures as guard denials', () => {
    for (const key of [
      'workspaceNotConfigured',
      'workspaceUnavailable',
      'cannotList',
      'cannotRead',
      'cannotWrite',
      'notEditable',
    ] as const) {
      expect(isGuardDenied(BACKEND_ERRORS[key])).toBe(false);
    }
  });
});

// `features/timestamps.ts` — the one parser for the timestamps the backend writes. It is tested
// here, beside `parseModified`'s module, rather than in a file of its own: `counted-claims.json`
// recounts the test FILES on every run, and a parser of seven lines does not need a new one.
describe('parseTimestamp — the backend writes epoch-milliseconds as text', () => {
  it('parses the exact shape brops_core::now() returns', () => {
    // `new Date("1700000000000")` is Invalid Date; that is the defect the module exists for.
    expect(Number.isNaN(new Date('1700000000000').getTime())).toBe(true);
    expect(parseTimestamp('1700000000000')?.getTime()).toBe(1700000000000);
  });

  it('parses a numeric epoch and an ISO string', () => {
    expect(parseTimestamp(1700000000000)?.getTime()).toBe(1700000000000);
    expect(parseTimestamp('2026-08-07T14:44:11.166Z')?.toISOString()).toBe('2026-08-07T14:44:11.166Z');
  });

  it('returns null for an absent, blank or unparseable value', () => {
    expect(parseTimestamp(null)).toBeNull();
    expect(parseTimestamp(undefined)).toBeNull();
    expect(parseTimestamp('')).toBeNull();
    expect(parseTimestamp('   ')).toBeNull();
    expect(parseTimestamp('not a date')).toBeNull();
  });
});
