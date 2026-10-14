import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mock the Tauri IPC boundary. Security mirrors engine truth: it reads a real
// summary (get_security_summary) and the real evidence chain (read_evidence_chain),
// and — crucially — it has NO chain-read authority of its own, so it must NEVER
// render a fabricated "verified" posture. The evidence-chain read is unreachable in
// the Phase-2 steady state; the honest integrity is "unverified".
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Security } from './Security';
import { STR as SEC_STR } from './Security.strings';

function setup() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_security_summary')
      return Promise.resolve({ pendingApprovals: 2, decidedApprovals: 5, auditEvents: 10, sensitiveEvents: [] });
    if (cmd === 'read_evidence_chain') return Promise.reject(new Error('broker_unavailable'));
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Security />
      </ToastProvider>
    </AppProvider>,
  );
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Security — mirrors engine truth, never fabricates a verified chain', () => {
  it('reads the real summary + evidence chain and shows an honest UNVERIFIED integrity', async () => {
    setup();
    // The desktop has no chain-read authority: steady state is "Integrity unverified",
    // never a fabricated SECURE/verified posture.
    await waitFor(() => expect(screen.getAllByText('Integrity unverified').length).toBeGreaterThan(0));
    expect(called('get_security_summary')).toBe(true);
    expect(called('read_evidence_chain')).toBe(true);
  });
});

// §D: "Motion: integrity pulse (`sigbreathe`)". The pulse is bound to state — it means
// "this surface is reading the chain right now", never "the chain is alive", which the
// desktop cannot establish (RECORDS_ARE_AUTHENTICATED is permanently false). These tests
// pin the binding in all three directions, because the failure that made them necessary
// was a page that argued for stillness in its comments and animated unconditionally in
// its stylesheet.
describe('Security — the integrity pulse is bound to state, not decorative', () => {
  const instrument = () => document.querySelector('.mani.sec-section');

  it('pulses while the chain read is IN FLIGHT — the one state with real liveness', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_security_summary')
        return Promise.resolve({ pendingApprovals: 0, decidedApprovals: 0, auditEvents: 0, sensitiveEvents: [] });
      if (cmd === 'read_evidence_chain') return new Promise(() => {});   // never settles
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Security /></ToastProvider></AppProvider>);
    await waitFor(() => expect(instrument()).toBeTruthy());
    expect(instrument()!.className).toContain('sec-int--checking');
    expect(instrument()!.className).toContain('sigbreathe');
  });

  // The in-flight pill read "Verifying…" on a page whose own rule is that this read can verify
  // nothing (`Integrity` has no `verified` value). It is a read, and the pill says so.
  it('the in-flight pill says the chain is being READ, in no language that it is being verified', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_security_summary')
        return Promise.resolve({ pendingApprovals: 0, decidedApprovals: 0, auditEvents: 0, sensitiveEvents: [] });
      if (cmd === 'read_evidence_chain') return new Promise(() => {});
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Security /></ToastProvider></AppProvider>);
    await waitFor(() => expect(instrument()?.className).toContain('sec-int--checking'));
    const pills = Array.from(document.querySelectorAll('.pageHead .right .pill, .mc-read .pill'))
      .map((el) => el.textContent);
    expect(pills).toEqual(['Reading…', 'Reading…']);
    expect(Object.keys(SEC_STR)).not.toContain('verifying');
    for (const lang of ['en', 'hy', 'ru'] as const) {
      // The pill is the short form of the detail line under it, word for word.
      const pill = (SEC_STR as Record<string, Record<string, string>>).reading?.[lang] ?? '';
      expect(pill, lang).toMatch(/…$/);
      expect(SEC_STR.readingChain[lang].startsWith(pill.replace(/…$/, '')), lang).toBe(true);
    }
  });

  it('is STILL once the read settles blocked — nothing is established, so nothing breathes', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Integrity unverified').length).toBeGreaterThan(0));
    expect(instrument()!.className).toContain('sec-int--blocked');
    expect(instrument()!.className).not.toContain('sigbreathe');
  });

  it('does NOT breathe on a chain-read failure — that is an alert, not liveness', async () => {
    // hasBackend() is what separates `broken` from `blocked`: a rejected read only means
    // the chain is broken when there was a backend to reject it.
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      setup();
      await waitFor(() => expect(instrument()?.className).toContain('sec-int--broken'));
      expect(instrument()!.className).not.toContain('sigbreathe');
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});

