import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the Tauri IPC boundary. Integrations mirrors the real list_integrations store; it renders only
// what the store returns and never fabricates an entry.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Integrations } from './Integrations';
import { STR } from './Integrations.strings';

const row = (id: string, name: string, provider: string, status: string) => ({
  id, name, provider, status, createdAt: '1700000000000', updatedAt: '1700000000000',
});

function setup(rows: ReturnType<typeof row>[]) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'list_integrations') return Promise.resolve(rows);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Integrations />
      </ToastProvider>
    </AppProvider>,
  );
}

/** The catalog rows on screen, as "name/provider". */
const catalog = () => screen.queryAllByRole('listitem')
  .filter((li) => li.querySelector('.creg-row'))
  .map((li) => `${li.querySelector('.cr-main b')?.textContent}/${li.querySelector('.cr-main .micro')?.textContent}`)
  .sort();

beforeEach(() => invokeMock.mockReset());

// The file's one test waited for 'GitHub' and then asserted that list_integrations had been
// called — which the nosecret suite's positive control already does, and which cannot fail once
// the row is on screen. What the header promises, and nothing else pinned, is the mirror itself:
// the catalog holds the store's rows, all of them and no others.
describe('Integrations — mirrors the real list_integrations store', () => {
  it('shows exactly the rows the store returned, whatever their status', async () => {
    setup([
      row('in-1', 'GitHub', 'github', 'connected'),
      row('in-2', 'Slack', 'slack', 'disconnected'),
      row('in-3', 'Mail', 'smtp', 'error'),
      row('in-4', 'Odd', 'custom', 'a-status-this-build-does-not-know'),
    ]);
    await waitFor(() => expect(catalog()).toHaveLength(4));
    expect(catalog()).toEqual(['GitHub/github', 'Mail/smtp', 'Odd/custom', 'Slack/slack']);
  });

  it('an empty store is an empty catalog that says so, not a sample row', async () => {
    setup([]);
    await waitFor(() => expect(screen.getByText(STR.noIntegrations.en)).toBeInTheDocument());
    expect(catalog()).toEqual([]);
    expect(document.querySelector('.creg-row')).toBeNull();
  });
});
