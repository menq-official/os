import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Two honesty defects lived on this page:
//
//   * A "Verifiable memory" pill rendered UNCONDITIONALLY in the header. Nothing
//     verifies a memory row — `list_memory` returns plain local SQLite rows with no
//     signature or receipt behind them, and the one thing every write does append, the
//     unsigned local write-record chain described further down, is not read by that
//     command — so the badge claimed more than the backend can prove, in every state
//     including a failed read.
//   * `delete_memory` (DENIED in the window capability set) and `set_memory_pinned`
//     both ended in `.catch(() => s.reload())`: the refusal vanished, the row came
//     straight back on the reload, and the user was told nothing.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Memory } from './Memory';
import { STR as MEM_STR } from './Memory.strings';
import { STR as KB_STR } from './Knowledge.strings';
import { STR as LIB_STR } from './Library.strings';
import { FORBIDDEN as SHARED_FORBIDDEN } from './writeRecord.vocabulary';

const ENTRY = {
  id: 'm-1',
  scope: 'user',
  kind: 'fact',
  content: 'Rotate the API key monthly',
  pinned: false,
  createdAt: '1700000000000',
  updatedAt: '1700000000000',
};

const DENIAL = 'delete_memory not allowed. Permissions associated with this command: ';

/** What the HANDLER returns if the ACL ever let the call through (`forbidden_hard_delete`). */
const HANDLER_REFUSAL = 'forbidden_command:delete_memory: nothing was deleted.';

function setup(opts: {
  listFails?: boolean; listPending?: boolean; deleteRefuses?: boolean; pinRefuses?: boolean;
  deleteOutcome?: 'handler' | 'broken' | 'pending';
} = {}) {
  const store = [ENTRY];
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_memory') {
      if (opts.listPending) return new Promise(() => {});
      return opts.listFails
        ? Promise.reject(new Error('store_unavailable'))
        : Promise.resolve([...store]);
    }
    if (cmd === 'delete_memory') {
      if (opts.deleteRefuses) return Promise.reject(new Error(DENIAL));
      if (opts.deleteOutcome === 'handler') return Promise.reject(new Error(HANDLER_REFUSAL));
      if (opts.deleteOutcome === 'broken') return Promise.reject(new Error('database is locked'));
      if (opts.deleteOutcome === 'pending') return new Promise(() => {});
      store.length = 0;
      return Promise.resolve(null);
    }
    if (cmd === 'set_memory_pinned') {
      if (opts.pinRefuses) return Promise.reject(new Error('set_memory_pinned not allowed.'));
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Memory />
      </ToastProvider>
    </AppProvider>,
  );
}

/** The page's polite live region (what a screen-reader user is told). */
const liveText = () => document.querySelector('.v-memory > [role="status"][aria-live="polite"]')?.textContent ?? '';

async function selectTheEntry() {
  await waitFor(() => expect(screen.getAllByText(/Rotate the API key monthly/).length).toBeGreaterThan(0));
  fireEvent.click(screen.getAllByText(/Rotate the API key monthly/)[0]);
  await screen.findByRole('button', { name: 'Delete' });
}

async function confirmDeleteDialog() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  const dialog = await screen.findByRole('dialog');
  // The confirmation does not promise a delete the backend cannot perform.
  expect(dialog).toHaveTextContent(/Nothing will be removed/);
  expect(dialog).not.toHaveTextContent(/cannot be undone/i);
  const confirm = Array.from(dialog.querySelectorAll('button')).find(
    (b) => b.className.includes('danger'),
  );
  expect(confirm).toBeTruthy();
  fireEvent.click(confirm as HTMLButtonElement);
}

// Rendering a whole feature page under jsdom can exceed the 5s default on a loaded
// machine. The assertions below are about honesty, not speed — give them room so a
// slow environment cannot be mistaken for a regression.
vi.setConfig({ testTimeout: 30000 });

