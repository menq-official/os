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

## Read, and waiting on the Owner

Each of these changes a contract or picks a design, so none was changed.

- **`L-25` (P2)** — a signed `key_usage` on manifest keys. It changes the root-signed manifest's
  shape and its canonical bytes; `WAVE_3B_ISOLATED_SIGNER_DESIGN.md` §1.7 calls building it "an
  open security decision".
- **`L-26` (P3)** — the sudoers row of the preflight can never be met. The Owner chose the probe
  (`sudo -n -l -U`) on 2026-10-12. Not started: the session's command classifier refused the
  measurement of what `sudo -l` prints here, and a parser written without it could report a
  grant that is not there.
- **`L-36` (P3)** — the sidecar invoker validator accepts an argv that changes no principal. The
  rule exists twice, in `governed_sidecar.rs` and in `engine/ci/live/write_broker_config.py`
  (`validate_sidecar`), under one shared case table, and the reviewer offers two designs. The
  Builder's recommendation: one fixed grammar, `sudo -n -u <account> /usr/bin/env` — the shape
  both validators give as their example. What the two kits actually pass was searched for in
  their scripts and not found, so whether that grammar admits them is not established.

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
- **`L-27` (P2).** The preflight said a deployment met everything a machine can meet while 18 of
  its 21 pinned artifacts were not on disk and 20 were pinned to a zero digest: reproduced on the
  module's own fixture (`not_met=0`). The §2.5 floor is a row now, `trust.tcb_integrity_floor`,
  decided by `verify_tcb_integrity` itself with the broker's principal set, through the broker's
  probe on a real host. The broker is told its login uid in argv and no config holds it, so the
  preflight takes `--login-uid`; without it the row is unmeasurable, not guessed. The fixture now
  puts every artifact on disk and each property is broken in turn. Nine mutants, eight named
  deaths; the ninth is equivalent (the login uid is already in the principal set). One test passed
  for the wrong reason until its mutant survived: this machine's umask is 002. Not done: the pin
  manifest's own custody and the check that it pins the running broker; `L-26`; a run against a
  real provisioned deployment, which this machine does not have.
- **`L-29` (P2).** The pin manifest was opened by its path with `O_NOFOLLOW`, which protects the last
  component only. With two acceptable manifests and a symlink before them, the reader returned A
  or B as the link was swapped, and accepted one under a 0777 directory: both reproduced. The path
  is walked one component at a time with `openat` and `O_NOFOLLOW` from `/`; a link anywhere on it
  is refused, and every directory is refused if a measured principal owns it or group or others
  may write to it — the rule the floor already applied to the ancestors of each pinned artifact.
  Nine mutants, eight named deaths; judging `/` itself cannot be made to fail by a test. Tests
  name their own directory as the start of the walk, under `cfg(test)` only, because every
  directory a test can make is under `/tmp`. Not done: `openat2(RESOLVE_BENEATH)`; binding the
  path to an expected deployment root; POSIX ACLs; `L-30`, the size ceiling on the same reader.
- **`L-30` (P3).** A 64 MiB file of JSON whitespace ending in a small valid manifest was read whole
  into memory and accepted: reproduced. The pin manifest has a ceiling of 1 MiB — refused from the
  descriptor's size before any read, and by a read that takes at most one byte past the ceiling
  whatever that size said. A pinned artifact is hashed through one 64 KiB buffer instead of being
  held whole. Seven mutants, seven named deaths. Not done: a per-role maximum for artifacts, so a
  very large pinned file still costs the time to hash it; the non-Linux loader, which refuses on
  the platform anyway, still reads unbounded.
- **`L-32` (P3).** `served_chunk_sha256` in the ladder pull's evidence was the digest of the base64url
  text under a name and a comment that say it is the digest of the bytes served; for `AQI` the two
  differ. It is the digest of the decoded bytes, with their length beside it; a reply with no
  bytes, or text that is not canonical base64url, has neither. Four mutants, four named deaths, the
  first of them the old code. Nothing in the tree reads these fields. The same finding is
  `R3-0105` of the cockpit read, marked closed there. Not done: evidence files written before
  this carry the old digest under the same name.
