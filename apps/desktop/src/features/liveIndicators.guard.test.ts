/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';

/**
 * Regression guard for the "always-on live indicator" class of defect.
 *
 * `.wire.live` animates a travelling pulse and `.pill.live` / `<Mark state="live">`
 * paint the green "running" affordance. Roughly fifteen of these were hard-coded as
 * string literals across the feature pages, so they rendered identically on an error,
 * on an empty result, and with zero connected — decoration pretending to be telemetry.
 *
 * A live affordance must be derived from real state, i.e. written as a template
 * expression (`` `wire${x ? ' live' : ''}` ``), not as a literal. This test fails on any
 * NEW hard-coded literal so the class of defect cannot quietly return.
 *
 * The allowed literals are the `ALLOWED` table below, each with the number of times its
 * file may hold it; every one is an unconditional fact or already sits behind a branch,
 * rather than a claim about backend state.
 *
 * The scan covers every production `.tsx` under `features/`, `components/` and `app/`, at
 * any depth. Test and spec files are left out: they plant these literals on purpose.
 */
const sources = import.meta.glob(
  ['../{features,components,app}/**/*.tsx', '!**/*.test.tsx', '!**/*.spec.tsx'],
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>;

const WIRE = 'className="wire live"';
const PILL = 'className="pill live"';
const MARK = '<Mark state="live">';

/**
 * Count the hard-coded live affordances in one source text. Each is a claim rendered in
 * every state.
 *
 * A class list is read as a set of tokens, so `"pill live lg"` and `{'pill live'}` count
 * the same as `"pill live"`. `MARK` covers both `<Mark state="live">` and the library's own
 * `<LiveMark state="live">`, with the prop in any position and in either quoting.
 */
function literalHits(src: string): Record<string, number> {
  const hits = { [WIRE]: 0, [PILL]: 0, [MARK]: 0 };
  for (const m of src.matchAll(/className=\{?\s*(["'])([^"'`]*)\1/g)) {
    const classes = m[2].split(/\s+/);
    if (!classes.includes('live')) continue;
    if (classes.includes('wire')) hits[WIRE] += 1;
    if (classes.includes('pill')) hits[PILL] += 1;
  }
  hits[MARK] = src.match(/<(?:Live)?Mark\b[^>]*?\bstate=\{?\s*(["'])live\1/g)?.length ?? 0;
  return hits;
}

/**
 * Deliberate exceptions, reviewed one by one. The number is how many such literals the
 * file holds today; one more is a new literal and fails, and an entry no literal answers
 * to fails as well.
 *
 *  - `Shell.tsx` — the "o" of the BroPS wordmark in the sidebar. Brand typography with
 *    `size={0}`, not a state indicator; it asserts nothing about any backend.
 *  - `Tasks.tsx` — `pill live` for "path clear" is inside the `blocked === 0` arm of a
 *    ternary, so the literal is already gated on a real derived count.
 *  - `Agents.tsx` — `pill live` for "dispatch channel present" is inside the
 *    `channel.state === 'present'` arm, reached only after a probe genuinely answered.
 *    Same shape as `Tasks.tsx`: this scan reads text, so it cannot see the branch the
 *    literal already sits behind.
 */
const ALLOWED: Record<string, Record<string, number>> = {
  'Shell.tsx': { [MARK]: 1 },
  'Tasks.tsx': { [PILL]: 1 },
  'Agents.tsx': { [PILL]: 1 },
};

/** Glob keys are relative to this file; compare on the file name alone. */
const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Every file whose literal count differs from what `allowed` records for it. */
function offendersIn(
  files: Record<string, string>,
  allowed: Record<string, Record<string, number>>,
): string[] {
  const offenders: string[] = [];
  for (const [path, src] of Object.entries(files)) {
    const expected = allowed[basename(path)] ?? {};
    for (const [what, hits] of Object.entries(literalHits(src))) {
      if (hits !== (expected[what] ?? 0)) {
        offenders.push(`${path}: ${hits}× ${what}, ${expected[what] ?? 0} allowed`);
      }
    }
  }
  return offenders;
}

describe('no page hard-codes an always-on live indicator', () => {
  it('discovers the production view sources, at any depth, and no test file', () => {
    const keys = Object.keys(sources);
    // A key is relative to this file, so a page beside it is `./Name.tsx`.
    expect(keys).toContain('./Tasks.tsx');
    expect(keys).toContain('../components/Shell.tsx');
    expect(keys).toContain('../components/charts/Chart.tsx');
    expect(keys.filter((k) => /\.(test|spec)\.tsx$/.test(k))).toEqual([]);
  });

  it('every live affordance is derived from real state, not a literal', () => {
    expect(
      offendersIn(sources, ALLOWED),
      'Bind each of these to its real state (e.g. `wire${x ? \' live\' : \'\'}`) or drop the claim',
    ).toEqual([]);
  });

  it('every allow-list entry answers to a literal that is really there', () => {
    const byName = new Map(Object.entries(sources).map(([p, src]) => [basename(p), src]));
    const stale: string[] = [];
    for (const [file, entries] of Object.entries(ALLOWED)) {
      const hits = literalHits(byName.get(file) ?? '');
      for (const [what, count] of Object.entries(entries)) {
        if (hits[what] !== count) stale.push(`${file}: ${what} allowed ${count}×, found ${hits[what]}×`);
      }
    }
    expect(stale).toEqual([]);
  });
});

describe('the scan sees the literals it is there to refuse', () => {
  it('sees the library\'s own live primitive', () => {
    expect(literalHits('<LiveMark state="live" />')[MARK]).toBe(1);
    expect(literalHits('<LiveMark label="x" state="live" />')[MARK]).toBe(1);
    expect(literalHits("<Mark state={'live'} size={0} />")[MARK]).toBe(1);
  });

  it('sees a live class beside other classes, in either quoting', () => {
    expect(literalHits('<span className="pill live lg">')[PILL]).toBe(1);
    expect(literalHits('<span className="pill lg live">')[PILL]).toBe(1);
    expect(literalHits("<span className={'wire live'}>")[WIRE]).toBe(1);
  });

  it('does not count a derived class, another state, or a class that merely contains the word', () => {
    const derived = [
      "<span className={`wire${on ? ' live' : ''}`} />",
      '<span className="pill" />',
      '<div className="intg-live" role="status" aria-live="polite" />',
      '<LiveMark state={state} />',
      '<LiveMark state="offline" />',
    ].join('\n');
    expect(literalHits(derived)).toEqual({ [WIRE]: 0, [PILL]: 0, [MARK]: 0 });
  });

  it('refuses a second literal in a file that is allowed one', () => {
    const one = '<span className="pill live">a</span>';
    expect(offendersIn({ '../features/Tasks.tsx': one }, ALLOWED)).toEqual([]);
    expect(offendersIn({ '../features/Tasks.tsx': `${one}\n${one}` }, ALLOWED)).toEqual([
      `../features/Tasks.tsx: 2× ${PILL}, 1 allowed`,
    ]);
  });

  it('refuses a literal in a file that is allowed none', () => {
    expect(offendersIn({ '../features/Home.tsx': '<div className="wire live" />' }, ALLOWED)).toEqual([
      `../features/Home.tsx: 1× ${WIRE}, 0 allowed`,
    ]);
  });
});
