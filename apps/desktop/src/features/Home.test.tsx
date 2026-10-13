import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the Tauri IPC boundary. The Home dashboard mirrors real reads — the active
// task queue (list_tasks_by_status) and the pending-approval count (list_approvals)
// — and never fabricates a task or an approval.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Home } from './Home';
import { STR as HOME_STR } from './Home.strings';
import { activitySummary } from './Home.strings';

const TASK = {
  id: 't-1',
  projectId: null,
  title: 'Ship the release notes',
  description: '',
  status: 'active',
  priority: 'high',
  assignedAgentId: null,
  dueAt: null,
  position: 1,
  createdAt: '1700000000000',
  updatedAt: '1700000000000',
  completedAt: null,
};

const EVENT = {
  id: 'a-1',
  eventType: 'task.created',
  actorType: 'system',
  source: null as string | null,
  actorId: null,
  entityType: 'task',
  entityId: 't-1',
  createdAt: '1700000000000',
};

/** `activity` rows for the sparkline. `seeded` of them carry `source: 'seed'`, the mark
 *  `repo::seed` writes; the rest carry `null`, which is what a real audited write produces. */
function events(total: number, seeded: number) {
  return Array.from({ length: total }, (_, i) => ({
    ...EVENT,
    id: `a-${i}`,
    source: i < seeded ? 'seed' : null,
    createdAt: String(1700000000000 + i * 60000),
  }));
}

function setup(activity: ReturnType<typeof events> = []) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_tasks_by_status') return Promise.resolve([TASK]);
    if (cmd === 'list_approvals') return Promise.resolve([]);
    if (cmd === 'list_activity') return Promise.resolve(activity);
    return Promise.resolve(null);
  });
  return render(<AppProvider><ToastProvider><Home /></ToastProvider></AppProvider>);
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Home — mirrors the real dashboard reads', () => {
  it('renders the real active task from list_tasks_by_status', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Ship the release notes').length).toBeGreaterThan(0));
    expect(called('list_tasks_by_status')).toBe(true);
    expect(called('list_approvals')).toBe(true);
  });
});

// T-057. `repo::seed` writes 56 FABRICATED rows straight into `audit_events` so
// this very sparkline has "a real heartbeat". The surface those rows exist to
// animate is therefore the surface being lied to, and marking the row in the
// database is only half a fix — the mark has to arrive here, which is the same
// defect `ActivityEvent.actorType` already carries a paragraph about.
// V-4, `docs/VERIFICATION_QUEUE_1.md`. `activitySummary` was tested; the WIRING that feeds it
// was not. Replacing `rows.filter((e) => e.source === 'seed').length` with `0` type-checked and
// left the suite green — measured on 2026-09-01 before these tests existed. A pure function with
// a tested body and an untested caller is a function whose result nobody has seen arrive.
//
// So these render the real `<Home />` over a mocked `list_activity` and read the sentence off the
// screen. They fail on the constant-fold, on the wrong predicate, and on the mark being dropped
// between the IPC boundary and the summary — which is the whole path T-057 was about.
describe('Home — the seeded mark survives the wiring, not just the formatter', () => {
  it('counts the seeded rows it was actually given and says so on screen', async () => {
    setup(events(5, 2));
    await waitFor(() =>
      expect(screen.getByText(/2 of them are seeded demo data/)).toBeTruthy());
  });

  it('says nothing about seeding when every row is real', async () => {
    setup(events(5, 0));
    await waitFor(() => expect(screen.getByText(/5 recent events/)).toBeTruthy());
    expect(screen.queryByText(/seeded demo data/)).toBeNull();
  });

  it('counts the seeded rows rather than all of them', async () => {
    // The arm that separates "wired up" from "wired up correctly": a caller that dropped the
    // predicate and passed `rows.length` would pass the first test and fail this one.
    setup(events(5, 5));
    await waitFor(() =>
      expect(screen.getByText(/5 of them are seeded demo data/)).toBeTruthy());
    setup(events(9, 3));
    await waitFor(() =>
      expect(screen.getByText(/3 of them are seeded demo data/)).toBeTruthy());
  });
});

