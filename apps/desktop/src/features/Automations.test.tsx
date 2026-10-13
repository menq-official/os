import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';

// Mock the Tauri IPC boundary. Automations mirrors the real list_automations store; it renders only
// what the store returns and never fabricates an entry.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Automations } from './Automations';
import { STR } from './Automations.strings';

function setup() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_automations') return Promise.resolve([{ id: 'au-1', name: 'Nightly backup', trigger: 'cron', action: 'backup', enabled: true, createdAt: '1700000000000', updatedAt: '1700000000000' }]);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Automations />
      </ToastProvider>
    </AppProvider>,
  );
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Automations — mirrors the real list_automations store', () => {
  it('renders the real entry from list_automations', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Nightly backup').length).toBeGreaterThan(0));
    expect(called('list_automations')).toBe(true);
  });
});

// §D: "`n` new, `/` filter, arrow-nav, `Enter` open". `/` was the one binding of the four that
// did not exist. On every other page in this cockpit `/` puts the cursor in a search box, so a
// keyboard user arriving here pressed it and nothing happened. This page filters with a CHIP
// GROUP rather than a text field, so `/` moves focus to the filter — binding it to "open a
// search box that does not exist" would have meant building a second filter to satisfy a
// keystroke.
describe('Automations — `/` reaches the state filter', () => {
  const filterGroup = () => screen.getByRole('group', { name: /state|վիճակ|состояни/i });

  it('`/` moves focus into the filter chips', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Nightly backup').length).toBeGreaterThan(0));
    expect(document.activeElement).toBe(document.body);

    fireEvent.keyDown(window, { key: '/' });

    const focused = document.activeElement as HTMLElement;
    expect(filterGroup().contains(focused)).toBe(true);
    // It lands on the ACTIVE chip, not blindly on the first, so pressing `/` twice does not
    // silently move the user off the filter they already chose.
    expect(focused).toHaveAttribute('aria-pressed', 'true');
  });

  it('arrows walk the chips once focus is there', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Nightly backup').length).toBeGreaterThan(0));
    fireEvent.keyDown(window, { key: '/' });
    const first = document.activeElement as HTMLElement;

    fireEvent.keyDown(filterGroup(), { key: 'ArrowRight' });
    expect(document.activeElement).not.toBe(first);
    expect(filterGroup().contains(document.activeElement as HTMLElement)).toBe(true);

    fireEvent.keyDown(filterGroup(), { key: 'Home' });
    expect(document.activeElement).toBe(within(filterGroup()).getAllByRole('button')[0]);
  });

  it('`/` typed INTO a field is a slash, not a shortcut', async () => {
    // The guard that keeps a page shortcut from eating a character the user meant to type.
    //
    // The authoring form is NOT open here. This test used to press `n` first and type into the
    // form's own field — but with the form open the handler returns on its first line, so the
    // field guard it is named for was never reached, and deleting that guard left it green. A
    // field that exists while the form is closed is the only thing that reaches it.
    setup();
    await waitFor(() => expect(screen.getAllByText('Nightly backup').length).toBeGreaterThan(0));
    const field = document.createElement('input');
    document.body.appendChild(field);
    try {
      field.focus();
      // `fireEvent` returns false when a handler called preventDefault.
      expect(fireEvent.keyDown(field, { key: '/' })).toBe(true);
      expect(document.activeElement).toBe(field);
      // The same guard holds `n`: typed into a field it opens nothing.
      fireEvent.keyDown(field, { key: 'n' });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally {
      field.remove();
    }
  });
});

const ROW_AT = { createdAt: '1700000000000', updatedAt: '1700000000000' };
const BY_HAND = { id: 'au-m', name: 'By hand', trigger: 'manual', action: 'notify: a', enabled: true, ...ROW_AT };
const UNREAD = { id: 'au-c', name: 'Cron-ish', trigger: 'cron', action: 'notify: b', enabled: true, ...ROW_AT };
const TIMED = { id: 'au-i', name: 'Every five', trigger: 'every: 5m', action: 'notify: c', enabled: true, ...ROW_AT };

function mountRows(rows: unknown[]) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_automations') return Promise.resolve(rows);
    if (cmd === 'list_automation_runs') return Promise.resolve([]);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Automations />
      </ToastProvider>
    </AppProvider>,
  );
}

