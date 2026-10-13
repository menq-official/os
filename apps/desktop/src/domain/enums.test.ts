import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  statusTone,
  TASK_STATUSES,
  PRIORITIES,
  PROJECT_STATUSES,
  MEMORY_KINDS,
  RUN_STATUSES,
  INTEGRATION_STATUSES,
  STEP_STATUSES,
  APPROVAL_STATUSES,
  eventKindTone,
  DECISION_STATUSES,
  DECISION_STATUS_FAMILY,
  type Tone,
} from './enums';
import { statusLabel } from './statusLabels';

/** Pure data/vocabulary tests — no React, no Tauri, no context. */

describe('statusTone map', () => {
  it('maps representative statuses to the expected visual tone', () => {
    expect(statusTone.inbox).toBe('neutral');
    expect(statusTone.active).toBe('accent');
    expect(statusTone.running).toBe('accent');
    expect(statusTone.blocked).toBe('danger');
    expect(statusTone.review).toBe('warning');
    expect(statusTone.done).toBe('success');
    expect(statusTone.succeeded).toBe('success');
    expect(statusTone.failed).toBe('danger');
    expect(statusTone.awaiting_approval).toBe('warning');
    expect(statusTone.pending).toBe('warning');
    expect(statusTone.approved).toBe('success');
    expect(statusTone.rejected).toBe('danger');
    expect(statusTone.connected).toBe('success');
    expect(statusTone.critical).toBe('danger');
  });

  it('only uses tones from the Tone union', () => {
    const allowed: Tone[] = ['neutral', 'accent', 'success', 'warning', 'danger', 'info'];
    for (const tone of Object.values(statusTone)) {
      expect(allowed).toContain(tone);
    }
  });

  it('returns undefined for an unmapped status (caller falls back to neutral)', () => {
    expect(statusTone['definitely_not_a_status']).toBeUndefined();
  });
});

describe('value lists', () => {
  it('TASK_STATUSES contains the canonical task statuses in order', () => {
    expect(TASK_STATUSES).toEqual([
      'inbox',
      'planned',
      'active',
      'blocked',
      'review',
      'done',
      'cancelled',
    ]);
  });

  it('PRIORITIES contains the canonical priorities', () => {
    expect(PRIORITIES).toEqual(['low', 'normal', 'high', 'critical']);
  });

  it('PROJECT_STATUSES contains the canonical project statuses', () => {
    expect(PROJECT_STATUSES).toEqual(['planned', 'active', 'blocked', 'completed', 'archived']);
  });

  it('MEMORY_KINDS contains the canonical memory kinds', () => {
    expect(MEMORY_KINDS).toEqual(['fact', 'preference', 'note', 'reference']);
  });

  it('RUN_STATUSES contains the canonical run statuses', () => {
    expect(RUN_STATUSES).toEqual([
      'drafted',
      'queued',
      'planning',
      'awaiting_approval',
      'running',
      'paused',
      'succeeded',
      'failed',
      'cancelled',
    ]);
  });

  it('INTEGRATION_STATUSES and STEP_STATUSES expose their allowed sets', () => {
    expect(INTEGRATION_STATUSES).toEqual(['disconnected', 'connected', 'error']);
    expect(STEP_STATUSES).toEqual(['pending', 'active', 'done', 'failed', 'skipped']);
  });

  it('every value list has a tone mapping where a status is display-facing', () => {
    // Task, project and run statuses are surfaced via StatusPill, so each must
    // resolve to a defined tone (guards against a status added without a tone).
    for (const status of [...TASK_STATUSES, ...PROJECT_STATUSES, ...RUN_STATUSES]) {
      expect(statusTone[status], `missing tone for "${status}"`).toBeDefined();
    }
  });
});

// R3-0216: the approval status type listed `expired` and `cancelled`, which the database
// refuses, and omitted `consumed` and `escalated`, which it admits. The list is now a value,
// so it can be held to the trigger that decides.
describe('approval statuses are the ones the database admits', () => {
  it('equals the set in the latest approvals status guard', () => {
    const dir = resolve(process.cwd(), 'src-tauri/core/schema');
    let admitted: string[] | null = null;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const sql = readFileSync(resolve(dir, file), 'utf8');
      const m = /CREATE TRIGGER[^;]*trg_approvals_status_ins BEFORE INSERT ON approvals\s+WHEN NEW\.status NOT IN \(([^)]*)\)/
        .exec(sql);
      // A later migration replaces the guard; the last definition is the one in force.
      if (m) admitted = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
    expect(admitted, 'no approvals status guard was found in the schema').not.toBeNull();
    expect([...APPROVAL_STATUSES].sort()).toEqual([...admitted!].sort());
  });
});

// R3-0217 / R3-0218: a status the code DECLARES rendered through two fallbacks — a neutral
// pill, and its raw English word in Armenian and Russian.
describe('every declared status has a tone and a label', () => {
  const declared = [
    ...TASK_STATUSES, ...PROJECT_STATUSES, ...RUN_STATUSES, ...STEP_STATUSES,
    ...INTEGRATION_STATUSES, ...DECISION_STATUSES, ...APPROVAL_STATUSES, 'expired',
  ];

  it('has a tone', () => {
    for (const status of declared) {
      expect(statusTone[status], `missing tone for "${status}"`).toBeDefined();
    }
  });

  it('a decision pill agrees with the family the Decisions page puts the row in', () => {
    const TONE_OF_FAMILY = { waiting: 'warning', settled: 'neutral', blocked: 'danger' } as const;
    for (const status of DECISION_STATUSES) {
      expect(statusTone[status], status).toBe(TONE_OF_FAMILY[DECISION_STATUS_FAMILY[status]]);
    }
  });

  it('has a label in Armenian and in Russian, not the raw word', () => {
    for (const status of declared) {
      const en = statusLabel(status, 'en');
      expect(statusLabel(status, 'hy'), `hy label for "${status}"`).not.toBe(en);
      expect(statusLabel(status, 'ru'), `ru label for "${status}"`).not.toBe(en);
    }
  });
});

// R3-0232: an event's kind was looked up in the task/run status table.
describe('an event kind is not coloured as a status', () => {
  it('a kind that happens to be a status word gets no status colour', () => {
    expect(eventKindTone('review')).toBe('accent');
    for (const kind of ['blocked', 'done', 'failed', 'pending', 'critical']) {
      expect(eventKindTone(kind), kind).toBe('neutral');
    }
  });

  it('the kinds the app has labels for keep the accent, and an unknown one is neutral', () => {
    for (const kind of ['event', 'meeting', 'ops', 'maintenance']) expect(eventKindTone(kind), kind).toBe('accent');
    expect(eventKindTone('offsite')).toBe('neutral');
  });
});
