/**
 * The credential sweep: what a frame would put on the wire, as text, and the vocabulary a lease,
 * a key or a token is written in.
 *
 * ONE copy. It was pasted into three suites — `services/agentsDispatch.nolease.test.ts`,
 * `services/agentsDispatch.boundary.test.ts` and `features/Integrations.nosecret.test.tsx` — and
 * the first of those said so itself: *"a fix applied to one of three copies is a fix in one of
 * three places."* Ninth audit `I-03` was exactly that drift. The two `services` suites import
 * from here now; the `features` copy is still its own (it also sweeps with a different
 * vocabulary, `SECRET_SHAPED`), and should import `flatten` / `decodeCharCodeRuns` from here.
 * `SECRET_SHAPED` also carries its own copy of the `key` clause, and it is the case-blind one:
 * the camelCase compounds `FORBIDDEN` matches since 2026-10-14 are still missed there.
 *
 * Not a test file: nothing here asserts. The suites that import it keep the cases that pin each
 * behaviour, including the positive controls that show the sweep is not vacuous.
 */

/**
 * Every string that appears anywhere in a value, however deeply nested.
 *
 * **Non-string leaves are visited too** (sixth audit `A-09` route 3, reopened by the eighth).
 * The earlier version pushed only `typeof value === 'string'`, so a `number[]` whose elements
 * are character codes decoded to `"lease-7f2a91"` on the far side while being invisible here.
 * Numbers and booleans are now stringified, and an array's printable character codes are
 * additionally pushed in decoded form — the sweep sees the bytes as the text they would become,
 * not as digits. The decode survives one out-of-range byte (ninth audit `I-03`).
 *
 * Typed arrays, `ArrayBuffer`, `DataView`, `Map` and `Set` are visited as well. Until 2026-10-08
 * they were not, while this comment said every non-string leaf was: a `Uint8Array` of the same
 * character codes, a Map value and a Set member each went through unseen.
 */
export function flatten(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    out.push(String(value));
  } else if (Array.isArray(value)) {
    out.push(...decodeCharCodeRuns(value));
    value.forEach((v) => flatten(v, out));
  } else if (value instanceof ArrayBuffer) {
    flatten(Array.from(new Uint8Array(value)), out);
  } else if (ArrayBuffer.isView(value)) {
    // A typed array's elements are the character codes; a DataView has none of its own, so its
    // bytes are read. Both go through the plain-array branch, so the decode is the same one.
    flatten(value instanceof DataView
      ? Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
      : Array.from(value as unknown as ArrayLike<number | bigint>, (v) => Number(v)), out);
  } else if (value instanceof Map) {
    // `Object.entries` of a Map or a Set is empty: both were invisible, keys and members alike.
    for (const [k, v] of value) { flatten(k, out); flatten(v, out); }
  } else if (value instanceof Set) {
    for (const v of value) flatten(v, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { out.push(k); flatten(v, out); }
  }
  return out;
}

/**
 * The printable text a character-code array carries — ninth audit `I-03`.
 *
 * The superseded form returned `null` for the whole array the moment ONE element fell outside
 * `0x20`–`0x7e`, so a newline on the end of the character-code array made it invisible again. Two
 * things are produced instead, and the second is the one that matters: every maximal printable RUN,
 * so adjacency is preserved, **and** the concatenation of all printable bytes with the
 * non-printable ones removed, so a credential interleaved with separators cannot hide either. An
 * array with no printable byte in it yields nothing at all, which is what keeps the decode from
 * becoming a wildcard that invents offenders.
 */
export function decodeCharCodeRuns(list: readonly unknown[]): string[] {
  const out: string[] = [];
  let run = '';
  let all = '';
  for (const v of list) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0x20 && v <= 0x7e) {
      run += String.fromCharCode(v);
      all += String.fromCharCode(v);
    } else if (run) {
      out.push(run);
      run = '';
    }
  }
  if (run) out.push(run);
  if (all && !out.includes(all)) out.push(all);
  return out;
}

/**
 * The credential-shaped vocabulary. `key` carries a **compound** family rather than the bare
 * word: `(?<![a-z])key(?![a-z])` matched none of `pubkey` / `apikey` / `keystore` / `sessionkey`
 * (sixth audit `A-09` route 2, reopened by the eighth), while still needing to leave `monkey`,
 * `turkey` and `keyboard` alone — a lookaround that admits every compound would fire on ordinary
 * prose, and a sweep that cries wolf gets deleted. The prefix and suffix groups are both optional,
 * so the bare-word behaviour this replaced is preserved exactly.
 *
 * A camelCase compound is matched whatever its first word is: `authKey`, `hmacKey`, `clientKey`.
 * It was not while the pattern carried the `i` flag — `(?<![a-z])` then refused ANY letter before
 * `key`, so only the listed prefixes got through. A capital `K` after a lower-case letter is a
 * word boundary, and seeing one needs a pattern that can tell the cases apart; so the flag is gone
 * and every word is spelled in both cases by `anyCase`. `MONKEY` and `Keyboard` are still left
 * alone: an all-caps word has no such boundary.
 */
const WORDS = 'lease|secret|token|nonce|signature|private';
const KEY_PREFIX = 'pub|api|access|secret|private|public|session|signing|host|ssh|gpg|master|root|enc|dec';
const KEY_SUFFIX = 'tore|chain|file|pair|ring|id';
const anyCase = (words: string) => words.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);
const KEY_CLAUSE =
  `(?:(?<![a-zA-Z])|(?<=[a-z])(?=K))(?:${anyCase(KEY_PREFIX)})?[-_ ]?${anyCase('keys')}?(?:${anyCase(KEY_SUFFIX)})?(?![a-zA-Z])`;
export const FORBIDDEN = new RegExp(`${anyCase(WORDS)}|${KEY_CLAUSE}`);
