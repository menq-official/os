import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

// Mock the Tauri IPC boundary. Knowledge issues TWO reads of the real store and renders only what
// they return: `search_knowledge` is the article list, `list_knowledge` is the store total and
// the collections.
const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: class {},
}));

import { AppProvider } from '../app/store';
import { ToastProvider } from '../components/toast';
import { Knowledge } from './Knowledge';
import { STR } from './Knowledge.strings';

const SEARCHED = { id: 'k-1', title: 'Onboarding notes', body: 'welcome', source: 'internal', tags: 'hr', createdAt: '1700000000000', updatedAt: '1700000000000' };
const ONLY_IN_FULL_LIST = { id: 'k-2', title: 'Rotation runbook', body: 'keys', source: '', tags: 'ops', createdAt: '1700000000000', updatedAt: '1700000000000' };

// The two reads answer DIFFERENTLY, so each assertion below can only be met by the read it names.
// They used to answer with the same row, and the one call assertion named `search_knowledge` under
// a title that said `list_knowledge`: a page that never issued the second read passed.
function setup() {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === 'search_knowledge') return Promise.resolve([SEARCHED]);
    if (cmd === 'list_knowledge') return Promise.resolve([SEARCHED, ONLY_IN_FULL_LIST]);
    return Promise.resolve(null);
  });
  return render(
    <AppProvider>
      <ToastProvider>
        <Knowledge />
      </ToastProvider>
    </AppProvider>,
  );
}

const called = (cmd: string) => invokeMock.mock.calls.some((c) => c[0] === cmd);

beforeEach(() => invokeMock.mockReset());

describe('Knowledge — mirrors the real knowledge store through its two reads', () => {
  it('lists the rows search_knowledge returned, and only those', async () => {
    setup();
    await waitFor(() => expect(document.querySelectorAll('.kb-row')).toHaveLength(1));
    expect(called('search_knowledge')).toBe(true);
    expect(document.querySelector('.kb-row-title')!.textContent).toBe('Onboarding notes');
    expect(screen.queryByText('Rotation runbook')).not.toBeInTheDocument();
  });

  it('takes the store total and the collections from list_knowledge', async () => {
    setup();
    await waitFor(() => expect(document.querySelectorAll('.kb-chip')).toHaveLength(3));
    expect(called('list_knowledge')).toBe(true);
    // One row listed, of the two the full read counted.
    expect(document.querySelector('.kb-browser .sec-head .note')!.textContent).toBe('1 / 2 nodes');
    // `#ops` exists only in the full list: the search read never returned that note.
    const chips = Array.from(document.querySelectorAll('.kb-chip-name')).map((c) => c.textContent);
    expect(chips).toEqual([STR.allArticles.en, '#hr', '#ops']);
  });
});