// The blocked detail was one sentence — "The read-only evidence-chain command is not wired into
// the desktop yet" — shown even after that command had answered. The command is registered, wrapped
// and called by this page; what it cannot do is authenticate what it mirrors.
describe('Security — the reason integrity is unconfirmed is the one the read returned', () => {
  function mountWithChain(chain: unknown, sensitiveEvents: unknown[] = []) {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_security_summary')
        return Promise.resolve({ pendingApprovals: 2, decidedApprovals: 5, auditEvents: 10, sensitiveEvents });
      if (cmd === 'read_evidence_chain') return Promise.resolve(chain);
      return Promise.resolve(null);
    });
    return render(<AppProvider><ToastProvider><Security /></ToastProvider></AppProvider>);
  }

  it('a read that ANSWERED says the records are unauthenticated — not that no command is wired', async () => {
    mountWithChain({ state: 'ok', surface: 'evidenceChain', records: [{ id: 'e-1' }], authenticated: false });
    await waitFor(() => expect(screen.getByText(/origin is not authenticated/i)).toBeInTheDocument());
    expect(screen.queryByText(/not wired/i)).not.toBeInTheDocument();
    // Still never a verified posture: an answer is not a confirmation.
    expect(screen.getAllByText('Integrity unverified').length).toBeGreaterThan(0);
  });

  it('a read the engine REFUSED says so', async () => {
    mountWithChain({ state: 'blocked', surface: 'evidenceChain', reason: 'engine_refused', authenticated: false });
    await waitFor(() => expect(screen.getByText(/engine refused the evidence-chain read/i)).toBeInTheDocument());
    expect(screen.queryByText(/not wired/i)).not.toBeInTheDocument();
  });

  it('the posture strip does not attribute local counts to the engine', async () => {
    setup();
    await waitFor(() => expect(screen.getByText(/local approvals and audit tables/i)).toBeInTheDocument());
    expect(screen.queryByText(/from the engine audit summary/i)).not.toBeInTheDocument();
  });

  it('a sensitive event shows a date, not the raw epoch-millisecond number', async () => {
    mountWithChain(
      { state: 'blocked', surface: 'evidenceChain', reason: 'x', authenticated: false },
      [{ id: 'ev-1', eventType: 'approval.granted', entityType: 'approval', entityId: 'a-1', createdAt: '1700000000000' }],
    );
    await waitFor(() => expect(screen.getByText('approval.granted')).toBeInTheDocument());
    const when = document.querySelector('.se-time') as HTMLElement;
    expect(when.textContent).not.toContain('1700000000000');
    expect(when.textContent).toMatch(/2023/);
  });
});

// R3-0263 / R3-0264: the reason the chain read gave was printed twice — once under a label
// that credited it to the engine even when the desktop wrote it and the engine was never
// reached, and once inside the control-plane DIGEST section, which reads nothing at all.
describe('Security — a read\'s reason is shown once, and not credited to the engine', () => {
  const mountChain = (chain: unknown) => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_security_summary')
        return Promise.resolve({ pendingApprovals: 0, decidedApprovals: 0, auditEvents: 0, sensitiveEvents: [] });
      if (cmd === 'read_evidence_chain') return Promise.resolve(chain);
      return Promise.resolve(null);
    });
    return render(<AppProvider><ToastProvider><Security /></ToastProvider></AppProvider>);
  };

  it('a reason the desktop wrote is labelled "Reason", never "Engine reason"', async () => {
    mountChain({ state: 'unreachable', surface: 'evidenceChain', reason: 'broker_unavailable', authenticated: false });
    await waitFor(() => expect(document.querySelector('.mc-reason')).not.toBeNull());
    expect(document.querySelector('.mc-reason')?.textContent).toBe('Reason: broker_unavailable');
    expect(document.body.textContent).not.toMatch(/Engine reason/);
  });

  it('the digest section does not print the evidence-chain read\'s reason as its own', async () => {
    mountChain({ state: 'unreachable', surface: 'evidenceChain', reason: 'broker_unavailable', authenticated: false });
    await waitFor(() => expect(document.querySelector('.mc-reason')).not.toBeNull());
    expect(document.querySelector('.sec-digest-row')).not.toBeNull();
    expect(document.querySelector('.sec-reason')).toBeNull();
    expect(document.body.textContent?.split('broker_unavailable').length).toBe(2);
  });
});

