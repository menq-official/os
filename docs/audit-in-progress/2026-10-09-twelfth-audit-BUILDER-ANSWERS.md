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
- **`L-24` (P2).** The broker's frame read had a per-`read` timeout, which every arriving byte
  restarts, and no deadline for the frame: with a real socket pair, a peer dripping one byte every
  30 ms held a read with a 100 ms timeout for the whole 3 s it kept dripping — reproduced.
  `read_one_frame` takes one budget for the whole frame; each read may wait only for what is left.
  The broker still serves one connection at a time. Not done: `L-21`, the outbound connect.
- **`L-39` (P2), OS #397.** `check_and_persist` compared a manifest with a floor the caller had parsed
  earlier. A holder of an epoch-5 snapshot accepted 7 and then 6, and the file ended at 6;
  eight concurrent holders left 11 where 12 had been accepted: both reproduced. The advance is
  compared with the floor on disk (or the caller's, whichever is higher) under a lock held from the
  read to the end of the write. A floor file that exists and does not parse is a refusal.