beforeEach(() => invokeMock.mockReset());

describe('Memory — nothing claims the memory is verifiable', () => {
  it('never renders the unbacked "Verifiable memory" pill on a loaded page', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText(/Rotate the API key monthly/).length).toBeGreaterThan(0));

    expect(screen.queryByText('Verifiable memory')).not.toBeInTheDocument();
    expect(screen.queryByText(/verifiable/i)).not.toBeInTheDocument();

    // What is shown instead is a real fact: the outcome of the one `list_memory` read,
    // plus a CURRENT statement of what backs the rows. That line used to read "no
    // verification chain"; every write now appends a local record, so the old sentence
    // became false — and a stale honest label is a dishonest one.
    expect(screen.getByText('Read from the store')).toBeInTheDocument();
    expect(screen.getByText(/each write appends a local record/i)).toBeInTheDocument();
    // It still refuses the stronger claim: content, never the writer.
    expect(screen.getByText(/never who wrote it/i)).toBeInTheDocument();
    // And the sentence that is no longer true is gone.
    expect(screen.queryByText(/no verification chain/i)).not.toBeInTheDocument();
  });

  it('never renders it when the store read FAILED either', async () => {
    setup({ listFails: true });
    await waitFor(() => expect(screen.getByText('Store unavailable')).toBeInTheDocument());
    expect(screen.queryByText(/verifiable/i)).not.toBeInTheDocument();
  });
});

describe('Memory — a REFUSED delete is surfaced, never swallowed', () => {
  it('keeps the entry, shows the refusal with its reason, and says nothing was removed', async () => {
    setup({ deleteRefuses: true });
    await selectTheEntry();
    await confirmDeleteDialog();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Delete refused — nothing was removed');
    expect(alert).toHaveTextContent(/still in the store/i);
    expect(alert).toHaveTextContent(/delete_memory not allowed/);

    // The row is provably still listed.
    expect(screen.getAllByText(/Rotate the API key monthly/).length).toBeGreaterThan(0);
    // And the live region announced the refusal rather than a count as if nothing happened.
    await waitFor(() => expect(liveText()).toMatch(/refused/i));
  });
});

describe('Memory — a REFUSED pin change is surfaced, never swallowed', () => {
  it('states that the pin state did not change', async () => {
    setup({ pinRefuses: true });
    await selectTheEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Pin change refused — nothing was changed');
    expect(alert).toHaveTextContent(/set_memory_pinned not allowed/);
    await waitFor(() => expect(liveText()).toMatch(/refused/i));
  });
});