// R3-0262: the failed-read sentence told the owner to "retry the read in the posture section
// below", and nothing on the page could re-run the chain read.
describe('Security — a failed chain read can be retried where it is reported', () => {
  it('offers Retry beside the failure, and Retry reads the chain again', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      setup();
      await waitFor(() => expect(document.querySelector('.sec-int--broken')).not.toBeNull());
      const reads = () => invokeMock.mock.calls.filter((c) => c[0] === 'read_evidence_chain').length;
      const before = reads();
      const hero = document.querySelector('.mc-read') as HTMLElement;
      const retry = hero.querySelector('button') as HTMLButtonElement | null;
      expect(retry, 'a retry control in the failed-read block').not.toBeNull();
      expect(retry).toHaveTextContent('Retry');
      retry!.click();
      await waitFor(() => expect(reads()).toBe(before + 1));
      // The sentence no longer points at a control in another section that does not exist.
      expect(hero.textContent).not.toMatch(/posture section/);
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });

  it('offers no Retry when nothing failed', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_security_summary')
        return Promise.resolve({ pendingApprovals: 0, decidedApprovals: 0, auditEvents: 0, sensitiveEvents: [] });
      if (cmd === 'read_evidence_chain')
        return Promise.resolve({ state: 'blocked', surface: 'evidenceChain', reason: 'engine_refused', authenticated: false });
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Security /></ToastProvider></AppProvider>);
    await waitFor(() => expect(screen.getByText(/engine refused the evidence-chain read/i)).toBeInTheDocument());
    expect(document.querySelector('.mc-read button')).toBeNull();
  });
});

// The five residual names are a hand-kept copy of the inventory. `tools/check_residual_items.py`
// holds the SEVERITIES identical across the documents and never read this file, so an item added,
// dropped or renamed there left the page listing something else. The list is read here against
// `docs/SECURITY_MODEL.md` §4, the same lines that gate reads.
describe('Security — the residual list is the inventory\'s, by id and by name', () => {
  it('lists exactly the items SECURITY_MODEL §4 names, under the names it gives them', async () => {
    const model = readFileSync(resolve(process.cwd(), '../../docs/SECURITY_MODEL.md'), 'utf8');
    const inventory = new Map<string, string>();
    for (const m of model.matchAll(/^- \*\*(O-\d+) \((?:HIGH|MED|LOW)\)\*\* — ([^:]+):/gm)) {
      inventory.set(m[1], m[2].trim().toLowerCase());
    }
    // The parse found the section: a pattern that matched nothing would agree with any page.
    expect(inventory.size).toBeGreaterThanOrEqual(5);

    setup();
    await waitFor(() => expect(document.querySelectorAll('.sec-residual-item').length).toBeGreaterThan(0));
    const shown = new Map(Array.from(document.querySelectorAll('.sec-residual-item')).map((li) => [
      li.querySelector('.tag')!.textContent ?? '',
      (li.querySelector('.sec-residual-name')!.textContent ?? '').toLowerCase(),
    ]));
    expect([...shown.keys()]).toEqual([...inventory.keys()]);
    for (const [id, name] of inventory) expect(shown.get(id), id).toBe(name);
    // And the catalog carries no residual the page does not list.
    expect(Object.keys(SEC_STR).filter((k) => k.startsWith('residual.')).map((k) => k.slice('residual.'.length)))
      .toEqual([...inventory.keys()]);
  });
});