describe('activitySummary — seeded events are named, not hidden', () => {
  it('says how many of the plotted events are fabricated', () => {
    const en = activitySummary('en', 200, 24, 19, 56);
    expect(en).toContain('200 recent events');
    expect(en).toContain('56');
    expect(en.toLowerCase()).toContain('seeded');
  });

  it('says it in every language the app offers', () => {
    expect(activitySummary('hy', 200, 24, 19, 56)).toContain('56');
    expect(activitySummary('ru', 200, 24, 19, 56)).toContain('56');
  });

  it('is unchanged on a real install, where nothing is seeded', () => {
    const plain = activitySummary('en', 200, 24, 19, 0);
    expect(plain).toBe(activitySummary('en', 200, 24, 19));
    expect(plain.toLowerCase()).not.toContain('seeded');
  });
});

// The seeded count was taken over EVERY row, and the total it is reported against counts only the
// rows whose time could be read. A seeded row with an unreadable time is not on the line, and was
// still counted as one "of them".
describe('Home — the seeded count is taken over the rows that are plotted', () => {
  it('a seeded row that is not on the line is not one "of them"', async () => {
    const rows = events(5, 3);
    rows[0] = { ...rows[0], createdAt: 'not a time' };
    setup(rows);
    await waitFor(() =>
      expect(screen.getByText(/2 of them are seeded demo data/)).toBeTruthy());
    expect(screen.queryByText(/3 of them are seeded demo data/)).toBeNull();
  });
});

// R3-0790: Home kept its own copy of the timestamp conversion, without the shared parser's blank
// guard: `Number('')` is 0, so an event with no recorded time was plotted at 1970 and counted.
describe('Home — an event with no recorded time is not on the line', () => {
  it('a blank createdAt is not counted as a plotted event', async () => {
    const rows = events(5, 0);
    rows[0] = { ...rows[0], createdAt: '' };
    setup(rows);
    await waitFor(() => expect(screen.getByText(/4 recent events/)).toBeTruthy());
    expect(screen.queryByText(/5 recent events/)).toBeNull();
  });
});

// R3-0791: the pending list and the pending share came from two separate `list_approvals` calls,
// so one could fail, or answer differently, while the other stood.
describe('Home — approvals are read once', () => {
  const approval = (id: string, actionType: string, status: string) => ({
    id, actionType, target: 't', level: 'A2', riskLevel: 'low', status, requestedBy: 'webview:main',
    decisionNote: null, entityType: null, entityId: null, requestedAt: '1700000000000', decidedAt: null,
  });

  it('one list_approvals call feeds the pending list and the pending share', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_approvals') {
        return Promise.resolve([approval('ap-1', 'Send email', 'pending'), approval('ap-2', 'Delete repo', 'approved')]);
      }
      return Promise.resolve([]);
    });
    render(<AppProvider><ToastProvider><Home /></ToastProvider></AppProvider>);
    // The list shows the pending one only…
    await waitFor(() => expect(screen.getByText('Send email')).toBeInTheDocument());
    expect(screen.queryByText('Delete repo')).toBeNull();
    // …the share is taken over both rows of the same answer…
    const share = screen.getByText(HOME_STR.approvalsPending.en).closest('.hx-ratio') as HTMLElement;
    expect(share.querySelector('b')).toHaveTextContent('50%');
    // …and the backend was asked once.
    expect(invokeMock.mock.calls.filter((c) => c[0] === 'list_approvals')).toHaveLength(1);
  });
});

// R3-0246: one sentence — the page subtitle — was printed four times in the hero: as the
// eyebrow, as the subtitle, as the caption over the counts, and as the counts group's name.
describe('Home — the subtitle is said once', () => {
  it('appears once in the hero, and the counts are named for what they are', async () => {
    setup();
    await waitFor(() => expect(document.querySelector('.briefing')).not.toBeNull());
    const hero = document.querySelector('.briefing') as HTMLElement;
    const subtitle = 'What matters now';
    expect(hero.textContent!.split(subtitle).length - 1).toBe(1);
    expect(hero.querySelector('.sub')).toHaveTextContent(subtitle);
    // The group of counts has its own name — it is not called by the page's subtitle.
    expect(screen.getByRole('group', { name: HOME_STR.atAGlance.en })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: subtitle })).toBeNull();
  });
});
