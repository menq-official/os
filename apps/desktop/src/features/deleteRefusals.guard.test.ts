/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the "optimistic delete, swallowed refusal" class of defect.
 *
 * Six hard-delete commands are DENIED in the window capability set
 * (`src-tauri/capabilities/default.json`): delete_conversation, delete_knowledge,
 * delete_library_item, delete_research_item, delete_memory, delete_event. A refusal is
 * therefore the ORDINARY outcome, not an edge case.
 *
 * Several pages ended their delete chain in `.catch(() => s.reload())` — or had no
 * `.catch` at all — so the rejection was discarded, the row came straight back on the
 * reload, and the user was never told the store had refused. This test fails on any
 * delete call whose rejection handler discards the error, so the pattern cannot return.
 *
 * The scan covers every production `.tsx` under `features/` and `components/`, at any
 * depth. Test and spec files are left out: they are not pages.
 */
const sources = import.meta.glob(
  ['../{features,components}/**/*.tsx', '!**/*.test.tsx', '!**/*.spec.tsx'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

/** Every `desktop.deleteX(` call site, so each chain can be read on its own. */
const DELETE_CALL = /\.delete[A-Z][A-Za-z]*\(/g;

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/**
 * The same text with the inside of every string, template and comment blanked, so a `;`
 * or a bracket written in one is not read as code. Offsets are unchanged. A quoted string
 * is not followed past its line, which keeps a stray apostrophe in JSX text from blanking
 * the code after it.
 */
function codeOnly(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? src.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      const quote = src[i];
      let j = i + 1;
      while (j < src.length && src[j] !== quote && (quote === '`' || src[j] !== '\n')) {
        j += src[j] === '\\' ? 2 : 1;
      }
      if (src[j] === quote) blank(i + 1, j);
      i = src[j] === quote ? j + 1 : i + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * The argument of each `.catch(` that belongs to the chain starting at `start` — its own
 * method, not one inside a `.then` body and not one in a later statement. The chain ends at
 * the first `;` or `,` outside every bracket, or where the bracket it sits in closes.
 */
function ownCatchHandlers(code: string, start: number): string[] {
  const handlers: string[] = [];
  let depth = 0;
  let handlerFrom = -1;
  for (let i = start; i < code.length; i += 1) {
    const c = code[i];
    if (depth === 0 && (c === ';' || c === ',')) break;
    if (depth === 0 && code.startsWith('.catch(', i)) {
      handlerFrom = i + '.catch('.length;
      i = handlerFrom - 1;
      depth = 1;
    } else if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth < 0) break;
      if (depth === 0 && handlerFrom !== -1) {
        handlers.push(code.slice(handlerFrom, i));
        handlerFrom = -1;
      }
    }
  }
  return handlers;
}

const ARROW = /^(?:async\s+)?(?:\(\s*([A-Za-z_$][\w$]*)?\s*(?::[^)]*)?\)|([A-Za-z_$][\w$]*))\s*=>([\s\S]*)$/;

/** True when a `.catch` handler cannot have looked at the rejection it was handed. */
function ignoresRejection(handler: string): boolean {
  const arrow = ARROW.exec(handler.trim());
  // Not an arrow with a plain parameter list — `.catch(report)`, a destructuring parameter:
  // the rejection is passed on or taken apart, which is reading it.
  if (!arrow) return handler.trim() === '';
  const param = arrow[1] ?? arrow[2];
  if (!param) return true;
  const name = param.replace(/\$/g, '\\$');
  return !new RegExp(`(?<![\\w$.])${name}(?![\\w$])`).test(arrow[3]);
}

type Problem = 'no .catch' | '.catch() ignores the refusal';

/** What is wrong with each delete chain in one source text; empty when nothing is. */
function deleteChainProblems(src: string): Problem[] {
  const code = codeOnly(src);
  const problems: Problem[] = [];
  DELETE_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DELETE_CALL.exec(src)) !== null) {
    const handlers = ownCatchHandlers(code, m.index);
    if (handlers.length === 0) problems.push('no .catch');
    else if (ignoresRejection(handlers[0])) problems.push('.catch() ignores the refusal');
  }
  return problems;
}

