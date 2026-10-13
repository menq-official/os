// The one control on this page that talks to the ENGINE, and the three things it must never do.
//
// `T-021d`. Phase 2's row asks for "queue + grant/deny/escalate **request**", and the request half is the
// part that did not exist: the page's grant/deny/escalate drive this app's OWN approval system over local
// SQLite. This section asks the engine to RECORD a request. `docs/OWNER_ACTION_REQUIRED.md` fixed the
// separation of the two as an invariant before either was built, so the section names which system it
// belongs to, and these specs hold it to that.
//
// The three:
//   1. it sends `request_engine_approval` and never a verdict command
//   2. it cannot be used at all unless the ENGINE published the task and the state to ask about
//   3. an outcome claiming a decision is not rendered as one

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: unknown) => invokeMock(cmd, args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Approvals } from './Approvals';
import { POPULATED } from './pages.fixtures';

// The local ledger this page is mounted over is the shared populated fixture. These specs are
// about the ENGINE section and assert nothing on a local row; they used to carry a field-for-field
// copy of `Approvals.test.tsx`'s PENDING approval to have something for `list_approvals` to return.
const LOCAL_LEDGER = POPULATED.list_approvals;

/**
 * A queue read in the shape the engine publishes it, with one task and the state it holds it in.
 *
 * `approval_inbox` (engine/runtime/bro_control_room_api.py) lists a task only while its state is
 * `awaiting-approval` or `waiting-approval`, and the published record is that item plus
 * `id = task_id`. The Rust mirror (`governance.rs :: parse_identified_record`) refuses a record
 * without a non-empty `id`. This fixture used to be `{ task_id, state: 'awaiting-owner-approval' }`
 * — a state no engine runtime file writes and a record the mirror would have turned away; the
 * mocked `invoke` let it through.
 */
const ENGINE_TASK_STATE = 'awaiting-approval';
const QUEUE_OK = {
  state: 'ok',
  surface: 'approvalQueue',
  records: [{ id: 'task-0001', task_id: 'task-0001', state: ENGINE_TASK_STATE }],
  authenticated: false,
  engine: null,
};

const RECORDED = {
  state: 'recorded',
  request_id: 'req-7f2a91c4',
  sequence: 1,
  entry_sha256: 'a'.repeat(64),
  duplicate: false,
  adjudicated: false,
  note: 'recorded, not adjudicated',
};

function setup(queue: unknown, outcome: unknown = RECORDED) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_approvals') return Promise.resolve(LOCAL_LEDGER);
    if (cmd === 'read_engine_approval_queue') {
      return queue instanceof Error ? Promise.reject(queue) : Promise.resolve(queue);
    }
    if (cmd === 'request_engine_approval') return Promise.resolve(outcome);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Approvals />
      </ToastProvider>
    </AppProvider>,
  );
}

async function fillAndAsk() {
  await waitFor(() => expect(screen.getByLabelText(/Engine task/i)).toBeTruthy());
  fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'gev' } });
  fireEvent.change(screen.getByLabelText(/^Why$/i), { target: { value: 'the owner should see this' } });
  fireEvent.click(screen.getByRole('button', { name: /Ask: approve/i }));
}

beforeEach(() => invokeMock.mockReset());

describe('the engine REQUEST section', () => {
  it('is mounted over a local ledger that has rows, and offers the engine task in the state published', async () => {
    setup(QUEUE_OK);
    await waitFor(() => expect(screen.getByLabelText(/Engine task/i)).toBeTruthy());
    // The local list rendered (so the section is being tested beside a populated gate, as before)…
    expect(Array.isArray(LOCAL_LEDGER) && LOCAL_LEDGER.length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.queue .q-row')).toHaveLength((LOCAL_LEDGER as unknown[]).length);
    // …and the one option is the engine's task with the engine's state, not a local approval.
    const options = Array.from((screen.getByLabelText(/Engine task/i) as HTMLSelectElement).options);
    expect(options.map((o) => o.textContent)).toEqual([`task-0001 · ${ENGINE_TASK_STATE}`]);
  });

  it('cannot be used when the engine queue is not readable, and says so', async () => {
    setup(new Error('broker_unavailable'));
    await waitFor(() =>
      expect(screen.getByText(/no task to ask about/i)).toBeTruthy());
    expect(screen.queryByLabelText(/Engine task/i)).toBeNull();
    expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain('request_engine_approval');
  });

  it('sends request_engine_approval with the engine-published task and state', async () => {
    setup(QUEUE_OK);
    await fillAndAsk();
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === 'request_engine_approval')).toBe(true));
    const [, args] = invokeMock.mock.calls.find((c) => c[0] === 'request_engine_approval')!;
    expect(args).toMatchObject({
      taskId: 'task-0001',
      requestedCommand: 'approve',
      expectedTaskState: ENGINE_TASK_STATE,
      requestedBy: 'gev',
    });
  });

  it('sends no verdict command — the desktop asks and does not decide', async () => {
    setup(QUEUE_OK);
    await fillAndAsk();
    await waitFor(() =>
      expect(invokeMock.mock.calls.some((c) => c[0] === 'request_engine_approval')).toBe(true));
    for (const forbidden of ['confirm_approval', 'reject_approval', 'decide_approval']) {
      expect(invokeMock.mock.calls.map((c) => c[0])).not.toContain(forbidden);
    }
  });

  it('renders a record as recorded-not-adjudicated', async () => {
    setup(QUEUE_OK);
    await fillAndAsk();
    await waitFor(() => expect(screen.getByText(/not adjudicated/i)).toBeTruthy());
  });

  it("renders the engine's refusal as a refusal", async () => {
    setup(QUEUE_OK, { state: 'refused', reason: 'task is in state running' });
    await fillAndAsk();
    await waitFor(() => expect(screen.getByText(/engine refused/i)).toBeTruthy());
    expect(screen.getByText(/state running/i)).toBeTruthy();
  });

  it('DOES NOT render an outcome that claims a decision', async () => {
    setup(QUEUE_OK, { ...RECORDED, granted: true });
    await fillAndAsk();
    await waitFor(() => expect(screen.getByText(/Nothing was established/i)).toBeTruthy());
    expect(screen.queryByText(/not adjudicated/i)).toBeNull();
  });

  it('will not ask until a name and a reason are given', async () => {
    setup(QUEUE_OK);
    await waitFor(() => expect(screen.getByLabelText(/Engine task/i)).toBeTruthy());
    const button = screen.getByRole('button', { name: /Ask: approve/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Your name/i), { target: { value: 'gev' } });
    expect((screen.getByRole('button', { name: /Ask: approve/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
