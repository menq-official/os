import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FORBIDDEN_COMMAND_PREFIX, classifyDeleteRefusal, isPolicyRefusal,
} from './researchLibraryDeleteRefusal';

// What `commands::forbidden_hard_delete` returns, and what Tauri's ACL says before it.
const HANDLER = 'forbidden_command:delete_library_item: nothing was deleted.';
const ACL = 'delete_library_item not allowed. Permissions associated with this command: ';

describe('isPolicyRefusal — only the two refusals the walls produce for THIS command', () => {
  it('recognises the handler refusal and the ACL refusal', () => {
    expect(isPolicyRefusal(HANDLER, 'delete_library_item')).toBe(true);
    expect(isPolicyRefusal(ACL, 'delete_library_item')).toBe(true);
  });

  it('does not take another command\'s handler refusal for this one', () => {
    const other = 'forbidden_command:delete_research_item: nothing was deleted.';
    expect(isPolicyRefusal(other, 'delete_library_item')).toBe(false);
  });

  it('does not take the prefix in the middle of an unrelated message for a refusal', () => {
    const quoted = 'store error while logging "forbidden_command:delete_library_item:" — disk full';
    expect(isPolicyRefusal(quoted, 'delete_library_item')).toBe(false);
  });

  it('does not promote a bare "denied" or "forbidden" to a permanent verdict', () => {
    // An OS error that names the command is a failure that may well be transient.
    expect(isPolicyRefusal('delete_library_item: permission denied (os error 13)', 'delete_library_item')).toBe(false);
    expect(isPolicyRefusal('delete_library_item: 403 forbidden by upstream proxy', 'delete_library_item')).toBe(false);
    expect(classifyDeleteRefusal('delete_library_item: permission denied (os error 13)', 'delete_library_item', true).kind)
      .toBe('unknown');
  });
});

describe('the prefix is the one the handler writes', () => {
  // The prefix is spelled twice, here and in `commands.rs`, and the tests on each side used
  // their own side's spelling: rename it in Rust and a real handler refusal stops classifying
  // as policy with every test green. So the Rust source is read.
  const rust = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/src/commands.rs'), 'utf8');

  it('FORBIDDEN_COMMAND_PREFIX equals the Rust constant of the same name', () => {
    const declared = [...rust.matchAll(/pub const FORBIDDEN_COMMAND_PREFIX: &str = "([^"]*)";/g)];
    expect(declared.map((m) => m[1])).toEqual([FORBIDDEN_COMMAND_PREFIX]);
  });

  it('the handler writes `<prefix>:<command>:`, the shape isPolicyRefusal matches', () => {
    expect(rust).toContain('"{FORBIDDEN_COMMAND_PREFIX}:{command}: nothing was deleted.');
    expect(isPolicyRefusal(`${FORBIDDEN_COMMAND_PREFIX}:delete_memory: nothing was deleted.`, 'delete_memory'))
      .toBe(true);
  });
});