// The "Scheduler · sweep" walked every armed conduit. The backend scheduler fires only a rule
// whose trigger parses as an interval; a manual rule, or one with a trigger it cannot read, is
// never polled by anything — and the sweep, under that pill, visited them all the same.
describe('Automations — the scheduler sweep visits only what the scheduler polls', () => {
  /** The sweep's own tick: the page registers it with `setInterval(tick, 1700)`. Calling it by
   *  hand walks the sweep without waiting on a clock. It is registered in an effect, which can
   *  run after the rows are already on screen — so the registration is waited for, not assumed. */
  async function sweepTick(spy: { mock: { calls: unknown[][] } }): Promise<() => void> {
    const ticks = () => spy.mock.calls.filter((c) => c[1] === 1700).map((c) => c[0] as () => void);
    await waitFor(() => expect(ticks().length, 'the sweep registered its interval').toBeGreaterThan(0));
    return ticks()[ticks().length - 1];
  }
  const checking = () => Array.from(document.querySelectorAll('.ln-valve.checking'))
    .map((v) => v.closest('.lane')?.id);

  afterEach(() => vi.restoreAllMocks());

  it('walks the interval conduit and never a manual or unrecognised one', async () => {
    const spy = vi.spyOn(window, 'setInterval');
    mountRows([BY_HAND, UNREAD, TIMED]);
    await waitFor(() => expect(screen.getAllByText('Every five').length).toBeGreaterThan(0));
    const tick = await sweepTick(spy);
    for (let i = 0; i < 4; i += 1) {
      tick();
      expect(checking(), `tick ${i + 1}`).toEqual(['au-lane-au-i']);
    }
  });

  it('shows the sweep pill only when an armed conduit is on a schedule', async () => {
    const first = mountRows([BY_HAND, UNREAD]);
    await waitFor(() => expect(screen.getAllByText('By hand').length).toBeGreaterThan(0));
    expect(screen.queryByText(STR.schedSweep.en)).not.toBeInTheDocument();
    first.unmount();

    mountRows([BY_HAND, TIMED]);
    await waitFor(() => expect(screen.getAllByText('Every five').length).toBeGreaterThan(0));
    expect(screen.getByText(STR.schedSweep.en)).toBeInTheDocument();
  });

  it('an interval conduit that is switched off is not swept and earns no pill', async () => {
    const spy = vi.spyOn(window, 'setInterval');
    mountRows([{ ...TIMED, enabled: false }, BY_HAND]);
    await waitFor(() => expect(screen.getAllByText('Every five').length).toBeGreaterThan(0));
    expect(screen.queryByText(STR.schedSweep.en)).not.toBeInTheDocument();
    (await sweepTick(spy))();
    expect(checking()).toEqual([]);
  });
});

// The page read `prefers-reduced-motion` through a private one-line copy of a matchMedia call.
// It reads the shared `usePrefersReducedMotion` now; these hold the two places that used the copy.
describe('Automations — reduced motion, read through the shared hook', () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query, onchange: null,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}, dispatchEvent() { return false; },
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = realMatchMedia; vi.restoreAllMocks(); });

  it('the scheduler sweep never starts', async () => {
    const spy = vi.spyOn(window, 'setInterval');
    mountRows([TIMED]);
    await waitFor(() => expect(screen.getAllByText('Every five').length).toBeGreaterThan(0));
    // The sweep is registered in an effect; let every pending effect run before looking, or
    // "nothing registered" could only mean "not yet".
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(spy.mock.calls.filter((c) => c[1] === 1700)).toEqual([]);
  });

  it('choosing a conduit from the index scrolls without animating', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    mountRows([TIMED]);
    fireEvent.click(await screen.findByRole('button', { name: `Every five, ${STR.armedState.en}` }));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });
});

// The schematic's middle node read "Governed", its side heading "Governed telemetry" and the
// legend "gate = governed step" — on a page whose own contract note says the contract is enforced
// here, by this page, and that no automation run is governed, signed or verified.
describe('Automations — no label calls the page\'s own contract check "governed"', () => {
  const GOVERNED = /governed|կառավարվող|управляем/i;

  it('the node, the telemetry heading and the legend name what they are', async () => {
    mountRows([BY_HAND]);
    await waitFor(() => expect(screen.getAllByText('By hand').length).toBeGreaterThan(0));
    const flow = screen.getByRole('group', { name: STR.flowAria.en });
    expect(flow.textContent).not.toMatch(GOVERNED);
    expect(within(flow).getByText(STR.contractCheck.en)).toBeInTheDocument();
    expect(screen.queryByText(/Governed telemetry/i)).not.toBeInTheDocument();
    expect(screen.getByText(STR.runTelemetry.en)).toBeInTheDocument();
    expect(screen.getByText(STR.valveGate.en).textContent).not.toMatch(GOVERNED);
  });

  it('in all three languages', () => {
    for (const key of ['contractCheck', 'runTelemetry', 'valveGate'] as const) {
      for (const lang of ['en', 'hy', 'ru'] as const) {
        expect(STR[key][lang], `${key}.${lang}`).not.toMatch(GOVERNED);
        expect(STR[key][lang].length, `${key}.${lang}`).toBeGreaterThan(3);
      }
      expect(new Set(Object.values(STR[key])).size, `${key} is translated, not copied`).toBe(3);
    }
  });
});

