import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import { axe } from '../test/axe';

// The IPC boundary. Every page here reads real commands and has no fixture layer behind it, so
// the mock decides which STATE each page renders. That is the point: an accessibility pass over
// the happy path only is a pass over the state a user is least often stuck in.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class { onmessage: unknown = null; },
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Shell } from '../components/Shell';
import { CommandPalette } from '../components/CommandPalette';
// The page list and the command fixtures are the SHARED ones. This file used to carry its own
// copy of both — a second `PAGES`, a second `OBJECT_SHAPED` — which is the duplication
// `pages.fixtures.tsx` was extracted to end, and its own header names this spec as the place the
// second copy lived.
import { PAGES, arrange, rowsOnScreen } from './pages.fixtures';

/**
 * Accessibility (axe) coverage for the SURFACES, not just the primitives.
 *
 * The gap, as this file recorded it from the fifth independent audit's §E — that report was never
 * filed (`AUDIT_LEDGER.md`, `A-06`), so its wording cannot be checked and is not quoted here: the
 * only `*.a11y.spec.tsx` files in this repository covered `ui.tsx` and the shared primitives, and
 * neither the rebuilt modal nor Security, Approvals or any other of the 23 pages was in the axe
 * pass. A component library can be perfectly accessible while every page composed from it is
 * not — the violations that matter (a heading level skipped, two elements sharing an id, a live
 * region with no accessible name, a control labelled only by an icon) are properties of the
 * composition, and the composition was untested.
 *
 * WHAT THIS CANNOT DO, said plainly rather than implied. jsdom attaches no stylesheet — this
 * project runs with `css: false`, which is what let A-01 ship — so axe's `color-contrast` rule
 * cannot execute here and does not. Contrast is covered separately and statically by
 * `tools/check_contrast.py` over the committed token pairs. What runs here is the structural
 * half: roles, accessible names, ARIA validity, duplicate ids, landmark and heading structure.
 * That is most of what a page gets wrong, and none of it was being checked.
 */

// The three arrangements come from `pages.fixtures.tsx`:
//
//   * `settled`     — every command answers an EMPTY, shape-correct result (`list_dir` is an
//                     object with an `entries` array; answering it `[]` yields
//                     `Array.prototype.entries`, a function, and the page dies on `.filter`);
//   * `populated`   — typed rows for every list the pages read;
//   * `unreachable` — every command rejects, the state this cockpit is designed around.

function mount(node: React.ReactNode) {
  return render(<AppProvider><ToastProvider>{node}</ToastProvider></AppProvider>);
}

/**
 * Let the page's `useAsync` reads settle before axe looks at the DOM.
 *
 * The first invoke and one microtask turn are enough for the empty and the unreachable state. They
 * are not enough for `populated`: the rows can still be on their way, and axe would pass a page
 * without them under the name "with data". That state passes `rows`, and waits for a fixture value
 * to be on the screen.
 */
async function settled(rows?: { container: Element; name: string }) {
  await waitFor(() => expect(invokeMock).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  if (rows) await rowsOnScreen(invokeMock, rows.container, rows.name);
}

beforeEach(() => invokeMock.mockReset());
// Unmount FIRST, then reset. A populated page has cleanup effects that call the backend (the open
// thread cancels its reply on unmount); resetting the mock before the unmount hands those effects
// an `invoke` that returns `undefined`, which is a crash in the harness, not in the page.
afterEach(() => { cleanup(); invokeMock.mockReset(); });

// EVERY routed feature page, not a sample — `PAGES` is the list the browser sweeps mount too. The
// first version of this file covered six — and a sample is how a page ends up being the one nobody
// checked. `Chat` and
// `GroupChat` both render `Conversations`, so the shared surface is covered through them.
describe('accessibility (axe) — the pages, in the state a reader actually meets', () => {
  for (const [name, page] of PAGES) {
    it(`${name} has no violations when every read is empty`, async () => {
      // This test was called "with data" and called `empty()`: it mounted the empty state under
      // the populated state's name, and no page was ever checked with a row in it.
      arrange(invokeMock, 'settled');
      const { container } = mount(<main>{page()}</main>);
      await settled();
      expect(await axe(container)).toHaveNoViolations();
    });

    it(`${name} has no violations with data`, async () => {
      // Rows on screen: list items, per-row controls, badges, the selected-item panes. Most of a
      // page's markup only exists in this state.
      arrange(invokeMock, 'populated');
      const { container } = mount(<main>{page()}</main>);
      await settled({ container, name });
      expect(await axe(container)).toHaveNoViolations();
    });

    it(`${name} has no violations when the engine is unreachable`, async () => {
      // The state this whole cockpit is designed around — a fail-closed engine — and the one an
      // accessibility pass over the happy path would never visit.
      arrange(invokeMock, 'unreachable');
      const { container } = mount(<main>{page()}</main>);
      await settled();
      expect(await axe(container)).toHaveNoViolations();
    });
  }
});

describe('accessibility (axe) — this pass can give its other answer', () => {
  const projects = PAGES.find(([name]) => name === 'projects')![1];

  it('the "with data" settle waits for rows a backend delivers late', async () => {
    // Every answer one macrotask late: the first invoke is recorded and a microtask turn passes
    // long before a row exists. The settle this replaced returned there, and axe then read the
    // page without its rows.
    arrange(invokeMock, 'populated');
    const answer = invokeMock.getMockImplementation()!;
    invokeMock.mockImplementation((...args: unknown[]) =>
      new Promise((done) => { setTimeout(() => done(answer(...args)), 20); }));
    const { container } = mount(<main>{projects()}</main>);
    await settled({ container, name: 'projects' });
    expect(container.textContent).toContain('Bridge hardening');
  });

  it('a planted violation IS reported — the pass is not vacuous', async () => {
    // Every other assertion in the three jsdom axe specs is `toHaveNoViolations()`, and a runner
    // that reports nothing satisfies all of them. An image with no text alternative and a button
    // with no name, planted in a real page, are structural defects of the kind this pass is for.
    arrange(invokeMock, 'settled');
    const { container } = mount(<main>{projects()}</main>);
    await settled();
    expect(await axe(container)).toHaveNoViolations();

    const image = document.createElement('img');
    image.setAttribute('src', 'planted.png');
    container.append(image, document.createElement('button'));
    const results = await axe(container);
    expect(results.violations.map((v) => v.id).sort()).toEqual(['button-name', 'image-alt']);
    expect(() => expect(results).toHaveNoViolations()).toThrow();
    // And what the docstring above says this pass cannot do, measured: `color-contrast` is in
    // none of axe's four lists here. The rule is not run at all — it is not "incomplete".
    const filed = (['passes', 'violations', 'incomplete', 'inapplicable'] as const)
      .filter((list) => results[list].some((rule) => rule.id === 'color-contrast'));
    expect(filed).toEqual([]);
  });
});

describe('accessibility (axe) — the shell and its modal', () => {
  it('the app frame has no violations', async () => {
    arrange(invokeMock, 'settled');
    const { container } = mount(<Shell><h1>Stage</h1></Shell>);
    await settled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('the ⌘K command dock has no violations while OPEN', async () => {
    // The surface §D nominates as the keyboard route to all 23 pages, rebuilt for accessibility
    // in this phase and — until now — absent from the axe pass entirely.
    arrange(invokeMock, 'settled');
    const { container } = mount(<><CommandPalette /><main><h1>Stage</h1></main></>);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
    });
    await screen.findByRole('dialog');
    expect(await axe(container)).toHaveNoViolations();
  });
});
