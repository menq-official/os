# The Builder's answers to the unfinished twelfth review

The review itself is [`2026-10-09-twelfth-audit-ca6fc74-UNFINISHED.md`](./2026-10-09-twelfth-audit-ca6fc74-UNFINISHED.md),
kept as the reviewer left it. This file is the other side: what the Builder did with each finding.
Every entry is ◑ — the Builder's own claim, read by no independent reviewer — and says whether the
finding was reproduced before anything was changed.

Twenty findings, `L-01`–`L-20`, are in `engine/runtime`. That is engine security code: a change
there needs an Architect audit or an Owner waiver, and none has been made.

## Reproduced, not fixed

- **`L-17` (P1) — the supervisor attests a run whose output stream was never created.** With the
  repository's own fixture (`CompleteRunDispatchTests`): `complete-run` with no output service
  returned `ok`, `output_stream: unconfigured`; the ledger said `COMPLETED`;
  `governed_output_streams` had 0 rows; `attest-run` then returned `ok` with a signed attestation.
  `engine/ci/live/run_supervisor.py` passes no output service to `serve_forever`. Engine security
  code — waits for an audit or a waiver. Nothing was changed.

## Fixed

- **`L-41` (P3), OS #394 — and wider than filed.** A short stored bundle digest panicked the
  scheduler on `&digest[..12]` while it held the database mutex: reproduced. Not in the finding: a
  stored digest that was an absolute path made the scheduler verify and **queue** a valid bundle
  outside the store, because `Path::join` with an absolute path replaces the root. A digest is 64
  lowercase hex at `register`, at arming (with a positive interval, before the grant is consumed),
  in `enqueue_due` and at the claim; a malformed one is a refused run.
- **`L-43` (P2), OS #395.** The Linux TCB floor returned `Ok` for an artifact pinned at the relative
  path `broker`, because the ancestor chain is derived by walking the path string: reproduced. A
  path that does not start at `/`, or has an empty, `.` or `..` segment, or a NUL, is
  `NonAbsolutePath` before anything is probed. Not done: descriptor-relative opens in the consumer.
- **`L-31` (P2), OS #396.** `agent_bundle::verify` hashed each file and then read `grant.json` and
  `flow.json` a second time to parse them. A file renamed in between was loaded under the old
  digest — a grant with an added capability, a flow with a different step: reproduced through a
  test seam at that instant. Every file is read once and parsed from those bytes. Not done:
  `O_NOFOLLOW`.
- **`L-23` (P3), `L-28` (P2), `L-34` (P3) — one defect in three parsers.** `serde_json` keeps the
  last of two equal keys. The broker took `{"ok":false,"ok":true,"op":"wrong","op":"issue"}` as a
  successful hop reply, and read a floor-pinned anchor that first named another key and the lower
  custody as the compiled external root: both reproduced on the unfixed code. `L-34`, the
  sidecar's stdout, was NOT run on the unfixed code — its test was written with the fix and
  asserts that the plain decoder accepts the same bytes. `core/src/strict_json.rs` refuses a
  repeated key at any depth and anything after the value; it is used by `parse_reply`,
  `parse_root_anchor` (`duplicate_field`), the sidecar's stdout, and the relay door that reads a
  request's `protocol`. Not done: unknown-field rejection and canonical-form checks; the other
  `serde_json::Value` parsers in the tree were not swept.
- **`L-24` (P2), OS #398.** The broker's frame read had a per-`read` timeout, which every arriving byte
  restarts, and no deadline for the frame: with a real socket pair, a peer dripping one byte every
  30 ms held a read with a 100 ms timeout for the whole 3 s it kept dripping — reproduced.
  `read_one_frame` takes one budget for the whole frame; each read may wait only for what is left.
  The broker still serves one connection at a time.
- **`L-21` (P2).** The outbound hop's 30 s budget began after `connect(2)` returned. Against a real
  listener with a full backlog that accepted nothing, `connect_hop` with a 300 ms budget was still
  inside the connect after 2 s, and 400 ms spent connecting left 2.999 s of a 3 s budget: both
  reproduced. The clock starts before the socket is made, and the connect waits only for what is
  left (`SO_SNDTIMEO`, which a blocking `AF_UNIX` connect on Linux obeys — measured by the test, not
  read). Seven mutants, six named deaths; the path-length arm cannot be told from the kernel's own
  refusal. Not done: a signal during the connect (`EINTR`) is retried and no test delivers one;
  the reviewer's non-blocking connect with `poll` was not used.
- **`L-22` (P3) — and wider than filed.** The test named "writes no file" refused four spellings of
  a write. Eight writers were put into the production code one at a time — `fs::copy`, `rename`,
  `hard_link`, a symlink, `OpenOptions`, `libc::open`, a raw `syscall`, a `File` imported under
  another name — and it went red for one, `OpenOptions`: reproduced. It is an allowlist now: what
  the production half may take from `fs` (two reads and `remove_file`) and from `libc` (the hop
  socket of `L-21`), and no import of either. Eleven writers, eleven red; each of the three arms
  removed in turn lets through the writer only it catches. Not done: it reads this one file's text,
  so a write made by a function it calls elsewhere is not seen, and it is a scan, not a parse.
- **`L-39` (P2), OS #397.** `check_and_persist` compared a manifest with a floor the caller had parsed
  earlier. A holder of an epoch-5 snapshot accepted 7 and then 6, and the file ended at 6;
  eight concurrent holders left 11 where 12 had been accepted: both reproduced. The advance is
  compared with the floor on disk (or the caller's, whichever is higher) under a lock held from the
  read to the end of the write. A floor file that exists and does not parse is a refusal.
