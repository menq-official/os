import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

// Mock the Tauri IPC boundary. Calendar mirrors the real list_events store; it renders only
// what the store returns and never fabricates an entry.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Calendar } from './Calendar';
import { STR } from './Calendar.strings';
import { dicts } from '../i18n';

function setup() {
  // The calendar defaults to today's day-agenda, so the event must fall on today
  // to be seated in the visible view.
  const today = String(Date.now());
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_events') return Promise.resolve([{ id: 'e-1', title: 'Team standup', kind: 'meeting', location: 'room', startsAt: today, endsAt: null, createdAt: today, updatedAt: today }]);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Calendar />
      </ToastProvider>
    </AppProvider>,
  );
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Calendar — mirrors the real list_events store', () => {
  it('renders the real entry from list_events', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Team standup').length).toBeGreaterThan(0));
    expect(called('list_events')).toBe(true);
  });
});

/** Mount over a given event list; every other command is answered with nothing. */
function mountEvents(events: unknown[]) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_events') return Promise.resolve(events);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Calendar />
      </ToastProvider>
    </AppProvider>,
  );
}

const event = (over: Record<string, unknown>) => ({
  id: 'e-1', title: 'Team standup', kind: 'meeting', location: 'room',
  startsAt: String(Date.now()), endsAt: null, createdAt: '1700000000000', updatedAt: '1700000000000',
  ...over,
});

// The page parsed `startsAt` / `endsAt` with a private copy of `parseTimestamp`. These hold the
// call sites that now use the shared one: the day bucket, the timeline end, and the agenda end.
describe('Calendar — event times go through the shared timestamp parser', () => {
  it('seats an epoch-text start and an ISO start on the day, and counts an unreadable one as undated', async () => {
    const now = new Date();
    // Noon today, so an end one hour later cannot cross midnight whenever the suite runs.
    const noon = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0);
    const one = new Date(noon.getTime() + 3_600_000);
    mountEvents([
      event({ id: 'e-ms', title: 'Epoch text', startsAt: String(noon.getTime()), endsAt: String(one.getTime()) }),
      event({ id: 'e-iso', title: 'Iso text', startsAt: noon.toISOString(), endsAt: one.toISOString() }),
      event({ id: 'e-bad', title: 'No date', startsAt: 'someday' }),
    ]);
    await waitFor(() => expect(screen.getAllByText('Epoch text').length).toBeGreaterThan(0));

    // Both dated events are on today's timeline, each with a start AND an end (`–`).
    const seated = Array.from(document.querySelectorAll('.lane-track .ev'));
    expect(seated.map((el) => el.querySelector('.ev-t')?.textContent)).toEqual(['Epoch text', 'Iso text']);
    for (const el of seated) expect(el.getAttribute('aria-label')).toContain('–');
    // …and in the agenda rail, where the end is its own element.
    const rail = Array.from(document.querySelectorAll('.agenda .ag-rail'));
    expect(rail[0].querySelectorAll('.ag-time i')).toHaveLength(2);

    // The unreadable one is not dropped and not seated: it is the one undated event.
    expect(document.querySelectorAll('.dg-stat')[2].querySelector('b')?.textContent).toBe('1');
    expect(rail[1].textContent).toContain('No date');
    expect(rail[1].querySelector('.ag-time')?.textContent).toBe('—');
  });
});

// "Agenda", "Today" and "Undated" were in the shared catalog AND in this page's own table, and the
// page read both. The catalog's are the ones kept.
describe('Calendar — Agenda, Today and Undated come from the one catalog', () => {
  it('the page-local table carries no second copy of the three words', () => {
    for (const key of ['agenda', 'today', 'undated']) expect(Object.keys(STR)).not.toContain(key);
  });

  it('the agenda eyebrow and the undated count read the shared catalog', async () => {
    mountEvents([event({}), event({ id: 'e-bad', title: 'No date', startsAt: 'someday' })]);
    await waitFor(() => expect(screen.getAllByText('Team standup').length).toBeGreaterThan(0));
    expect(document.querySelector('.agenda .ag-head .eyebrow')?.textContent)
      .toBe(`${dicts.en['calendar.agenda']} · ${dicts.en['calendar.today']}`);
    expect(document.querySelectorAll('.dg-stat')[2].querySelector('.micro')?.textContent)
      .toBe(dicts.en['calendar.undated']);
    expect(document.querySelector('.agenda .cal-agenda-heading')?.textContent)
      .toBe(dicts.en['calendar.undated']);
  });
});

// The form took an `initialWhen` that its one caller always passed as the empty string.
describe('Calendar — the new-event form opens with no date filled in', () => {
  it('New opens the form with an empty date, and an untouched date is stored as undated', async () => {
    mountEvents([]);
    fireEvent.click(await screen.findByRole('button', { name: dicts.en['action.new'] }));
    const dialog = await screen.findByRole('dialog');
    const when = dialog.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(when.value).toBe('');

    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'Review' } });
    fireEvent.click(within(dialog).getByRole('button', { name: dicts.en['action.create'] }));
    await waitFor(() => expect(called('create_event')).toBe(true));
    const sent = invokeMock.mock.calls.find((c) => c[0] === 'create_event')?.[1] as { input: { startsAt: string } };
    expect(sent.input.startsAt).toBe('');
  });
});