- **`L-33` (P2) — and reachable without a fault.** The broker wrote the message in one transaction
  and its turn's state in a second write whose result it discarded. With the reviewer's trigger the
  reply said `committed` while the turn row said `live`: reproduced. Not in the finding: a turn
  that had stopped being live while it ran — reconciled as stale by another process — still had
  its message published and `committed` returned, with the turn row `blocked`: reproduced with two
  connections and no fault at all. The turn moves to `committed` inside the message's transaction;
  if it cannot, the insert rolls back and the reply is `blocked`. Five mutants, five named deaths.
  Not done: the refusal paths still settle best-effort (a lost write there leaves `live` until the
  stale reconciliation makes it `blocked`, which is what the reply already said); a failure of
  `COMMIT` itself is reported as blocked without re-reading what became durable.
- **`L-35` (P3).** A broker database made by the release before `09b4803` kept the one-state
  constraint, and a demonstration-custody turn failed there with `CommitReadbackMismatch` while a
  fresh database accepted it: reproduced with that release's own DDL, taken from history. Schema
  creation now reads back the table that is there: the current shape is left, the former one is
  rebuilt in one transaction with its rows, and any other shape refuses startup with the shape
  named. Six mutants, five named deaths; the row-count comparison survives alone, because nothing
  a test can do makes `INSERT … SELECT` lose a row. Not done: a schema version number — the
  shape is recognised by its constraint text; the other broker tables were not looked at.
- **`L-37` (P3).** The sidecar's stdout was made into text with a lossy conversion before it was
  parsed, so `{"ok":false,"error":"bad<0xFF>byte"}` was read as a reply with U+FFFD in it:
  reproduced. The parser takes the bytes and refuses output that is not UTF-8, naming the byte.
  Tested through a real child process that writes the invalid byte and exits zero. Three mutants,
  three named deaths; the old code is caught by the real-child test. Not done: the child's
  stderr is still read lossily, into a diagnostic only.
- **`L-38` (P3).** The broker read 23 keys out of the envelope and verified the signature over the
  canonical bytes it rebuilt from them, so bytes the signer never signed were accepted under its
  signature — the genuine envelope with a second `run_id` in front, a member added, re-ordered or
  spaced: all four accepted by the old path, shown by a control inside the test. An envelope is
  now taken only if the canonical bytes rebuilt from it EQUAL the bytes received
  (`from_exact_jcs`); the direct chain, whose payload arrives as a value, compares the value's own
  serialisation (`from_exact_payload`). All three callers moved, the CI pull driver included, and
  the lenient parser is private. Five mutants, four named deaths: the duplicate-refusing decoder
  in front of the comparison survives, because the comparison already refuses a duplicate. Two
  callers were held by no test until their mutants survived; each has one now. Not done: the
  detached signature is still verified over the rebuilt bytes, which are now proven equal to the
  received ones rather than being the same buffer.
- **`L-40` (P3).** `ManifestReceiptKeyAuthority` kept `(key_id, public key)` for each key valid at
  construction, so a key went on resolving `Trusted` after its `valid_to_ms` for as long as the
  process lived. It holds each key with its window and a clock, and every `resolve` is decided at
  that time; an unreadable clock resolves nothing. Five mutants, five named deaths, the first of
  them the old code. The type is still constructed by nothing outside its tests — the module
  says it is kept correct rather than deleted, and that was left as it is. Not done: revocation,
  protocol scope and the durable floor are still decided once, at construction; the trait takes
  no turn context, so the design's `KeyResolutionQuery` was not built.
- **`L-39` (P2), OS #397.** `check_and_persist` compared a manifest with a floor the caller had parsed
  earlier. A holder of an epoch-5 snapshot accepted 7 and then 6, and the file ended at 6;
  eight concurrent holders left 11 where 12 had been accepted: both reproduced. The advance is
  compared with the floor on disk (or the caller's, whichever is higher) under a lock held from the
  read to the end of the write. A floor file that exists and does not parse is a refusal.
