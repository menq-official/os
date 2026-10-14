import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the Tauri IPC boundary. The point of this suite is the boundary itself: this
// build registers NO dispatch command, so the composer must say so rather than paint a
// dispatch that did not happen.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Tasks } from './Tasks';
import { STR } from './Tasks.strings';

const en = (k: keyof typeof STR) => STR[k].en;

const TASK = {
  id: 'task-1',
  projectId: null,
  title: 'Draft the specification',
  description: 'first cut of the spec',
  status: 'active',
  priority: 'high',
  assignedAgentId: 'a-1',
  dueAt: null,
  position: 1,
  createdAt: '1700000000000',
  updatedAt: '1700000000000',
  completedAt: null,
};

const AGENTS = [
  { id: 'a-1', slug: 'boundary-auditor', displayName: 'Boundary Auditor', role: 'auditor', status: 'idle', model: null, createdAt: '0', updatedAt: '0' },
  { id: 'a-2', slug: 'evidence-verifier', displayName: 'Evidence Verifier', role: 'verifier', status: 'idle', model: null, createdAt: '0', updatedAt: '0' },
];

function setup(onDispatch?: (args: unknown) => Promise<unknown>) {
  invokeMock.mockImplementation((cmd: string, args: unknown) => {
    if (cmd === 'list_tasks') return Promise.resolve([TASK]);
    if (cmd === 'list_projects') return Promise.resolve([]);
    if (cmd === 'list_agents') return Promise.resolve(AGENTS);
    if (cmd === 'list_task_dependencies') return Promise.resolve([]);
    if (cmd === 'dispatch_task_contract') {
      // The real build has no such command; Tauri rejects an unknown one.
      return onDispatch
        ? onDispatch(args)
        : Promise.reject(new Error('Command dispatch_task_contract not found'));
    }
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Tasks />
      </ToastProvider>
    </AppProvider>,
  );
}

async function openComposer() {
  setup();
  await screen.findByText('Draft the specification');
  fireEvent.click(screen.getByRole('button', { name: `${en('dispatch')}: ${TASK.title}` }));
  return screen.findByRole('dialog');
}

/** Fill the composer with a grant that clears every pre-flight check. */
function fillValidGrant() {
  fireEvent.change(screen.getByLabelText(en('fPack')), { target: { value: 'architecture-audit' } });
  fireEvent.change(screen.getByLabelText(en('fScope')), { target: { value: 'apps/desktop/src/features' } });
  fireEvent.change(screen.getByLabelText(en('fSkills')), { target: { value: 'analysis-primary' } });
  fireEvent.change(screen.getByLabelText(en('fDone')), { target: { value: 'the spec is reviewed' } });
  fireEvent.change(screen.getByLabelText(en('fRollback')), { target: { value: 'discard the branch' } });
}

beforeEach(() => invokeMock.mockReset());

describe('Tasks — a dispatch produces a real contract-shaped assignment', () => {
  it('opens a composer that names the chosen agent definition and its real tool list', async () => {
    const dialog = await openComposer();
    // The capability half: the file that actually decides the tools.
    expect(within(dialog).getByText('.claude/agents/reader.md')).toBeTruthy();
    // The narrowest tier is the default grant, so Bash/Edit must NOT be in it.
    expect(within(dialog).getByText('Read')).toBeTruthy();
    expect(within(dialog).queryByText('Edit')).toBeNull();

    fireEvent.change(screen.getByLabelText(en('fTier')), { target: { value: 'builder' } });
    await waitFor(() => expect(within(dialog).getByText('Edit')).toBeTruthy());
    expect(within(dialog).getByText('.claude/agents/builder.md')).toBeTruthy();
  });

  it('says plainly that the draft is not a sealed contract', async () => {
    const dialog = await openComposer();
    expect(within(dialog).getByText(en('draftWarning'))).toBeTruthy();
    // The draft must never claim a repository binding it cannot observe.
    expect(within(dialog).queryByText(/base_commit: [0-9a-f]{40}/)).toBeNull();
  });

  it('refuses to send an incomplete draft, and says which contract fields are missing', async () => {
    const dialog = await openComposer();
    const problems = within(dialog).getByRole('alert');
    expect(within(problems).getByText('pack_id')).toBeTruthy();
    expect(within(problems).getByText('core_skills')).toBeTruthy();
    expect(within(problems).getByText('scope')).toBeTruthy();

    const send = within(dialog).getByRole('button', { name: en('dispatch') });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(send);
    expect(invokeMock.mock.calls.some((c) => c[0] === 'dispatch_task_contract')).toBe(false);
  });

  it('reports the missing backend as NOT dispatched, never as accepted', async () => {
    const dialog = await openComposer();
    fillValidGrant();
    await waitFor(() => expect(within(dialog).getByText(en('wellFormed'))).toBeTruthy());

    fireEvent.click(within(dialog).getByRole('button', { name: en('dispatch') }));

    await waitFor(() => expect(within(dialog).getByText(en('outUnreachable'))).toBeTruthy());
    // The honest state, and what it would take to change it.
    expect(within(dialog).getByText(/Command dispatch_task_contract not found/)).toBeTruthy();
    expect(within(dialog).getByText(/dispatch_task_contract` Tauri command/)).toBeTruthy();
    // Nothing may read as accepted.
    expect(within(dialog).queryByText(en('outAccepted'))).toBeNull();
  });

  it('sends the contract-shaped frame the engine would receive', async () => {
    const dialog = await openComposer();
    fillValidGrant();
    await waitFor(() => expect(within(dialog).getByText(en('wellFormed'))).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: en('dispatch') }));

    await waitFor(() => expect(
      invokeMock.mock.calls.some((c) => c[0] === 'dispatch_task_contract'),
    ).toBe(true));

    const call = invokeMock.mock.calls.find((c) => c[0] === 'dispatch_task_contract');
    const req = (call?.[1] as { request: Record<string, unknown> }).request;
    const draft = req.contract_draft as Record<string, unknown>;
    expect(req.agent_definition).toBe('reader');
    expect(draft.agent_id).toBe('boundary-auditor');   // the real roster identity
    expect(draft.assignee_role).toBe('auditor');       // the real role
    expect(draft.pack_id).toBe('architecture-audit');
    expect(draft.mode).toBe('review');
    expect(draft.risk).toBe('low');
    expect(draft.scope).toEqual(['apps/desktop/src/features']);
    expect('repository' in draft).toBe(false);
  });

  it('will not render an engine reply as accepted unless it is a complete accepted frame', async () => {
    // A backend that says "accepted" but pins nothing — no lease, no digest, no sealed
    // repository — must not produce a green state.
    setup(async () => ({
      protocol: 'brops.agent-dispatch-result.v1',
      status: 'accepted',
      client_request_id: 'whatever',
    }));
    await screen.findByText('Draft the specification');
    fireEvent.click(screen.getByRole('button', { name: `${en('dispatch')}: ${TASK.title}` }));
    const dialog = await screen.findByRole('dialog');
    fillValidGrant();
    await waitFor(() => expect(within(dialog).getByText(en('wellFormed'))).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: en('dispatch') }));

    await waitFor(() => expect(within(dialog).getByText(en('outUnreachable'))).toBeTruthy());
    expect(within(dialog).queryByText(en('outAccepted'))).toBeNull();
  });

  it('renders an accepted dispatch only with the lease, digest and sealed binding', async () => {
    const digest = 'a'.repeat(64);
    const commit = 'b'.repeat(40);
    setup(async (args) => ({
      protocol: 'brops.agent-dispatch-result.v1',
      status: 'accepted',
      client_request_id: (args as { request: { client_request_id: string } }).request.client_request_id,
      assignment_id: 'asg-7',
      contract_digest: digest,
      lease_id: 'lease-7',
      repository: {
        full_name: 'menq-official/os', branch: 'wave/phase-push-1', worktree: '/repo',
        base_commit: commit, tree_identity: digest,
      },
    }));
    await screen.findByText('Draft the specification');
    fireEvent.click(screen.getByRole('button', { name: `${en('dispatch')}: ${TASK.title}` }));
    const dialog = await screen.findByRole('dialog');
    fillValidGrant();
    await waitFor(() => expect(within(dialog).getByText(en('wellFormed'))).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: en('dispatch') }));

    await waitFor(() => expect(within(dialog).getByText(en('outAccepted'))).toBeTruthy());
    expect(within(dialog).getByText('asg-7')).toBeTruthy();
    expect(within(dialog).getByText('lease-7')).toBeTruthy();
    expect(within(dialog).getByText(commit)).toBeTruthy();
  });
});

// Four places where the page said something about the roster or the dependencies that the
// read behind it had not said (R3-0267, R3-0268, R3-0269, R3-0270).
describe('Tasks — the roster and the dependencies are read, not assumed', () => {
  const mountWith = (over: Record<string, () => Promise<unknown>>, task: Record<string, unknown> = TASK) => {
    invokeMock.mockImplementation((cmd: string) => {
      if (over[cmd]) return over[cmd]();
      if (cmd === 'list_tasks') return Promise.resolve([task]);
      if (cmd === 'list_projects') return Promise.resolve([]);
      if (cmd === 'list_agents') return Promise.resolve(AGENTS);
      if (cmd === 'list_task_dependencies') return Promise.resolve([]);
      if (cmd === 'dispatch_task_contract') return Promise.reject(new Error('Command dispatch_task_contract not found'));
      return Promise.resolve(null);
    });
    return render(<AppProvider><ToastProvider><Tasks /></ToastProvider></AppProvider>);
  };
  const open = async () => {
    await screen.findByText('Draft the specification');
    fireEvent.click(screen.getByRole('button', { name: `${en('dispatch')}: ${TASK.title}` }));
    return screen.findByRole('dialog');
  };

  it('the card names the assignee from the roster, not by internal id', async () => {
    mountWith({});
    await waitFor(() => expect(document.querySelector('.mt-own')?.textContent).toBe('Boundary Auditor'));
  });

  it('an assignee the roster does not list is shown by the id the task carries', async () => {
    mountWith({}, { ...TASK, assignedAgentId: 'a-gone' });
    await screen.findByText('Draft the specification');
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === 'list_agents')).toBe(true));
    await waitFor(() => expect(document.querySelector('.mt-own')?.textContent).toBe('a-gone'));
  });

  it('a roster that could not be read is not called an empty roster', async () => {
    mountWith({ list_agents: () => Promise.reject(new Error('roster store locked')) });
    const dialog = await open();
    expect(within(dialog).queryByText(en('noAgents'))).toBeNull();
    expect(within(dialog).getByText(en('rosterUnread'))).toBeTruthy();
    expect(within(dialog).getByText(/roster store locked/)).toBeTruthy();
  });

  it('an empty roster that WAS read still says so', async () => {
    mountWith({ list_agents: () => Promise.resolve([]) });
    const dialog = await open();
    await waitFor(() => expect(within(dialog).getByText(en('noAgents'))).toBeTruthy());
    expect(within(dialog).queryByText(en('rosterUnread'))).toBeNull();
  });

  it('a roster that arrives after the composer opened fills the agent the select shows', async () => {
    let arrive: (v: unknown) => void = () => {};
    mountWith({ list_agents: () => new Promise((ok) => { arrive = ok; }) });
    const dialog = await open();
    // Still loading: neither "nobody to dispatch to" nor a failed read.
    expect(within(dialog).queryByText(en('noAgents'))).toBeNull();
    expect(within(dialog).queryByText(en('rosterUnread'))).toBeNull();
    await act(async () => { arrive(AGENTS); await Promise.resolve(); });
    fillValidGrant();
    await waitFor(() => expect(within(dialog).getByText(en('wellFormed'))).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: en('dispatch') }));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === 'dispatch_task_contract')).toBe(true));
    const call = invokeMock.mock.calls.find((c) => c[0] === 'dispatch_task_contract');
    const draft = (call?.[1] as { request: { contract_draft: Record<string, unknown> } }).request.contract_draft;
    // The task's own assignee, which is also what the select was showing.
    expect(draft.agent_id).toBe('boundary-auditor');
  });

  it('a failed dependency read is not "No dependencies" — on the card or in the edit form', async () => {
    mountWith(
      { list_task_dependencies: () => Promise.reject(new Error('deps table locked')) },
      { ...TASK, status: 'blocked' },
    );
    await screen.findByText('Draft the specification');
    const card = document.querySelector('article.mtask') as HTMLElement;
    await waitFor(() => expect(within(card).getByText(new RegExp(en('depsUnread')))).toBeTruthy());
    expect(within(card).queryByText('No dependencies')).toBeNull();

    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(new RegExp(en('depsUnread')))).toBeTruthy());
    expect(within(dialog).queryByText('No dependencies')).toBeNull();
    expect(within(dialog).getByText(/deps table locked/)).toBeTruthy();
  });

  it('the edit form does not say "No dependencies" while the read is still out', async () => {
    mountWith({ list_task_dependencies: () => new Promise(() => {}) });
    await screen.findByText('Draft the specification');
    const card = document.querySelector('article.mtask') as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('No dependencies')).toBeNull();
  });

  it('the page has one top-level heading', async () => {
    mountWith({});
    await screen.findByText('Draft the specification');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

// Found while testing R3-0239, not in the read: `FormRow` is a <label>, and three of its
// forty-seven uses wrap BUTTONS. A label forwards a click on its text to its first control —
// so clicking the word "Dependencies" pressed the first Remove.
describe('Tasks — clicking a form row\'s label does not press a button inside it', () => {
  it('the Dependencies label does not remove the first dependency', async () => {
    const user = userEvent.setup();
    const BLOCKER = { ...TASK, id: 'task-0', title: 'Agree the scope', status: 'active' };
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_tasks') return Promise.resolve([{ ...TASK, status: 'blocked' }, BLOCKER]);
      if (cmd === 'list_projects') return Promise.resolve([]);
      if (cmd === 'list_agents') return Promise.resolve(AGENTS);
      if (cmd === 'list_task_dependencies') return Promise.resolve([BLOCKER]);
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Tasks /></ToastProvider></AppProvider>);
    await screen.findAllByText('Draft the specification');
    const card = [...document.querySelectorAll('article.mtask')]
      .find((c) => c.textContent?.includes('Draft the specification')) as HTMLElement;
    card.focus();
    fireEvent.keyDown(card, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog');
    // By text: inside the <label> the first button's accessible name was the whole row.
    await within(dialog).findByText('Remove');

    await user.click(within(dialog).getByText('Dependencies'));
    expect(invokeMock.mock.calls.some((c) => c[0] === 'remove_task_dependency')).toBe(false);
    // And the group is still named for what it holds.
    expect(within(dialog).getByRole('group', { name: 'Dependencies' })).toBeTruthy();
    // Each control inside it has its own name again.
    expect(within(dialog).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Choose a blocking task…' })).toBeTruthy();
  });
});
