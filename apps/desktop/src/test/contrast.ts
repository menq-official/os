/**
 * WCAG contrast, computed from the live CSSOM — for the backgrounds axe-core cannot read.
 *
 * `axe-core`'s colour parser understands `rgb()` and `rgba()`. It does **not** understand
 * `color(srgb r g b)`, which is what Chromium's *computed* value is for any `color-mix()`. This app
 * uses `color-mix()` for the four `InlineAlert` tint backgrounds in `ui.css` (counted with
 * `grep -n 'background[^;]*color-mix' src/components/ui.css`; the file's other `color-mix()` lines
 * are shadows, strokes, a fill and a filter) and for the selected notification band, so axe
 * reported those elements as violations with a ratio of **NaN** and a background of
 * `#0NaN0NaN0NaN`.
 *
 * That is a tooling limit, not a defect, and both of the easy answers are wrong:
 *
 *   * treating `NaN` as a pass hides real failures — and those elements are badges and the
 *     *selected* row, which is exactly where the eighth audit's `H-03` defect lived;
 *   * treating `NaN` as a failure invents findings in working code, which is how a gate gets
 *     switched off.
 *
 * So the ratio is computed instead: parse whatever Chromium reports, composite the element's text
 * and its background over every ancestor's background, each faded by that ancestor's `opacity`,
 * and apply the WCAG 2.x formula.
 * The same formula `tools/check_contrast.py` uses on the committed token pairs — that one checks
 * declared colours, this one checks what was actually painted.
 */

/** `[r, g, b, a]` with channels 0–255 and alpha 0–1, or `null` when the value is not a colour. */
export type Rgba = [number, number, number, number];

/**
 * Parse the forms a browser's *computed* style can hand back.
 *
 * `color(srgb …)` carries 0–1 components, which is the shape Chromium resolves `color-mix()` to and
 * the one that makes axe return NaN. `transparent` is a colour with zero alpha rather than an
 * absence, because compositing needs it to behave like one.
 */
export function parseColor(value: string): Rgba | null {
  const v = value.trim();
  if (!v || v === 'none') return null;
  if (v === 'transparent') return [0, 0, 0, 0];

  const rgb = v.match(/^rgba?\(([^)]*)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    return [parts[0], parts[1], parts[2], alpha];
  }

  const srgb = v.match(/^color\(\s*srgb\s+([^)]*)\)$/i);
  if (srgb) {
    const parts = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const alpha = parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    return [parts[0] * 255, parts[1] * 255, parts[2] * 255, alpha];
  }
  return null;
}

/** `src` painted over `dst`, both opaque-or-not, in straight sRGB — the browser's own model. */
export function composite(src: Rgba, dst: Rgba): Rgba {
  const a = src[3] + dst[3] * (1 - src[3]);
  if (a === 0) return [0, 0, 0, 0];
  const ch = (i: number) => (src[i] * src[3] + dst[i] * dst[3] * (1 - src[3])) / a;
  return [ch(0), ch(1), ch(2), a];
}

/** Relative luminance, WCAG 2.x. */
export function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio between two OPAQUE colours, WCAG 2.x. */
export function ratio(fg: Rgba, bg: Rgba): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

/**
 * The AA threshold for this element's text: 3.0 for large text (≥ 24px, or ≥ 18.66px bold),
 * 4.5 otherwise. Same rule `contrast-pairs.json` encodes as `size: large`.
 */
export function threshold(el: Element): number {
  const style = getComputedStyle(el);
  const px = parseFloat(style.fontSize) || 16;
  const weight = Number(style.fontWeight) || 400;
  const large = px >= 24 || (px >= 18.66 && weight >= 700);
  return large ? 3 : 4.5;
}

/**
 * The measured ratio for an element's own text against what is really behind it: `bg` is the
 * element's background composited over each ancestor's, `fg` the text over that. Both end on
 * white when nothing in the tree paints, the assumption a browser itself makes.
 *
 * Only `background-color` is read. A background image or gradient, a filter and a blend mode
 * are not, on the element or on any ancestor.
 */
export function measuredContrast(el: Element): { ratio: number; fg: Rgba; bg: Rgba; need: number } {
  const fgRaw = parseColor(getComputedStyle(el).color) ?? [0, 0, 0, 1];
  // Two pixels are carried up the tree: one where a glyph is, one beside it. `opacity` is NOT in
  // `color`, which is why an opacity-dimmed label can pass a token check and fail on screen — and
  // it applies to an element as a GROUP, so it fades that element's own background together with
  // everything painted inside it. Multiplying the text alone, over a background left at full
  // strength, reported a ratio nothing on the screen had whenever the dimmed element (or a dimmed
  // ancestor) painted a background of its own.
  let text: Rgba = fgRaw;
  let behind: Rgba = [0, 0, 0, 0];
  let node: Element | null = el;
  while (node) {
    const style = getComputedStyle(node);
    const own = parseColor(style.backgroundColor);
    if (own && own[3] > 0) {
      text = composite(text, own);
      behind = composite(behind, own);
    }
    const o = parseFloat(style.opacity);
    if (!Number.isNaN(o)) {
      text = [text[0], text[1], text[2], text[3] * o];
      behind = [behind[0], behind[1], behind[2], behind[3] * o];
    }
    node = node.parentElement;
  }
  // White behind an unpainted tree.
  const fg = composite(text, [255, 255, 255, 1]);
  const bg = composite(behind, [255, 255, 255, 1]);
  return { ratio: ratio(fg, bg), fg, bg, need: threshold(el) };
}

/**
 * Does a measured ratio fall short of what the text needs?
 *
 * On the RAW ratio. The spec that uses this wrote `ratio + 0.005 < need` in three places, which
 * passed 4.4995 against 4.5 — the rounding toward passing that `tools/check_contrast.py` had
 * already given up. And written as `!(ratio >= need)` on purpose: a ratio that is not a number is
 * a measurement that was never taken, and `NaN < need` would have called it a pass.
 */
export function belowNeed(ratio: number, need: number): boolean {
  return !(ratio >= need);
}
