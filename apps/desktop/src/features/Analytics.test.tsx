import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Analytics } from './Analytics';
import { STR as AN_STR } from './Analytics.strings';
import { STR as CHART_STR } from '../components/charts/Chart.strings';

function setup() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'get_analytics') return Promise.resolve([{ key: 'zz_custom_metric', label: 'Total Runs Logged', value: 42 }]);
    return Promise.resolve(null);
  });
  return render(<AppProvider><ToastProvider><Analytics /></ToastProvider></AppProvider>);
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Analytics — mirrors the real get_analytics store', () => {
  it('renders the real data from get_analytics', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Total Runs Logged').length).toBeGreaterThan(0));
    expect(called('get_analytics')).toBe(true);
  });
});

// §D: "scrubber (anScrub) … Keyboard: scrubber is a slider (role=slider, arrows)".
// The page had no scrubber at all. What it scrubs is the RANK cut-off, not time:
// `get_analytics` returns one all-time aggregate with no time dimension, and drawing an axis
// the data does not have is what this page refuses to do in its other three panels.
function withNodes(n: number) {
  const data = Array.from({ length: n }, (_, i) => ({
    key: `node_${i}`, label: `Node ${i}`, value: (n - i) * 10,
  }));
  invokeMock.mockImplementation((cmd: string) =>
    Promise.resolve(cmd === 'get_analytics' ? data : null));
  return render(<AppProvider><ToastProvider><Analytics /></ToastProvider></AppProvider>);
}