describe('a refused delete is always surfaced, never swallowed', () => {
  it('discovers the production view sources, at any depth, and no test file', () => {
    const keys = Object.keys(sources);
    // A key is relative to this file, so a page beside it is `./Name.tsx`.
    expect(keys).toContain('./Memory.tsx');
    expect(keys).toContain('../components/charts/Chart.tsx');
    expect(keys.filter((k) => /\.(test|spec)\.tsx$/.test(k))).toEqual([]);
  });

  it('finds the delete chains the pages really have', () => {
    const withDelete = Object.entries(sources)
      .filter(([, src]) => src.search(DELETE_CALL) !== -1)
      .map(([path]) => basename(path))
      .sort();
    expect(withDelete).toEqual(['Automations.tsx', 'Knowledge.tsx', 'Library.tsx', 'Memory.tsx', 'Research.tsx']);
  });

  it('every delete chain has a rejection handler, and none discards its rejection', () => {
    const offenders: string[] = [];
    for (const [path, src] of Object.entries(sources)) {
      for (const problem of deleteChainProblems(src)) offenders.push(`${basename(path)}: ${problem}`);
    }
    expect(
      offenders,
      'Inspect the rejection and render it — the user must be able to read why nothing was deleted. ' +
        'A delete with no .catch leaves an unhandled rejection and a row that silently reappears',
    ).toEqual([]);
  });
});

describe('the scan sees the chains it is there to refuse', () => {
  const IGNORED = ['.catch() ignores the refusal'];
  const MISSING = ['no .catch'];

  it('accepts a handler that reads the rejection', () => {
    expect(deleteChainProblems('desktop.deleteMemory(id).then(() => s.reload()).catch((e: unknown) => show(e));')).toEqual([]);
    expect(deleteChainProblems('desktop.deleteMemory(id).catch(e => { setError(String(e)); s.reload(); });')).toEqual([]);
    expect(deleteChainProblems('desktop.deleteMemory(id).catch(report);')).toEqual([]);
    expect(deleteChainProblems('desktop\n  .deleteMemory(id)\n  .then(() => { a(); b(); })\n  .catch((e) => { show(e); })\n  .finally(() => done());')).toEqual([]);
  });

  it('refuses a handler that takes no argument', () => {
    expect(deleteChainProblems('desktop.deleteMemory(id).catch(() => s.reload());')).toEqual(IGNORED);
  });

  it('refuses it when the .then body holds a semicolon', () => {
    expect(
      deleteChainProblems('desktop.deleteMemory(id).then(() => { s.reload(); toast(1); }).catch(() => s.reload());'),
    ).toEqual(IGNORED);
  });

  it('refuses a handler that names the rejection and never reads it', () => {
    expect(deleteChainProblems('desktop.deleteMemory(id).catch((e) => {});')).toEqual(IGNORED);
    expect(deleteChainProblems('desktop.deleteMemory(id).catch((_e) => s.reload());')).toEqual(IGNORED);
    expect(deleteChainProblems('desktop.deleteMemory(id).catch((e: unknown) => { s.reload(); });')).toEqual(IGNORED);
    expect(deleteChainProblems('desktop.deleteMemory(id).catch(_ => s.reload());')).toEqual(IGNORED);
  });

  it('refuses a delete with no handler', () => {
    expect(deleteChainProblems('desktop.deleteMemory(id).then(() => s.reload());')).toEqual(MISSING);
  });

  it('does not take a later statement\'s .catch for the delete\'s own', () => {
    expect(
      deleteChainProblems('desktop.deleteMemory(id);\ndesktop.listMemory().catch((e) => show(e));'),
    ).toEqual(MISSING);
    expect(
      deleteChainProblems('const drop = () => { desktop.deleteMemory(id).then(done) };\nload().catch((e) => show(e));'),
    ).toEqual(MISSING);
  });

  it('does not take a .catch inside the .then body for the chain\'s own', () => {
    expect(
      deleteChainProblems('desktop.deleteMemory(id).then(() => { audit().catch((e) => log(e)); });'),
    ).toEqual(MISSING);
  });

  it('is not ended early by a semicolon or a bracket inside a string or a comment', () => {
    expect(
      deleteChainProblems("desktop.deleteMemory(id).then(() => toast('gone; done )')) // ok; really\n  .catch((e) => show(e));"),
    ).toEqual([]);
  });
});
