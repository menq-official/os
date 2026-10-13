import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { settleAnimations, unstyledClasses, styledClassTokens, reportUnstyled } from '../test/computedStyle';

/**
 * The design system's own vocabulary, measured — and the gap in `pages.browser.spec.tsx` that made
 * this file necessary.
 *
 * The page sweep measures 23 pages in three states. It cannot measure a state it has no way to
 * reach: Research's `saved` badge appears only after a governed run is saved, and that path is
 * blocked on every install the sweep can drive. So `pill success` — applied at
 * `Research.tsx`, defined by **no rule in any stylesheet** — sailed straight through a suite
 * written specifically to catch classes with no rules.
 *
 * Three more were in the same state when this was written: `pill ok` on Bridge's *"verified"*
 * outcome, `pill danger` on Research's failure, and `pill bad` on Projects' blocked count (that
 * one had a rule, scoped to `.v-agents`, so it applied everywhere except where Projects renders).
 * A verified outcome and a failed one computed to identical neutral pills.
 *
 * The lesson is the same one the page sweep already carries once: **a check only sees the states
 * it visits.** The answer is not to widen a static reader — the sixth audit's `A-03` is a worked
 * example of where that leads — it is to render the vocabulary DIRECTLY, in the browser, so the
 * tones are measured whether or not a page happens to reach them today.
 */

/** Every `pill` tone the app is allowed to use, and what each one means.
 *
 * Adding a row is how a tone joins the vocabulary; there is no way to use one that is not here
 * without this file going red, because the last assertion renders exactly this list. `ok` and
 * `danger` were folded into `success` and `bad` rather than given rules of their own — five names
 * for three colours is how the fourth one gets forgotten. */
const PILL_TONES: Array<[string, string]> = [
  ['live', 'this is running now'],
  ['success', 'this finished and it worked'],
  ['warn', 'this needs attention'],
  ['bad', 'this failed or is blocked'],
  ['info', 'neutral fact'],
  ['mint', 'a secondary accent used by the instrument surfaces'],
  ['off', 'present but inactive'],
];

describe('the pill tone vocabulary is styled, not just applied', () => {
  it('every declared tone is selected by a rule', () => {
    const { container } = render(
      <>
        {PILL_TONES.map(([tone]) => (
          <span key={tone} className={`pill ${tone}`}>{tone}</span>
        ))}
      </>,
    );
    const findings = unstyledClasses(container, styledClassTokens(), new Set());
    expect(findings, `\na pill tone the app applies is defined by no rule —\n`
      + `${reportUnstyled(findings)}\n`).toEqual([]);
  });

  it('each tone computes differently from the plain pill', async () => {
    // Stronger than "a rule exists": a rule that sets nothing visible would pass the check above.
    // `off` is excluded because it is defined as an opacity change on the BASE pill, which is the
    // one tone whose whole design is to look like the plain one, dimmed.
    const { container } = render(
      <>
        <span className="pill" id="plain">plain</span>
        {PILL_TONES.map(([tone]) => (
          <span key={tone} id={`t-${tone}`} className={`pill ${tone}`}>{tone}</span>
        ))}
      </>,
    );
    await settleAnimations();
    const plain = getComputedStyle(container.querySelector('#plain')!);
    for (const [tone] of PILL_TONES) {
      const s = getComputedStyle(container.querySelector(`#t-${tone}`)!);
      const differs = s.color !== plain.color
        || s.backgroundColor !== plain.backgroundColor
        || s.borderTopColor !== plain.borderTopColor
        || s.opacity !== plain.opacity;
      expect(differs, `.pill.${tone} computes identically to a plain pill `
        + `(color ${s.color}, background ${s.backgroundColor})`).toBe(true);
    }
  });

  it('success and bad are visually distinct from each other', async () => {
    // The failure this whole file exists for: Bridge's "verified" pill and Research's "failed"
    // pill rendered identically, because neither tone had a rule. A green that equals the red is
    // worse than no colour at all — it looks deliberate.
    const { container } = render(
      <>
        <span id="ok" className="pill success">verified</span>
        <span id="no" className="pill bad">failed</span>
      </>,
    );
    await settleAnimations();
    const ok = getComputedStyle(container.querySelector('#ok')!);
    const no = getComputedStyle(container.querySelector('#no')!);
    expect(ok.color, 'a verified badge and a failed badge must not be the same colour')
      .not.toBe(no.color);
  });
});

// R3-0286 said `aios.css`'s `.grid { repeat(auto-fill, minmax(280px, 1fr)) }` overrides `ui.css`'s
// `.grid-3` on `TileGroup`, which carries both classes. MEASURED, it does not: the two rules
// have the same specificity, and `ui.css` arrives AFTER `aios.css` (`main.tsx` imports
// `styles.css` first; `ui.css` comes in with `ui.tsx`), so `.grid-3` wins and the group is three
// columns. The finding read the order the wrong way round.
//
// The measurement stays, because what it found is that the layout rests on IMPORT ORDER. With
// the `.grid-3` rule removed this test reads four tracks — so it goes red the day the order
// flips, which is the day the finding becomes true.
describe('TileGroup is the three columns its class asks for', () => {
  it('lays four tiles out in three columns at desktop width', async () => {
    const { TileGroup, StatTile } = await import('./ui');
    // The spec frame is phone-wide by default, where `.grid-3` is one column on purpose; this
    // measures the desktop layout, so it says so. (My first run of this test measured the
    // 720px breakpoint and was red for that reason, not for the defect.)
    const { page } = await import('vitest/browser');
    await page.viewport(1440, 900);
    const { container } = render(
      <div style={{ width: 1400 }}>
        <TileGroup label="Overview">
          <StatTile glyph="a" value={1} label="One" onActivate={() => {}} />
          <StatTile glyph="b" value={2} label="Two" onActivate={() => {}} />
          <StatTile glyph="c" value={3} label="Three" onActivate={() => {}} />
          <StatTile glyph="d" value={4} label="Four" onActivate={() => {}} />
        </TileGroup>
      </div>,
    );
    const group = container.querySelector('.tile-group') as Element;
    const tracks = getComputedStyle(group).gridTemplateColumns.split(' ').filter(Boolean);
    // `auto-fill, minmax(280px, 1fr)` resolves to four 338px tracks here (measured).
    const width = window.innerWidth;
    await page.viewport(414, 896);
    expect(width).toBe(1440);
    expect(tracks).toHaveLength(3);
  });
});