describe('Analytics — the rank scrubber', () => {
  const slider = () => screen.getByRole('slider');

  it('is a real ARIA slider, bounded by the number of nodes', async () => {
    withNodes(5);
    await waitFor(() => expect(slider()).toBeInTheDocument());
    expect(slider()).toHaveAttribute('aria-valuemin', '1');
    expect(slider()).toHaveAttribute('aria-valuemax', '5');
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
    // The value is published as TEXT too, not only as a number a screen reader must
    // interpret against bounds it has to remember.
    expect(slider().getAttribute('aria-valuetext')).toBeTruthy();
    expect(slider()).toHaveAccessibleName();
  });

  it('does not appear when there is nothing to cut', async () => {
    withNodes(1);
    await waitFor(() => expect(screen.getAllByText('Node 0').length).toBeGreaterThan(0));
    expect(screen.queryByRole('slider')).toBeNull();
  });

  it('arrows move the cut, and the plot follows it', async () => {
    const user = userEvent.setup();
    withNodes(4);
    await waitFor(() => expect(slider()).toBeInTheDocument());
    slider().focus();

    await user.keyboard('{ArrowLeft}');
    expect(slider()).toHaveAttribute('aria-valuenow', '3');
    // The lowest-ranked node is the one that leaves first — the cut is by VALUE, and
    // Node 3 is the smallest.
    await waitFor(() => expect(screen.queryByText('Node 3')).toBeNull());
    expect(screen.getAllByText('Node 0').length).toBeGreaterThan(0);

    await user.keyboard('{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '4');
    await waitFor(() => expect(screen.getAllByText('Node 3').length).toBeGreaterThan(0));
  });

  it('Home and End go to the ends — part of the slider contract, not an extra', async () => {
    const user = userEvent.setup();
    withNodes(6);
    await waitFor(() => expect(slider()).toBeInTheDocument());
    slider().focus();
    await user.keyboard('{Home}');
    expect(slider()).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{End}');
    expect(slider()).toHaveAttribute('aria-valuenow', '6');
  });

  it('a pointer moves the cut: pressing on the rail sets the rank under the pointer', async () => {
    // The rail had `cursor: pointer` and no pointer handler at all — a mouse or touch user could
    // not move the cut, only someone who knew to Tab to it and use the arrows.
    withNodes(5);
    await waitFor(() => expect(slider()).toBeInTheDocument());
    const rail = slider();
    rail.getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, height: 10, right: 300, bottom: 10, x: 100, y: 0, toJSON: () => ({}) }) as DOMRect;

    // 40% along a 5-step rail is rank 2.
    fireEvent.pointerDown(rail, { clientX: 180, button: 0, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '2');
    await waitFor(() => expect(screen.queryByText('Node 4')).toBeNull());

    // Dragging while pressed follows the pointer; past either end it stops at the bound.
    fireEvent.pointerMove(rail, { clientX: 260, buttons: 1, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '4');
    fireEvent.pointerMove(rail, { clientX: 9999, buttons: 1, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '5');
    fireEvent.pointerMove(rail, { clientX: -50, buttons: 1, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '1');

    // A move with no button held is a hover, not a drag.
    fireEvent.pointerUp(rail, { pointerId: 1 });
    fireEvent.pointerMove(rail, { clientX: 260, buttons: 0, pointerId: 1 });
    expect(slider()).toHaveAttribute('aria-valuenow', '1');
  });

  it('never moves outside its own bounds', async () => {
    const user = userEvent.setup();
    withNodes(3);
    await waitFor(() => expect(slider()).toBeInTheDocument());
    slider().focus();
    await user.keyboard('{Home}{ArrowLeft}{ArrowLeft}');
    expect(slider()).toHaveAttribute('aria-valuenow', '1');
    await user.keyboard('{End}{ArrowRight}{ArrowRight}');
    expect(slider()).toHaveAttribute('aria-valuenow', '3');
  });

  it('the deck total follows the cut instead of contradicting it', async () => {
    const user = userEvent.setup();
    withNodes(3);                     // values 30, 20, 10 → 60 whole, 50 at top-2
    await waitFor(() => expect(slider()).toBeInTheDocument());
    // The DECK's own figures, by their own elements. This used to be `getAllByText('60')` and
    // `getAllByText(/2/)`: BarChart prints its own total of the already-cut metrics
    // (`.barchart-total-value`) and a bar value of 20, so both held with a deck total that
    // ignored the cut — the very thing the test is named for.
    const deckTotal = () => document.querySelector('.an-deck-foot .an-foot-r .mono')?.textContent;
    const subsetNote = () => document.querySelector('.an-deck-foot > .micro.muted')?.textContent ?? null;
    const deckCount = () => document.querySelector('.an-deck-foot .capsule b')?.textContent;
    // The total counts up over 900 ms, so it is waited for longer than the default second.
    await waitFor(() => expect(deckTotal()).toBe('60'), { timeout: 4000 });
    expect(deckCount()).toBe('3');
    expect(subsetNote()).toBeNull();
    slider().focus();
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(deckTotal()).toBe('50'), { timeout: 4000 });
    // And it says that it is showing a subset, rather than a count that quietly means
    // "some of them".
    expect(deckCount()).toBe('2');
    expect(subsetNote()).toBe('top 2 of 3');
  });
});

// `get_analytics` is `repo::analytics::metrics`: seventeen `SELECT COUNT(*)` over the desktop's own
// SQLite tables. The three empty panels told the reader that "the engine" does not expose the
// missing aggregate — an engine this read never asks.
describe('Analytics — the empty panels name the desktop backend, not the engine', () => {
  const KEYS = [
    'districtHint', 'districtTableHint', 'autonomyHint', 'autonomyTableHint', 'channelHint', 'channelTableHint',
  ] as const;

  it.each(['en', 'hy', 'ru'] as const)('no panel blames the engine for a local read (%s)', (lang) => {
    for (const k of KEYS) {
      expect(AN_STR[k][lang], k).not.toMatch(/engine|շարժիչ|движ/i);
      expect(AN_STR[k][lang], k).toMatch(/desktop|десктоп/i);
    }
  });

  it('the page renders that wording', async () => {
    withNodes(2);
    await waitFor(() =>
      expect(screen.getByText(/The desktop backend does not expose a per-district aggregate/)).toBeInTheDocument());
    expect(screen.queryByText(/engine/i)).toBeNull();
  });
});

// `.an-sr` was a page-local copy of the shared visually-hidden rule, the one components/ui.css says
// `.sr-only` was introduced to replace.
describe('Analytics — hidden text uses the shared visually-hidden class', () => {
  it('the live status and the three empty-panel captions are `sr-only`, and no `.an-sr` is declared', async () => {
    withNodes(2);
    await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());
    const live = document.querySelector('.v-analytics > [role="status"][aria-live="polite"]')!;
    expect(live).not.toBeNull();
    expect(live.classList.contains('sr-only')).toBe(true);
    const captions = Array.from(document.querySelectorAll('.v-analytics .an-table caption'));
    expect(captions).toHaveLength(3);
    for (const c of captions) expect(c.classList.contains('sr-only')).toBe(true);
    expect(document.querySelector('.v-analytics > style')!.textContent).not.toMatch(/\.an-sr\b/);
    expect(document.querySelector('.an-sr')).toBeNull();
  });
});

// Four chart labels were kept twice — in this page's catalog and in the chart's own — and the
// Armenian "Show data table" had already drifted between the two. The chart catalog is the one copy.
describe('Analytics — chart labels have one copy, the chart catalog\'s', () => {
  it('the page catalog no longer repeats them', () => {
    for (const k of ['hiddenWord', 'value', 'share', 'showDataTable']) {
      expect(Object.keys(AN_STR), k).not.toContain(k);
    }
  });

  it.each(['en', 'hy', 'ru'] as const)('every table toggle and header on the page reads the chart catalog (%s)', async (lang) => {
    localStorage.setItem('brops.lang', JSON.stringify(lang));
    try {
      withNodes(2);
      await waitFor(() => expect(screen.getByRole('slider')).toBeInTheDocument());
      const text = (sel: string) => Array.from(document.querySelectorAll(sel)).map((el) => el.textContent);
      // One toggle under the plot and one under each of the three empty panels.
      expect(text('.v-analytics details > summary')).toEqual(Array(4).fill(CHART_STR.showDataTable[lang]));
      expect(text('.v-analytics details thead th:nth-child(2)')).toEqual(Array(4).fill(CHART_STR.valueHeader[lang]));
      expect(text('.v-analytics .chart-table thead th:nth-child(3)')).toEqual([CHART_STR.shareHeader[lang]]);
      // The legend's "hidden" marker, once a node is switched off.
      fireEvent.click(document.querySelector('.barchart-legend-item')!);
      expect(document.querySelector('.barchart-legend-state')?.textContent).toBe(` · ${CHART_STR.hiddenWord[lang]}`);
    } finally {
      localStorage.removeItem('brops.lang');
    }
  });
});
