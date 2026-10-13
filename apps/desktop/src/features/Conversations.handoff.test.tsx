import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// The group-chat rail's HANDOFFS readout (Phase 7) is a real, transcript-derived chain of
// who handed off to whom — the ordered distinct consecutive speakers — never fabricated.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Conversations } from './Conversations';
import { STR } from './Conversations.strings';

const ROOM = {
  id: 'g-1', kind: 'group', title: 'Design room', messageCount: 4,
  lastMessageAt: '1700000000000', createdAt: '1700000000000', updatedAt: '1700000000000',
};
const msg = (id: string, author: string, role: string, body: string) => ({
  id, conversationId: 'g-1', role, author, body, createdAt: '1700000000000', receipt: null,
});
// Gev → Scout (twice, same speaker = one node) → Analyst  ⇒ chain [Gev, Scout, Analyst], 2 handoffs.
const MSGS = [
  msg('m-1', 'Gev', 'user', 'kick off the redesign'),
  msg('m-2', 'Scout', 'agent', 'gathering references'),
  msg('m-3', 'Scout', 'agent', 'found three directions'),
  msg('m-4', 'Analyst', 'agent', 'scoring them now'),
];
const agent = (slug: string, name: string) => ({
  id: slug, slug, displayName: name, role: 'specialist', status: 'active', model: null,
  createdAt: '1700000000000', updatedAt: '1700000000000',
});

function setup() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_conversations') return Promise.resolve([ROOM]);
    if (cmd === 'list_messages') return Promise.resolve(MSGS);
    if (cmd === 'list_agents') return Promise.resolve([agent('scout', 'Scout'), agent('analyst', 'Analyst')]);
    if (cmd === 'list_conversation_participants') return Promise.resolve([]);
    if (cmd === 'ai_status') return Promise.resolve({ provider: 'claude-cli', model: 'm', ready: true, detail: 'ok', governed: false });
    if (cmd === 'search_all') return Promise.resolve([]);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Conversations kind="group" />
      </ToastProvider>
    </AppProvider>,
  );
}

beforeEach(() => invokeMock.mockReset());

describe('Group chat handoffs — real transcript-derived chain', () => {
  it('shows the distinct consecutive speakers and the handoff count', async () => {
    setup();
    fireEvent.click((await screen.findAllByText('Design room'))[0]);

    // The HANDOFFS readout renders the chain Gev → Scout → Analyst (Scout collapsed to one node).
    const chain = await screen.findByRole('list', { name: /HANDOFFS/i });
    expect(within(chain).getByText('Gev')).toBeInTheDocument();
    expect(within(chain).getByText('Scout')).toBeInTheDocument();
    expect(within(chain).getByText('Analyst')).toBeInTheDocument();
    // 3 distinct nodes ⇒ exactly 2 handoffs (speaker changes).
    expect(within(chain).getAllByRole('listitem')).toHaveLength(3);
  });
});

// Two controls carried another control's name. The message log was `aria-label` "Conversations" —
// the name of the conversation rail beside it — and the "@" button was "Reply as", the name of
// the agent select. A screen-reader user met two things called the same in each pair.
describe('the chat\'s log and its mention button have their own names', () => {
  it('the message log is not named after the conversation list', async () => {
    setup();
    const log = await screen.findByRole('log');
    await waitFor(() => expect(log).toHaveAccessibleName('Messages'));
    expect(log).not.toHaveAccessibleName('Conversations');
  });

  it('the "@" button says what it does', async () => {
    const { container } = setup();
    await screen.findByRole('log');
    const at = await waitFor(() => {
      const found = container.querySelector('button.comp-at');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(at).toHaveAccessibleName('Mention an agent');
    expect(at).not.toHaveAccessibleName('Reply as');
  });
});

// R3-0239: a new room is created, then its roster is written. When the second write failed the
// room existed without the people chosen for it, and the only place that said so was the
// console — which the owner does not read.
describe('Group chat — a roster that was not saved is said on the page', () => {
  const createRoom = async (participants: () => Promise<unknown>) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_conversations') return Promise.resolve([ROOM]);
      if (cmd === 'list_messages') return Promise.resolve(MSGS);
      if (cmd === 'list_agents') return Promise.resolve([agent('scout', 'Scout'), agent('analyst', 'Analyst')]);
      if (cmd === 'list_conversation_participants') return Promise.resolve([]);
      if (cmd === 'ai_status') return Promise.resolve({ provider: 'claude-cli', model: 'm', ready: true, detail: 'ok', governed: false });
      if (cmd === 'search_all') return Promise.resolve([]);
      if (cmd === 'create_conversation') return Promise.resolve({ ...ROOM, id: 'g-2', title: 'Launch room' });
      if (cmd === 'set_conversation_participants') return participants();
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Conversations kind="group" /></ToastProvider></AppProvider>);
    await screen.findAllByText('Design room');
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Launch room' } });
    // By its own name. The chips sat inside the form row's <label>, which gave the FIRST chip
    // the accessible name "Participants Scout Analyst"; the row is a group now.
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Scout' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(invokeMock.mock.calls.some((c) => c[0] === 'set_conversation_participants')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    errors.mockRestore();
  };

  it('names the failure and its reason, and says the room itself exists', async () => {
    await createRoom(() => Promise.reject(new Error('participants table locked')));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(STR.rosterFailedTitle.en);
    expect(alert).toHaveTextContent('participants table locked');
    // Not the OTHER failure: the conversation was created.
    expect(alert).not.toHaveTextContent(STR.createFailedTitle.en);
    // It is about THAT room. Starting another one takes the statement away, so it cannot be
    // read as being about the next room.
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    await screen.findByRole('dialog');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says nothing when the roster was saved', async () => {
    await createRoom(() => Promise.resolve(null));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