// No backend in this tree can produce this outcome: `delete_memory` is denied by the window
// capability set and its handler returns `forbidden_hard_delete` unconditionally. The test pins
// the renderer's success arm for the day T-011 lands; it is not evidence a delete works today.
describe('Memory — an ACCEPTED delete reports the real outcome', () => {
  it('removes the entry and raises no refusal alert', async () => {
    setup();
    await selectTheEntry();
    await confirmDeleteDialog();

    await waitFor(() => expect(screen.queryByText(/Rotate the API key monthly/)).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// The page stored a refused delete as a bare string and showed every refusal the same way, while
// Library and Research put the same refusal through `classifyDeleteRefusal` and say when it is a
// standing one. The entry comes back after a refusal; without that sentence the row reads as
// "press Delete again".
describe('Memory — a policy refusal of a delete is named as permanent; an unknown failure is not', () => {
  const PERMANENT = /standing policy refusal.*retrying cannot succeed/i;
  const refuseWith = async (opts: Parameters<typeof setup>[0]) => {
    setup(opts);
    await selectTheEntry();
    await confirmDeleteDialog();
    return screen.findByRole('alert');
  };

  it('the capability wall\'s refusal is a standing one', async () => {
    expect(await refuseWith({ deleteRefuses: true })).toHaveTextContent(PERMANENT);
  });

  it('so is the handler\'s own `forbidden_command:` refusal', async () => {
    const alert = await refuseWith({ deleteOutcome: 'handler' });
    expect(alert).toHaveTextContent(PERMANENT);
    expect(alert).toHaveTextContent(/forbidden_command:delete_memory/);
  });

  it('a failure the page cannot classify is NOT called permanent', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      const alert = await refuseWith({ deleteOutcome: 'broken' });
      expect(alert).toHaveTextContent('database is locked');
      expect(alert).toHaveTextContent(/The backend rejected this delete/);
      expect(alert).not.toHaveTextContent(PERMANENT);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('with no desktop backend at all, no backend is said to have rejected anything', async () => {
    const alert = await refuseWith({ deleteOutcome: 'broken' });
    expect(alert).toHaveTextContent('Delete refused — nothing was removed');
    expect(alert).toHaveTextContent('database is locked');
    expect(alert).not.toHaveTextContent(/backend rejected/i);
    expect(alert).not.toHaveTextContent(PERMANENT);
  });

  it('a refused PIN change is never called a standing refusal — that command is granted', async () => {
    setup({ pinRefuses: true });
    await selectTheEntry();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent(PERMANENT);
  });
});

// The header pill's three states, the refusal title, the standing-refusal sentence, the busy
// label and "counted from the store" are written once in this page's catalog, once in Knowledge's
// and — the delete three — once in Library's. They are still separate copies: one shared module
// would be a new file, and importing another page's catalog makes that page's whole catalog part
// of this route's download (measured: the bundle budget went RED for Library and Memory). What
// the copies may not do is disagree, which "counted from the store" already did in Armenian and
// Russian — so every repeated entry is held to the same words in all three languages.
describe('Memory — wording repeated across the Memory, Knowledge and Library catalogs reads the same', () => {
  it.each([
    ['storeReading', MEM_STR.storeReading, KB_STR.recallReading],
    ['storeUnavailable', MEM_STR.storeUnavailable, KB_STR.recallUnavailable],
    ['storeLoaded', MEM_STR.storeLoaded, KB_STR.recallLoaded],
    ['countedStore', MEM_STR.countedStore, KB_STR.countedFromStore],
    ['deleteRefusedTitle', MEM_STR.deleteRefusedTitle, KB_STR.deleteRefusedTitle],
    ['deleteRefusedPermanent', MEM_STR.deleteRefusedPermanent, KB_STR.deleteRefusedPermanent],
    ['deleting', MEM_STR.deleting, KB_STR.deleting],
    ['Library deleteRefusedTitle', LIB_STR.deleteRefusedTitle, KB_STR.deleteRefusedTitle],
    ['Library deleteRefusedPermanent', LIB_STR.deleteRefusedPermanent, KB_STR.deleteRefusedPermanent],
    ['Library deleting', LIB_STR.deleting, KB_STR.deleting],
  ] as const)('%s', (_name, here, there) => {
    expect(here).toEqual(there);
    expect(Object.keys(here).sort()).toEqual(['en', 'hy', 'ru']);
  });

  it('the header pill reads "Reading the store…" until the one read answers', async () => {
    setup({ listPending: true });
    expect(await screen.findByText('Reading the store…')).toBeInTheDocument();
    expect(document.querySelector('.pageHead .pill')!.textContent).toBe('Reading the store…');
  });

  it('the confirm button reads "Deleting…" while the delete is in flight', async () => {
    setup({ deleteOutcome: 'pending' });
    await selectTheEntry();
    await confirmDeleteDialog();
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Deleting…'));
  });

  it('"counted from the store" is the Knowledge page\'s sentence in Armenian too', async () => {
    localStorage.setItem('brops.lang', JSON.stringify('hy'));
    try {
      setup();
      await waitFor(() => expect(screen.getAllByText(/Rotate the API key monthly/).length).toBeGreaterThan(0));
      const note = document.querySelector('.mem-metrics .sec-head .note')!;
      expect(note.textContent).toMatch(/^պահոցից հաշված · /);
      expect(note.textContent).not.toMatch(/store-ից/);
    } finally {
      localStorage.removeItem('brops.lang');
    }
  });
});

// `.mem-sr-only` was a page-local copy of the shared visually-hidden rule (`.sr-only`,
// components/ui.css). One rule, one name: the page uses the shared class and ships no copy.
describe('Memory — the live region uses the shared visually-hidden class', () => {
  it('is a polite status classed `sr-only`, and the page declares no `.mem-sr-only`', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText(/Rotate the API key monthly/).length).toBeGreaterThan(0));
    const live = document.querySelector('.v-memory > [role="status"][aria-live="polite"]')!;
    expect(live).not.toBeNull();
    expect(live.classList.contains('sr-only')).toBe(true);
    expect(live.textContent).toBe('1 of 1 memories.');
    expect(document.querySelector('.v-memory > style')!.textContent).not.toMatch(/\.mem-sr-only\b/);
    expect(document.querySelector('.mem-sr-only')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The equivalent of `Knowledge.honesty.test.tsx`'s vocabulary guard, for Memory —
// now that this page renders the LOCAL WRITE RECORD.
//
// The record is real: every memory write appends it in the same transaction as the row,
// hashing the content into a DB-enforced append-only chain. It is also UNSIGNED — no
// key, no manifest, no authority, no containment — and it attests CONTENT, never the
// writer. So the page may say "recorded" and it may say "content diverged", but it may
// never borrow the production trust vocabulary or a badge a reader would file next to a
// governed turn's.
// ---------------------------------------------------------------------------

const RECORD = {
  id: 'wr-1',
  seq: 1,
  subjectKind: 'memory_entry',
  subjectId: 'm-1',
  operation: 'created',
  contentSha256: 'a'.repeat(64),
  prevRecordSha256: '0'.repeat(64),
  recordSha256: 'b'.repeat(64),
  recordedAt: '1700000000000',
};

/** Every rendered word — direct text nodes plus tooltips — with `<style>` excluded so
 *  the assertion is about what a reader sees, not about CSS comments. */
function renderedText(): string {
  const parts: string[] = [];
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') continue;
    for (const n of Array.from(el.childNodes)) {
      if (n.nodeType === 3) parts.push(n.textContent ?? '');
    }
    const title = el.getAttribute('title');
    if (title) parts.push(title);
  }
  return parts.join(' ');
}

/** The vocabulary this page may never use — it belongs to the signed governed-receipt path, and
 *  nothing on this page has custody of anything.
 *
 *  The list is `writeRecord.vocabulary.ts`'s, shared with `writeRecord.test.tsx` and the other
 *  page guard. The nine English patterns are ALSO spelled out here, and that is deliberate:
 *  `tools/test_check_source_control_bytes.py` pins their literal text in this file (they once
 *  read `/<0x08>word<0x08>/i` and matched nothing). They are a subset of the shared list, so
 *  this guard can be no narrower than it — which is what the three drifting copies were. */
const FORBIDDEN: readonly RegExp[] = [
  /verifiable/i,
  /\bverified\b/i,
  /trusted[ _-]?verified/i,
  /\btrusted\b/i,
  /\bsigned\b/i,
  /governed receipt/i,
  /\breceipt\b/i,
  /\bcustody\b/i,
  /tamper[ -]?proof/i,
  ...SHARED_FORBIDDEN,
];

function setupWithRecord(state: unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_memory') return Promise.resolve([{ ...ENTRY }]);
    if (cmd === 'memory_write_record_state') return Promise.resolve(state);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Memory />
      </ToastProvider>
    </AppProvider>,
  );
}

describe('Memory — the write record never borrows the receipt vocabulary', () => {
  it('says "recorded" and nothing stronger for a row that matches its record', async () => {
    setupWithRecord({ state: 'recorded', record: RECORD });
    await waitFor(() => expect(screen.getAllByText('Recorded').length).toBeGreaterThan(0));
    // The full statement lives in the recall rail, so open the row it describes.
    await selectTheEntry();

    const text = renderedText();
    for (const forbidden of FORBIDDEN) {
      expect(text, `rendered text must not contain ${forbidden}`).not.toMatch(forbidden);
    }
    // The ceiling is stated on the surface itself, not just in a comment.
    expect(screen.getAllByText(/nothing outside this machine vouches for it/i).length)
      .toBeGreaterThan(0);
  });

  it('stays inside the vocabulary on the loudest state too', async () => {
    setupWithRecord({
      state: 'content_diverged',
      record: RECORD,
      actual_content_sha256: 'c'.repeat(64),
    });
    await waitFor(() => expect(screen.getAllByText('Content diverged').length).toBeGreaterThan(0));

    const text = renderedText();
    for (const forbidden of FORBIDDEN) {
      expect(text, `rendered text must not contain ${forbidden}`).not.toMatch(forbidden);
    }
  });
});

// A `[[link]]` that matched no other memory was returned `sealed: true` and drawn under
// "References sealed evidence … The referenced material stays sealed". There is no sealed
// evidence store for a memory entry. And the match ran over raw content, so two memories that
// both contained `[[runbook]]` resolved to each other — the link's own text was the match.
describe('Memory — a link that resolves to nothing is unresolved, not sealed', () => {
  const entry = (id: string, content: string, scope = 'user') => ({ ...ENTRY, id, scope, content });

  function mount(entries: unknown[]) {
    invokeMock.mockImplementation((cmd: string) =>
      Promise.resolve(cmd === 'list_memory' ? entries : null));
    return render(<AppProvider><ToastProvider><Memory /></ToastProvider></AppProvider>);
  }
  const open = async (text: RegExp) => {
    await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText(text)[0]);
    await screen.findByRole('button', { name: 'Delete' });
  };

  it('two memories that both mention [[runbook]] do not resolve to each other', async () => {
    mount([
      entry('m-1', 'Alpha note, see [[runbook]] for steps'),
      entry('m-2', 'Beta note, also [[runbook]] here'),
    ]);
    await open(/Alpha note/);

    const detail = document.querySelector('.mr-detail') as HTMLElement;
    // Not a jump target: nothing but the link's own text matched.
    expect(detail.querySelector('.mem-link--resolved')).toBeNull();
    expect(detail.querySelector('.mem-link--unresolved')?.textContent).toMatch(/\[\[runbook\]\].*unresolved/);
    // And not sealed evidence.
    expect(detail.querySelector('.mem-blocked')).toBeNull();
    expect(detail.querySelector('.mem-link--sealed')).toBeNull();
    expect(detail.textContent).not.toMatch(/sealed/i);
  });

  it('a link another memory really answers still resolves', async () => {
    mount([
      entry('m-1', 'Alpha note, see [[runbook]] for steps'),
      entry('m-2', 'The runbook lives in the wiki'),
    ]);
    await open(/Alpha note/);
    const detail = document.querySelector('.mr-detail') as HTMLElement;
    expect(detail.querySelector('.mem-link--resolved')?.textContent).toBe('[[runbook]]');
  });

  it('only a link written [[sealed:…]] is called sealed, and the copy claims no sealed store', async () => {
    mount([entry('m-1', 'Gamma note, see [[sealed:vault-7]]')]);
    await open(/Gamma note/);
    const detail = document.querySelector('.mr-detail') as HTMLElement;
    const panel = detail.querySelector('.mem-blocked') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toMatch(/References marked sealed/);
    expect(panel.textContent).toMatch(/holds nothing behind it/);
    expect(panel.textContent).not.toMatch(/stays sealed/);
  });
});