// `delete_automation` is behind a native confirmation the Rust handler raises. The page draws no
// dialog of its own: pressing Delete sends the id and the display language, and the promise stays
// pending until the person answers the system dialog. What the page owes the reader is the truth
// about that, before the press and after it.
describe('Automations — delete: the app asks natively, the page does not', () => {
  // A runnable row (manual trigger, known verb), so no standing seal draws an alert of its own.
  const ROW = { id: 'au-1', name: 'Nightly backup', trigger: 'manual', action: 'notify: backup done', enabled: true, createdAt: '1700000000000', updatedAt: '1700000000000' };

  /** Mount with `delete_automation` answered by `onDelete`; resolves once the schematic is up. */
  async function mountWithDelete(onDelete: () => Promise<unknown>) {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_automations') return Promise.resolve([ROW]);
      if (cmd === 'delete_automation') return onDelete();
      return Promise.resolve(null);
    });
    render(
      <AppProvider>
        <ToastProvider>
          <Automations />
        </ToastProvider>
      </AppProvider>,
    );
    return screen.findByRole('button', { name: 'Delete' });
  }

  const deleteCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'delete_automation');

  it('says, before anything is pressed, that the app will ask in a system dialog', async () => {
    const button = await mountWithDelete(() => Promise.resolve(null));
    expect(STR.deleteAsks.en).toMatch(/the app opens a system dialog/);
    expect(STR.deleteAsks.en).toMatch(/Nothing is deleted unless you confirm there/);
    expect(screen.getByText(STR.deleteAsks.en)).toBeInTheDocument();
    expect(button).toHaveAttribute('title', STR.deleteAsks.en);
    expect(deleteCalls()).toHaveLength(0);
  });

  it('draws no confirm dialog of its own: one press goes straight to the handler that asks', async () => {
    const button = await mountWithDelete(() => new Promise(() => { /* the system dialog stays open */ }));
    fireEvent.click(button);
    // No in-page dialog stands between the press and the call…
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // …and the call carries the id and the display language, nothing that answers for the person.
    expect(deleteCalls()).toEqual([['delete_automation', { id: 'au-1', lang: 'en' }]]);
    // While the system dialog is open the page says it is waiting, and offers no second Delete.
    // Twice: once beside the button, once in the page's polite live region.
    expect(await screen.findAllByText(STR.deleteAsking.en)).toHaveLength(2);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(deleteCalls()).toHaveLength(1);
  });

  it('a declined system dialog is reported as nothing deleted — not as an error, and the row stays', async () => {
    const button = await mountWithDelete(() => Promise.reject(
      'native_confirmation_not_given: nothing was deleted. The system dialog was declined or dismissed.',
    ));
    fireEvent.click(button);
    expect(await screen.findAllByText(STR.deleteNotConfirmed.en)).toHaveLength(2);
    expect(screen.getAllByText('Nightly backup').length).toBeGreaterThan(0);
    // The raw machine string is not put on the page, and "no" is not rendered as a wall denial.
    expect(screen.queryByText(/native_confirmation_not_given/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('any other refusal of the delete is still shown as the failure it is', async () => {
    const button = await mountWithDelete(() => Promise.reject('another confirmation is already in progress'));
    fireEvent.click(button);
    expect((await screen.findAllByText('another confirmation is already in progress')).length).toBeGreaterThan(0);
    expect(screen.queryByText(STR.deleteNotConfirmed.en)).not.toBeInTheDocument();
  });

  it('the three languages all carry the three delete strings', () => {
    for (const key of ['deleteAsks', 'deleteAsking', 'deleteNotConfirmed'] as const) {
      for (const lang of ['en', 'hy', 'ru'] as const) {
        expect(STR[key][lang].length, `${key}.${lang}`).toBeGreaterThan(10);
      }
      expect(new Set(Object.values(STR[key])).size, `${key} is translated, not copied`).toBe(3);
    }
  });
});
