import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// Mock the Tauri IPC boundary. Projects mirrors the real list_projects store and writes through
// three real commands — create_project, update_project and set_project_status. This file
// exercises the third, both outcomes; nothing is fabricated.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider, Toaster } from '../components/toast';
import { Projects } from './Projects';

const PROJECT = {
  id: 'p-1',
  workspaceId: null,
  name: 'Website revamp',
  description: 'Rebuild the marketing site',
  status: 'active',
  priority: 'high',
  createdAt: '1700000000000',
  updatedAt: '1700000000000',
  archivedAt: null,
};

/** A store that ACCEPTS a status change: the command updates the row, and the next
 *  `list_projects` returns it changed — the way the real store answers. */
function setup(initial: Record<string, unknown> = PROJECT) {
  let row = { ...initial };
  invokeMock.mockImplementation((cmd: string, args?: { status?: string }) => {
    if (cmd === 'list_projects') return Promise.resolve([{ ...row }]);
    if (cmd === 'list_tasks_by_project') return Promise.resolve([]);
    if (cmd === 'set_project_status') {
      row = { ...row, status: args!.status! };
      return Promise.resolve({ ...row });
    }
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Toaster />
        <Projects />
      </ToastProvider>
    </AppProvider>,
  );
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);
const callsOf = (cmd: string) => invokeMock.mock.calls.filter((c) => c[0] === cmd);

const statusSelect = () => waitFor(() => {
  const el = document.querySelector('.pd-statusrow select') as HTMLSelectElement | null;
  expect(el).not.toBeNull();
  return el as HTMLSelectElement;
});

beforeEach(() => invokeMock.mockReset());

describe('Projects — mirrors the real project store', () => {
  it('renders the real project from list_projects', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
    expect(called('list_projects')).toBe(true);
  });
});

// The success mock for `set_project_status` answered with status `done` — a TASK status, which no
// project can have — and no test ever changed a status against it: only the refusal was exercised.
describe('Projects — an accepted status change is sent, re-read and shown', () => {
  it('sends the id and the chosen status, re-reads the list, and raises no refusal', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Website revamp')[0]);
    const select = await statusSelect();
    expect(select.value).toBe('active');
    const readsBefore = callsOf('list_projects').length;

    fireEvent.change(select, { target: { value: 'completed' } });

    await waitFor(() => expect(callsOf('set_project_status')).toHaveLength(1));
    expect(callsOf('set_project_status')[0][1]).toEqual({ id: 'p-1', status: 'completed' });
    // The page shows what the store holds after the write, read back — not what it asked for.
    await waitFor(() => expect(callsOf('list_projects').length).toBeGreaterThan(readsBefore));
    await waitFor(() => expect((document.querySelector('.pd-statusrow select') as HTMLSelectElement).value).toBe('completed'));
    expect(document.querySelector('.pd-statusrow .pill')!.className).toBe('pill mint');
    expect(screen.queryByText(/Status not changed/)).not.toBeInTheDocument();
  });
});

// `setProjectStatus(...).then(onSaved).catch(onSaved)`: a rejection was discarded and the select
// simply snapped back on the reload.
describe('Projects — a refused status change says why', () => {
  it('surfaces the backend reason', async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'list_projects') return Promise.resolve([PROJECT]);
      if (cmd === 'list_tasks_by_project') return Promise.resolve([]);
      if (cmd === 'set_project_status') return Promise.reject(new Error('project p-1 has open tasks'));
      return Promise.resolve(null);
    });
    render(<AppProvider><ToastProvider><Toaster /><Projects /></ToastProvider></AppProvider>);
    await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText('Website revamp')[0]);

    const select = await statusSelect();
    fireEvent.change(select, { target: { value: 'completed' } });
    expect(await screen.findByText('Status not changed: project p-1 has open tasks')).toBeInTheDocument();
  });
});

// Project statuses had their own five strings, drifted from `domain/statusLabels.ts`, which the
// same page already used for task statuses: the Armenian for `completed` was `Թողարկված`
// ("released") for a project and `Ավարտված` for a task, side by side.
describe('Projects — one status vocabulary on the page', () => {
  it('labels a project status with the shared table, in Armenian too', async () => {
    localStorage.setItem('brops.lang', JSON.stringify('hy'));
    try {
      invokeMock.mockImplementation((cmd: string) => {
        if (cmd === 'list_projects') return Promise.resolve([{ ...PROJECT, status: 'completed' }]);
        if (cmd === 'list_tasks_by_project') return Promise.resolve([]);
        return Promise.resolve(null);
      });
      render(<AppProvider><ToastProvider><Projects /></ToastProvider></AppProvider>);
      await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
      expect(screen.getAllByText('Ավարտված').length).toBeGreaterThan(0);
      expect(screen.queryByText('Թողարկված')).not.toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/թողարկված/i);
    } finally {
      localStorage.removeItem('brops.lang');
    }
  });

  it('the page catalog carries no status labels of its own', async () => {
    const { STR } = await import('./Projects.strings');
    expect(Object.keys(STR).filter((k) => k.startsWith('st_'))).toEqual([]);
  });
});

// Two rules the page's own <style> block repeated from the shared stylesheets: `.pf-sr`, a copy of
// the visually-hidden rule (`.sr-only`, components/ui.css), and `.v-projects .pill.bad`, a copy of
// the foundation's danger pill (theme/aios.css) with the same three values.
describe('Projects — the page ships no copy of a shared rule', () => {
  const pageCss = () => document.querySelector('.v-projects > style')!.textContent ?? '';

  it('the selection announcer is classed `sr-only`, and no `.pf-sr` is declared', async () => {
    setup();
    await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
    const live = document.querySelector('.v-projects > span[aria-live="polite"]')!;
    expect(live).not.toBeNull();
    expect(live.classList.contains('sr-only')).toBe(true);
    expect(pageCss()).not.toMatch(/\.pf-sr\b/);
    expect(document.querySelector('.pf-sr')).toBeNull();
  });

  it('a blocked project is a `.pill.bad`, toned by the foundation rule and by no local one', async () => {
    setup({ ...PROJECT, status: 'blocked' });
    await waitFor(() => expect(screen.getAllByText('Website revamp').length).toBeGreaterThan(0));
    expect(document.querySelectorAll('.v-projects .pill.bad').length).toBeGreaterThan(0);
    expect(pageCss()).not.toMatch(/\.pill\.bad/);
    // The class is held to the stylesheet: the foundation must be the rule that tones it, with
    // the danger values the local copy carried.
    const aios = readFileSync(resolve(process.cwd(), 'src/theme/aios.css'), 'utf8');
    expect(aios).toContain(
      '.pill.bad{color:var(--danger);border-color:rgb(var(--danger-rgb)/.32);background:rgb(var(--danger-rgb)/.09)}',
    );
  });
});
