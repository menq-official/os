# Twelfth independent security-perimeter audit — ca6fc74

**Date:** 2026-10-09  
**HEAD:** `ca6fc74`  
**Status:** UNFINISHED

This report is being written incrementally during a line-by-line audit of every tracked Python file under `engine/runtime` and every tracked Rust file under `apps/desktop/src-tauri`. Findings are appended when established. The verdict and complete read/unread lists will be added only after the scope is exhausted.

Process note: the canonical handoff names `main` at `9194b40`, but this commissioned audit is intentionally detached at `ca6fc74`. The mandatory `git pull` could not run because the sandbox exposes `.git/FETCH_HEAD` read-only; the brief also states that the network is unavailable. No remote state was verified.

Resume note: the first continuation resumed at `engine/runtime/bro_execution_lease.py`. A later continuation resumed at `engine/runtime/bro_repository_state.py`. This continuation read the report and complete progress ledger first and resumed at `engine/runtime/challenge_key_registry.py`, the first remaining Python file marked `TODO`; files already marked `READ` or `READ-WITH-FINDINGS` were not re-read.

This continuation resumed at `engine/runtime/provision_floor_writer.py`, the first remaining Python file marked `TODO` in the commissioned review order; files already marked `READ` or `READ-WITH-FINDINGS` were not re-read.

This continuation resumed at `apps/desktop/src-tauri/core/src/broker_turns.rs`, the first remaining file marked `TODO` in the commissioned review order after the completed Python runtime and broker reads; files already marked `READ` or `READ-WITH-FINDINGS` were not re-read.

This continuation resumed at `apps/desktop/src-tauri/core/src/lib.rs`, the first remaining file marked `TODO` in the commissioned review order; files already marked `READ` or `READ-WITH-FINDINGS` were not re-read.

This continuation resumed at `apps/desktop/src-tauri/core/tests/schema_migrations.rs`, the first remaining file marked `TODO` in the commissioned review order after the completed Python runtime and broker reads; files already marked `READ` or `READ-WITH-FINDINGS` were not re-read.

## Re-attack status

- **K-03 — CONFIRMED.** `automations::parse_interval_ms` no longer indexes a UTF-8 string by a byte-derived boundary: it removes one of the three ASCII suffixes with `strip_suffix`, parses the remaining trimmed text, and uses `checked_mul`. In addition to running the new non-ASCII regression test, I called the compiled function with inputs its tests do not use: `"every: 1µ"`, `"every: 18446744073709551616h"`, and `"every: 1\u{200d}"` all returned `None` without a panic, while `" EVERY:\t2H "` returned `Some(7_200_000)`. These distinguish Unicode rejection, parse overflow, a format character without an ASCII unit, and the valid case-insensitive grammar.
- **K-05 — pending.**

## Findings

### L-01 — P2 — the out-of-band audit-anchor installer can race an append and roll the installed anchor backward

**File and symbol:** `engine/runtime/bro_audit_log.py`, `attach_head_anchor` / `_install_anchor` versus `append`.

**Exact sequence:** start with a keyed ledger at count N. Thread/process A calls `attach_head_anchor(path, valid_document_for_N, keys)` and completes `_check_anchor_against_chain` plus `_check_anchor_monotonic`, then pauses before `os.replace`. Thread/process B calls `append`, takes `_append_lock`, commits record N+1 and installs its valid anchor for N+1, then releases the lock. A resumes and atomically replaces `.head.sig` with its older, still-valid anchor for N. The chain and plaintext head now describe N+1 while the installed signed head describes N; `verify(path, keys=...)` refuses with an anchor count mismatch. The symmetric race can also collide on the fixed `.tmp` path. `attach_head_anchor` never takes the lock that `append` uses across the same check/replace state transition.

**Consequence:** an operator performing the supported out-of-band anchoring operation concurrently with an honest writer can regress the durable audit anchor and turn an intact ledger into a persistent authoritative-verification failure. This does not forge acceptance, but it crosses the audit availability/integrity boundary by letting two writers act on one anchor state without serialization.

**Fix:** take the same `_append_lock(path)` around the complete verify-chain/check-current-anchor/install operation in the public out-of-band path; keep one internal installer for callers already holding the lock. Use a uniquely created same-directory temp file and fsync it plus the directory before replacement. Add a barrier-controlled cross-thread/process test that pauses attach after its checks, completes an append, resumes attach, and proves the older anchor cannot replace the newer one.

**Test evidence:** `engine/tests/test_audit_head_anchor.py` covers ordinary append anchoring, rollback checks and sequential out-of-band attach, but has no concurrent `attach_head_anchor`/`append` test. Therefore no existing test would fail if this serialization were removed or, as here, never present.

### L-02 — P3 — the dependency health gate orders prereleases as later final releases

**File and symbol:** `engine/runtime/bro_env_health.py`, `_ver_tuple` / `satisfies`.

**Exact input:** `satisfies("1.2rc1", ">=1.2.0")` returns `True`. `_ver_tuple` removes every non-digit from each dot component, so `"2rc1"` becomes `21` and the actual version becomes `(1, 21)`. The same shape affects real package versions such as `41.0.0rc1`, which is treated as `(41, 0, 1)` instead of a prerelease older than `41.0.0`.

**Consequence:** `check_environment` can report a required security/runtime dependency compatible when the installed distribution is a prerelease below the declared minimum. Code can then cross the startup dependency gate with an API/behaviour set the canonical constraint did not authorize.

**Fix:** compare versions with a standards-compliant PEP 440 implementation (`packaging.version.Version` plus `SpecifierSet`), or fail closed on any version syntax the stdlib-only checker cannot model. Add prerelease, dev, post-release, local-version and malformed-version cases.

**Test evidence:** `engine/tests/test_env_health.py` exercises plain numeric versions, ranges and zero-padding. It has no prerelease/dev/post/local-version case; none of its current tests would fail on the deciding input above.

### L-03 — P3 — the execution-lease runtime accepts values its integer schema rejects

**File and symbol:** `engine/runtime/bro_execution_lease.py`, `validate_execution_lease`.

**Exact input:** start with the valid `engine/tests/test_execution_leases.py::payload(...)`, set `issued_at_epoch = false` and `max_tool_calls = true`, and validate it with `now=1000`. Validation succeeds and returns `issued_at_epoch is False` and `max_tool_calls is True`. Python's `bool` is a subclass of `int`, so both `isinstance(value, int)` checks accept JSON booleans. Independently, `max_tool_calls = 100001` is accepted even though both copies of `execution-lease.schema.json` set `maximum: 100000`; negative timestamps are likewise not rejected despite the schema's `minimum: 0`.

**Consequence:** the code that actually consumes a signed execution lease accepts documents outside the declared contract and then acts on boolean or out-of-range values as integers. This weakens the schema/runtime equivalence relied on at the enforcement boundary and makes malformed issuer output or a parser differential silently authoritative rather than fail-closed. (`True` becomes one call slot; `False` becomes epoch zero.)

**Fix:** require `type(issued) is int`, `type(expires) is int`, and `type(max_calls) is int`; enforce the schema minima and `1 <= max_calls <= 100000` in the runtime validator (or validate the signed payload against the canonical schema before constructing `ExecutionLease`). Add table-driven cases for booleans, negative timestamps, zero, and 100001.

**Test evidence:** `engine/tests/test_execution_leases.py` covers expiration, schema version, bindings, capabilities, egress, scopes, signatures and replay, but contains no boolean, negative timestamp, or `max_tool_calls` ceiling case. No existing test would fail if these exact integer-domain checks remained absent.

### L-04 — P3 — the learning registry can satisfy its policy-file check with a path outside the repository

**File and symbol:** `engine/runtime/bro_learning.py`, `validate_learning_registry`.

**Exact input:** create a temporary repository root containing a `learning/registry.json` with the required pipeline and all required `promotion_rules`, but set `skill_evolution_policy` to `../outside.json`; create that single file beside the temporary root and do not create any policy under the root. `validate_learning_registry(temp_root)` succeeds. An absolute value such as `/etc/passwd` likewise replaces `root` entirely on POSIX because `root / absolute_path == absolute_path`.

**Consequence:** the repository validator can certify that the declared skill-evolution policy exists when the named file is not a repository artifact at all. A changed registry can therefore bypass the intended completeness check by pointing at any existing external file; CI result then depends on host filesystem contents.

**Fix:** require a non-empty repository-relative POSIX path, reject absolute paths and `..` components, resolve it, and require the resolved regular file to remain under `root` (with an explicit symlink policy). Prefer requiring the one canonical path if it is not intended to vary.

**Test evidence:** `engine/tests/test_skill_evolution.py::test_learning_pipeline_is_locked` exercises only the checked-in happy path. There is no traversal, absolute-path, symlink, or missing-in-root case, so no current test would fail if confinement remained absent.

### L-05 — P2 — an owner signature authenticates only three fields of the command the engine declares valid

**File and symbol:** `engine/runtime/bro_control_room_api.py`, `COMMAND_BOUND_FIELDS` / `_prove_command_actor`; `engine/runtime/bro_orchestration.py`, `validate_control_room_command`.

**Exact input:** use the real `ControlRoomActorProofTests` fixture. Have the `control-room` key sign an owner `cancel` whose `command_id` and `task_id` are the normal values but whose `expected_task_state="running"`, `scope=["task:other"]`, `reason="different"`, and command timestamps are different. Submit instead a command with the same id/task/verb but `expected_task_state="queued"` (the task's actual current state), the normal scope/reason/timestamps, and the first command's signed artifact. `validate_command_intent` returns `valid=true`, `actor_identity="owner-signed-control-room-command"`, and `current_state="queued"`. This was reproduced against this commit. Only `command_id`, `task_id`, and `command` are compared with the signed payload; every other field subsequently validated and represented as owner intent is caller-controlled.

**Consequence:** a holder of one genuine per-command owner artifact can alter the state precondition to make it valid in a state the signer did not approve, and can replace its stated scope, reason, evidence references and command validity interval while the engine still labels the result owner-signed and valid. The current method returns `mutation_authorized=false`, so this path does not itself execute the command, but it corrupts the authenticated control-room intent and is unsafe for any downstream consumer of the `valid` result.

**Fix:** sign and verify a canonical digest of the complete command document (excluding only signature-wrapper fields), or include and compare every semantic field: actor identity, requested/expires times, expected state, normalized scope, reason and evidence references. Keep the signed artifact's own issuance/expiry window separate and require both windows. Add one-field-at-a-time mutation tests for every bound field.

**Test evidence:** `ControlRoomActorProofTests::test_an_owner_attestation_for_a_different_command_is_refused` mutates only the three entries in `COMMAND_BOUND_FIELDS`, and its docstring explicitly treats those as the whole command. No test mutates `expected_task_state`, scope, reason, evidence or command timestamps after signing; all current tests pass on the deciding input.

### L-06 — P2 — the orchestration file lock can have two live holders after 30 seconds

**File and symbol:** `engine/runtime/bro_orchestration_runtime.py`, `_claim_guard` / `_break_stale_lock` (inherited by `DurableOrchestrationRuntimeV1`).

**Exact sequence:** holder A enters `_claim_guard` and remains in the critical section for more than `STALE_LOCK_SECONDS` (30 seconds), without exiting or crashing. Holder B attempts `_claim_guard`; it sees only the lock file's old mtime, renames the still-live lock as stale, deletes it, creates a new lock and enters. A remains in its critical section. A shortened unit experiment with `STALE_LOCK_SECONDS=0.05`, A held for 0.08 seconds, and two threads printed `overlap True` at this commit.

**Consequence:** the lock whose purpose is to serialize task creation, claims, leases and hash-chain transitions admits two live writers whenever one legitimate operation is slow. The owner-token logic prevents the old holder from deleting the new holder's lock on exit, but does not revoke or stop the old holder. Interleaving a slow `claim_next` after candidate selection lets both writers mint claim leases; one caller can receive a lease that the later record immediately supersedes, and multi-record mutations can be left partially interleaved or fail after committing their first records.

**Fix:** use an OS-held advisory lock whose ownership ends with the descriptor/process, or add a renewable lease with a heartbeat plus an owner-liveness check and fencing token that every protected write verifies. Elapsed mtime alone must never authorize stealing from a live holder. Add a deterministic live-overrun test that holds A beyond the stale threshold, starts B, and asserts B cannot enter until A exits.

**Test evidence:** `test_stale_lock_is_broken_and_reacquired` covers a manually planted presumed-dead lock; `test_overrunning_holder_does_not_delete_a_newer_lock` starts from the premise that a live holder was already displaced and checks only that it does not delete B's lock. No test asserts that a live slow holder cannot be displaced, and the deciding two-thread sequence succeeds.

### L-07 — P3 — lossy session-id filenames let one session inherit another's read receipt

**File and symbol:** `engine/runtime/bro_policy.py`, `receipt_path` / `load_receipt` / `receipt_fresh`.

**Exact input:** `receipt_path("audit/collision")` and `receipt_path("audit?collision")` are the same file because every non-allowlisted character is replaced with `_`. Write a fresh receipt whose embedded `session_id` is `audit/collision`, then call `receipt_fresh("audit?collision")` with the same tree identity. It returns `(True, "fresh")`; this was reproduced at this commit. `receipt_fresh` never compares the embedded session id (or schema) with the requested session.

**Consequence:** a session whose identifier collides after sanitization can satisfy the mandatory full-repository-read freshness gate with a different session's receipt, skipping the automatic reread. This does not by itself bypass the separate action/lease gates, but it invalidates the per-session literacy property the receipt is meant to enforce.

**Fix:** use an injective filename such as `sha256(session_id)` and, independently, require the loaded receipt's exact `session_id` and schema to match the request before checking age/tree. Write with restrictive permissions and atomic replacement. Add a collision pair and a mismatched embedded-id test.

**Test evidence:** `ReceiptFreshnessTests` covers fresh, missing, stale and changed-tree receipts, but its helper always writes and reads the same safe session id. There is no filename-collision or embedded-session mismatch case; the deciding input passes.

### L-08 — P2 — a signed receipt with `exit_code: false` is accepted as a passing test run

**File and symbol:** `engine/runtime/bro_receipt.py`, `verify_receipt` / `verify_passing_receipt`.

**Exact input:** take a valid execution-receipt payload, set `exit_code` to JSON `false`, sign that payload with the registered `evidence-recorder` key, and pass it to `verify_passing_receipt` with the matching task/head/tree/catalog. `verify_receipt` accepts `False` because Python booleans satisfy `isinstance(False, int)`, and `verify_passing_receipt` accepts it because `False != 0` is false. The same parser issue admits booleans for `started_at_epoch` and `finished_at_epoch`.

**Consequence:** a malformed signed outcome that does not state integer exit status zero crosses the completion evidence gate as a passing run. This creates a concrete schema/parser differential on the exact field that distinguishes green from red.

**Fix:** use `type(payload["exit_code"]) is int` and exact-integer checks for both timestamps (plus their declared non-negative/range rules). If the canonical schema is authoritative, validate the verified payload against it before semantic checks. Add signed `false`/`true` cases for exit status and timestamps.

**Test evidence:** `test_failing_receipt_rejected` uses integer `2`, and `test_tampered_exit_code_denied` changes a signed integer without re-signing, so it tests signature integrity rather than the accepted value domain. There is no re-signed boolean exit-code case; no current test would fail on the deciding input.

### L-09 — P2 — Windows `where.exe /R` is treated as a targetless read and bypasses task scope

**File and symbol:** `engine/runtime/bro_security.py`, `READ_ONLY_SHELL` / `READ_TARGET_SHELL` / `_analyze_named`.

**Exact input:** classify the accepted simple command `where.exe /R 'C:\Users\victim' '*'` as a Bash tool call. `analyze_command` returns `CommandInfo(executable='where', mutating=False, recognized_read_only=True, targets=())`, and `classify_tool_action` consequently returns `READ_LOCAL` with no targets. On Windows, `where.exe /R <dir> <pattern>` recursively searches the named directory and prints matching paths; the quoted backslashes and wildcard are passed literally by the accepted shell grammar. Because `where` is explicitly excluded from `READ_TARGET_SHELL` on the assumption that its arguments are only executable names, neither `C:\Users\victim` nor any other `/R` root reaches the read-scope check.

**Consequence:** a governed specialist whose task grants reads only inside its repository scope can enumerate filenames throughout any filesystem directory readable by its Windows account. The enforcement layer labels the command a targetless local read, so the out-of-scope root is not compared with the task scope or workspace binding.

**Fix:** give `where` an argument inspector rather than a blanket targetless classification. At minimum, recognize `where.exe /R <dir> <pattern>`, surface `<dir>` as a filesystem target, validate option arity, and fail closed on every unknown option or shape. If cross-shell semantics cannot be represented safely, remove `where` from `READ_ONLY_SHELL`. Add an end-to-end classifier/policy test showing an in-scope `/R` root passes and an out-of-scope root is denied.

**Test evidence:** `engine/tests/test_security_v2.py` tests path targets for Git and path-qualified executables but contains no `where`/`where.exe` case. No current test would fail if `/R` continued to return an empty target set; the deciding classifier input above succeeds at this commit.

### L-10 — P3 — trusted-key validity timestamps accept JSON booleans as epochs

**File and symbol:** `engine/runtime/bro_signature.py`, `_parse_key`.

**Exact input:** pass an otherwise valid verifier entry to `_parse_key` with `not_before_epoch: false` and `not_after_epoch: 9999999999`. It returns a `TrustedKey` whose `not_before_epoch is False`; the check uses `isinstance(value, int)`, for which Python accepts booleans. With that entry in an operator-signed registry, `verify_artifact(..., now=<current epoch>)` treats `false` as epoch zero and accepts signatures from the key throughout the stated upper window. `true` is likewise treated as epoch one.

**Consequence:** the authority parser accepts a malformed validity constraint instead of failing closed and silently turns a boolean into a real epoch boundary. A provisioning/serialization defect can therefore activate a signing authority whose registry entry never supplied an integer validity start.

**Fix:** require `type(value) is int` (and a non-negative bounded epoch) for both `not_before_epoch` and `not_after_epoch`, and reject `not_before_epoch >= not_after_epoch`. Apply the same exact-integer rule to every registry epoch/version field. Add an operator-signed registry test for `false` and `true` in each timestamp position.

**Test evidence:** `engine/tests/test_signature_authority.py` covers expired and not-yet-valid integer windows, tampering, authority mismatches and malformed pins, but has no boolean timestamp case. No existing test would fail on this parser differential; the direct deciding input above returns a `TrustedKey` at this commit.

### L-11 — P3 — the skill-evolution validator accepts statuses and incomplete documents forbidden by its schema

**File and symbol:** `engine/runtime/bro_skill_evolution.py`, `validate_skill_evolution`; `engine/tests/test_skill_evolution.py`, `SkillEvolutionValidatorTests::test_a_proposal_that_is_only_proposed_needs_no_approval_yet`.

**Exact input:** take the otherwise complete `proposal()` fixture and set `promotion_status="proposed"`. `validate_skill_evolution` returns it unchanged, while `engine/schemas/skill-evolution-proposal.schema.json` permits only `draft`, `benchmarking`, `review`, `pending-owner`, `approved`, `promoted`, `rejected`, or `rolled-back`. More minimally, the `SkillEvolutionTests.proposal()` fixture omits schema-required fields including `schema`, `proposal_id`, `gap_evidence`, `benchmarks`, and `risk`, yet the validator accepts it. Any arbitrary status other than the two exact strings `approved` and `promoted` bypasses the review/owner checks.

**Consequence:** the function named and tested as the skill-evolution validator can certify a document that the canonical contract rejects, and an unrecognized near-promotion state receives the permissive pre-promotion rules. There is no runtime skill-promotion flow or caller of this function at this commit (the law registry explicitly marks it advisory), so the defect is presently latent rather than a reachable promotion bypass.

**Fix:** validate the entire value against `skill-evolution-proposal.schema.json` before semantic checks (with duplicate-key rejection at the JSON ingress), or implement an exact equivalent including required fields, `additionalProperties`, enums, arrays and bounds. Remove the invented `"proposed"` state or add it to the schema through a deliberate contract change; fail closed on all unknown statuses.

**Test evidence:** `test_a_proposal_that_is_only_proposed_needs_no_approval_yet` affirmatively expects the schema-forbidden status to pass, so it would fail when the validator is corrected. The minimal positive fixture likewise proves only the subset of fields this function happens to read, not that a valid proposal is accepted. The full `proposal()` positive control does not exercise an unknown status.

### L-12 — P3 — one malformed STOP-registry line prevents every later process from being stopped

**File and symbol:** `engine/runtime/bro_stop_controller.py`, `list_registered` / `stop_all`.

**Exact input:** write `processes.jsonl` as two lines: first `{` and then `{"task_id":"t","pid":424242,"pgid":424242}`; call `stop_all(registry, audit)`. `list_registered` raises `json.JSONDecodeError` while building its list, so `stop_all` never reaches `terminate_group` for the valid second entry and writes no `unstopped-process` incident. A truncated last line left by a crash has the same effect.

**Consequence:** corruption of any one append-only registry record disables the emergency stop pass for every otherwise valid registered process after it, precisely when the recovery controller is supposed to continue best-effort containment and record what it cannot stop. `stop_all` currently has no production caller in this tree (only tests call it; the supervisor uses `terminate_group` directly), so this is a latent recovery defect at this commit.

**Fix:** parse and validate records one line at a time inside `stop_all`; require an exact object shape, non-empty bounded task id, and positive integer (not boolean) PID/PGID. Record a typed registry-corruption incident for each bad line and continue with independently valid entries. Serialize `register` appends under a real lock and fsync before reporting registration complete, so concurrent/crashed writers cannot leave an undetected partial record.

**Test evidence:** `StopControllerTests` covers a real group, an injected unstoppable result, and an ordinary round trip. It has no malformed/truncated-line or mixed valid/invalid registry case, so no current test would fail when one corrupt line aborts the whole stop.

### L-13 — P2 — an operator-signed workspace binding can omit its scope and receive an allow-all default

**File and symbol:** `engine/runtime/bro_workspace.py`, `load_workspace`.

**Exact input:** use the real `BindingLoadTests` signer fixture, but call `binding(allowed_paths=_OMIT, prohibited_paths=_OMIT)` and load it. `load_workspace` accepts the correctly signed document and constructs `allowed_paths=("**",)` and `prohibited_paths=()`. Calling `authorize_path(workspace, ".git/config")` then succeeds, although the binding contains no positive grant for that path and no statement removing the standard prohibition. Omitting `allowed_remotes` likewise silently grants `("origin",)`; none of these fields is type-checked as a list of non-empty safe patterns.

**Consequence:** omission or serialization loss in the authority that produces a signed workspace binding widens the enforced filesystem scope to the whole workspace and removes every sensitive-path prohibition instead of refusing the malformed authorization. The signature authenticates the omission; it does not establish that an absent scope means allow-all.

**Fix:** make `allowed_paths`, `prohibited_paths`, and `allowed_remotes` required exact-typed non-empty arrays (with an explicit decision if an empty prohibition list is legitimate); validate every entry and reject wildcard-only grants consistently with `bro_security.path_allowed`. Do not synthesize permissions when an authorization field is absent. Prefer validating the verified payload against a canonical workspace-binding schema before constructing `Workspace`.

**Test evidence:** `BindingLoadTests` has negative cases for a missing signature, digest and expiry, but none for missing/mistyped scope or remote arrays. Its only valid fixture always supplies all three. Therefore no current test would fail when deleting these authorization fields produces permissive defaults.

### L-14 — P3 — the strict IPC encoder emits the non-JSON constants its decoder refuses

**File and symbol:** `engine/runtime/brops_protocol.py`, `encode_frame` / `strict_loads`.

**Exact input:** `frame = encode_frame({"a": float("nan")})` succeeds and its body is `b'{"a":NaN}'`; `read_frame(io.BytesIO(frame))` then raises `ProtocolError` because `strict_loads` correctly rejects `NaN`. `Infinity` and `-Infinity` have the same encode-success/decode-refusal split because `json.dumps` is called with its default `allow_nan=True`.

**Consequence:** the module advertised as the single strict IPC codec can generate frames that no compliant peer, including itself, accepts. An internal non-finite value is turned into a malformed wire message and a remote refusal/connection failure instead of being rejected at the producing boundary with a local typed error.

**Fix:** call `json.dumps(..., allow_nan=False)` in `encode_frame`, translate its `ValueError`/`TypeError` into `ProtocolError`, and keep strict finite-number validation in every numeric schema. Add round-trip tests for all supported JSON values and explicit encode-side rejection tests for NaN and both infinities.

**Test evidence:** `test_negative_matrix.py::test_nm_frame_04_numeric_shape_and_non_json_constants_are_refused` tests only raw bytes entering `strict_loads`. `test_brops_protocol.py` round-trips ordinary integers and tests oversize bodies, but never asks the encoder to serialize a non-finite float. Thus the decoder regression test stays green while the same module still emits the forbidden tokens.

### L-15 — P2 — the IPC client’s timeout resets on every byte, so a drip peer can hold it forever

**File and symbol:** `engine/runtime/brops_socket.py`, `request`.

**Exact sequence:** call `request(path, frame, timeout=1.0)` against a local peer that accepts the request and then sends the four-byte length prefix and declared response body one byte at a time, with each byte arriving after 0.9 seconds. `request` sets a socket timeout once and passes `conn.makefile("rb")` to `brops_protocol.read_frame`; each successful underlying receive restarts the per-operation timeout. The peer can therefore keep the call alive for arbitrarily longer than one second without ever timing out. This is the client-side form of the exact slow-drip defect that `_BudgetedReader` and one monotonic deadline already fixed on the server side.

**Consequence:** a wedged, compromised, or path-substituted local signer/supervisor service can indefinitely block the caller and the governed operation instead of becoming a bounded fail-closed refusal. The documented 20/30-second client patience is not a total deadline and therefore cannot justify the server’s 120-second derived budget either.

**Fix:** take one monotonic deadline before connect and charge connect, send, header and body reads against it. Reuse `_BudgetedReader` (or a client equivalent) rather than the unbudgeted file object, and cap/write the outbound frame before opening the connection. Add a real-socket test whose peer drips bytes inside each per-read timeout and assert the client returns/raises within the total deadline.

**Test evidence:** `test_brops_socket.py::test_a_drip_peer_is_cut_off_by_the_total_budget` exercises only `serve_forever` receiving from a slow client. The pure budget tests likewise cover `recv_exactly_bounded`, which `request` does not use. There is no slow-response test for the client path, so removing or never adding a total client deadline leaves every current test green.

### L-16 — P2 — a successful short write replaces the entire anti-rollback floor with truncated JSON

**File and symbol:** `engine/runtime/floor_writer.py`, `commit_state`.

**Exact input:** create a valid provisioned `floor-state.json`, then make the one `os.write(handle, payload)` call return `len(payload) - 1` after writing that many bytes (the legal short-write contract of `write(2)`). `commit_state` returns normally, fsyncs the truncated temp file, replaces the authoritative state, and fsyncs the directory. This was reproduced against this commit by patching only `floor_writer.os.write`: `commit_returned None`, `bytes_missing 1`, and the next `load_state` refused `mark_corrupt`.

**Consequence:** one short regular-file write destroys the previously valid coupled roster/floor document for the whole install. The operation may subsequently fail its read-back, but the atomic rename has already discarded the last good anti-rollback state; every task then refuses until privileged repair. Atomic rename prevents readers seeing an in-progress name, not a short but successfully returned payload.

**Fix:** write in a loop until every byte is consumed (handling `InterruptedError`, refusing zero progress), or use a file object's full-write primitive and verify its returned count; only fsync and rename after the complete length is confirmed. Keep the old authoritative file untouched on any short/failed write. Add an injected short-write test that first installs a known-good multi-task state, forces partial progress followed by failure or zero progress, and proves `commit_state` refuses while the old state remains byte-for-byte intact.

**Test evidence:** `engine/tests/test_floor_writer_durability.py::SyscallOrder` asserts that a `write` syscall occurs before the two fsyncs and rename, but does not compare its return count with the requested count. `KillInjection` kills processes around ordinary writes; it cannot make `write(2)` return successful partial progress. No current test injects a short write, and the deciding experiment above passes through `commit_state` without an exception.

### L-17 — P1 — the live supervisor completes and attests a run without creating its mandatory output stream

**File and symbol:** `engine/runtime/governed_supervisor_server.py`, `complete_governed_run` / `_op_complete_run`; production reachability in `engine/ci/live/run_supervisor.py`, `main`.

**Exact sequence:** construct the real in-memory supervisor ledger used by `CompleteRunDispatchTests`; accept a valid challenge, pass `launch-gate` and `execution-started`, then dispatch `{"op":"complete-run","execution_attempt_id":attempt,"produced":valid_facts}` without an `output_read_service`. This is also the configuration used by `engine/ci/live/run_supervisor.py`, which passes every other seam to `serve_forever` but no output service. At this commit the deciding experiment returned `{"ok":true,"recorded":"created","output_stream":"unconfigured"}`, left the attempt durably `COMPLETED`, left `governed_output_streams` with no row for the attempt, and a following valid `attest-run` returned `ok:true`.

**Consequence:** the production server can issue a signed attestation for a terminal run whose governed output can never be read through the sole output-egress protocol. This directly contradicts the code's own §4.10(f) rule that a completing turn's stream is always created before its result is returned. Because completion is durable and attestation accepts that state, the success reply and signed evidence claim a completed deliverable while omitting the capability needed to deliver it. The newer `AcceptanceDriver` rejects this construction, but the separately exposed five-operation server does not, and the live runner reaches exactly the permissive path.

**Fix:** make `output_read_service` a startup and dispatch prerequisite for any server that exposes `complete-run`; refuse to start the live runner if it cannot construct one. Independently fail before publishing or recording completion when the seam is absent, rather than treating absence as the successful outcome string `"unconfigured"`. Preserve the existing idempotent repair path for a configured service whose mint fails after completion. Add a production-construction test for `run_supervisor.py` and a dispatch test that either refuses before state changes when the service is absent or proves a successful completion always has exactly one stream row before attestation can succeed.

**Test evidence:** `CompleteRunDispatchTests::test_complete_run_records_once` uses `_call`, which never supplies an output service, and asserts only `ok`, `recorded`, and `COMPLETED`; it therefore affirmatively passes on the defective path. The three completion crash-cut tests use the same helper and likewise never assert the mandatory stream row. `governed_acceptance.ConstructionTests::test_a_driver_without_an_output_service_is_refused_at_construction` protects only the `AcceptanceDriver` wrapper, not `_op_complete_run`, `serve_forever`, or the live runner. No test would fail when the live five-operation path returns success with `output_stream="unconfigured"`; the deciding sequence above does so at this commit.

### L-18 — P2 — the isolated signer accepts ambiguous protected-chain JSON with duplicate security fields

**File and symbol:** `engine/runtime/isolated_signer.py`, `IsolatedSigner._verify_chain_handles`.

**Exact input:** take the valid protected terminal-record bytes from `test_isolated_signer._build_store()` and insert `"run_id":"run-first-wins-attacker",` immediately after the opening brace, leaving the existing later `"run_id":"run-abc"` member intact. Store those bytes under their real SHA-256 handle, put that handle in otherwise valid attested evidence for `run-abc`, and call `sign_result`. The record now contains two `run_id` members. At this commit `json.loads` silently keeps the last one, `_verify_chain_handles` compares `run-abc`, and the deciding experiment returned `status=signed`; a first-member-wins JSON reader sees `run-first-wins-attacker` in the exact protected artifact named by the signed envelope.

**Consequence:** the isolated signer vouches for a content-addressed chain document that has no unique interpretation. Auditors, cross-language verifiers, or incident tooling using a first-wins or duplicate-rejecting parser can respectively attribute the same signed receipt to a different run or reject evidence the signer certified. This defeats the purpose of the signer's independent agreement check at the parser boundary: agreement is true only under Python's undocumented-for-this-protocol duplicate resolution, not over a canonical protected document.

**Fix:** parse every protected-chain artifact with the repository's strict duplicate-rejecting JSON decoder, reject non-finite constants, bound the raw byte length before parsing, and require the exact expected object schema and value types. Because the supervisor builders already emit canonical compact JSON, also require `raw == canonical(document)`; that removes duplicate keys, alternate encodings, and parser-dependent spellings in one gate. Add duplicate cases for every compared field with both attacker-first and attacker-last ordering.

**Test evidence:** `test_a_record_about_a_different_run_is_refused` covers one ordinary `run_id` whose value differs, and `test_a_chain_document_that_is_not_a_document_is_refused` covers a document missing required fields. Neither constructs duplicate keys; all `_chain_docs` fixtures serialize from dictionaries, which cannot represent them. No current test would fail if `json.loads` continued accepting a matching last duplicate, and the deciding two-key record is signed at this commit.

### L-19 — P2 — the isolated signer signs outputs larger than the protocol's hard 8 MiB ceiling

**File and symbol:** `engine/runtime/isolated_signer.py`, `IsolatedSigner._derive_output_bytes` / `_build_envelope_payload`.

**Exact input:** put an `8_388_609`-byte blob in the artifact store, update an otherwise valid terminal record and execution receipt to name its real handle, and submit matching valid attested evidence. At this commit `sign_result` returned `status="signed"` with `payload.output_bytes == 8_388_609`. The production file store permits this input because `kit_store.MAX_BLOB_BYTES` is 16 MiB. The governed-result and output-pull contracts accept only `0..8_388_608`.

**Consequence:** the isolated authority emits a cryptographically valid but off-contract receipt that every compliant desktop must block as `OutputTooLarge`; a completed model run is therefore irrecoverably converted into an unusable signed result. The signer also reads and hashes bytes beyond the output protocol's declared ceiling instead of refusing at the artifact boundary. In the older no-stream live path from L-17 this oversize envelope remains signable because no stream mint enforces the bound first.

**Fix:** share the single `MAX_OUTPUT_BYTES` constant with the signer and refuse when the verified output blob exceeds it before constructing or signing the envelope. Make the file-backed store accept a per-artifact read cap (or stat/read at most `MAX_OUTPUT_BYTES + 1` for the output handle), while retaining appropriate smaller caps for chain documents. Add boundary tests at exactly 8 MiB and at 8 MiB plus one using real content-addressed bytes.

**Test evidence:** `ValidSignTest` verifies the derived length only for the small `OUTPUT_MARKER`; `test_oversize_request_is_refused` enlarges a request string, not a store artifact. The downstream Rust tests correctly reject signed `output_bytes > MAX_OUTPUT_BYTES`, but there is no signer-side test requiring it not to issue such a signature. The deciding 8,388,609-byte artifact is signed at this commit.

### L-20 — P2 — a short provisioning write destroys the previous floor state or config

**File and symbol:** `engine/runtime/provision_floor_writer.py`, `_write_owned` (reached twice from `apply`).

**Exact input:** create a target containing a known-good document, then patch `provision_floor_writer.os.write` so its one call writes and returns `len(payload) - 1`, which is a legal successful `write(2)` result. Call `_write_owned(target, payload, uid, gid, 0o600)`. The function returns normally after fsync and atomically replaces the target with the truncated bytes. Through `apply`, the same result replaces either the authoritative `floor-state.json` or the TCB-owned service config; the later readback may reject, but the prior good file has already been discarded.

**Consequence:** an ordinary short write during first provisioning creates an unusable installation, and during `--reprovision` it irreversibly destroys the last good anti-rollback state or configuration before reporting failure. Atomic rename prevents readers seeing the temporary name; it does not make a partial payload complete. This is the provisioner's independent copy of the short-write defect in L-16.

**Fix:** loop until the complete buffer has been written, retry `InterruptedError`, and refuse zero progress; fsync only after the whole payload and the final ownership/mode metadata are installed, then rename and fsync the directory. On any incomplete write, unlink the temp and leave the old target untouched. Prefer one shared full-write atomic-publish primitive for the runtime writer and provisioner. Add a test that injects partial progress followed by zero/error and proves the old target remains byte-for-byte intact.

**Test evidence:** `engine/tests/test_provision_floor_writer.py::PublishIntoAServiceOwnedDirectory` covers symlink planting, exclusive temp creation, the ordinary payload and mode, but never changes `os.write`'s return count. The root boundary proof also uses ordinary filesystem writes. No current test would fail when a successful short write is treated as complete. The deciding injected-write experiment returned normally and left a 16-byte target for a 17-byte payload: `b'{"generation":10'`.

### L-21 — P2 — the broker's outbound-hop deadline starts after an unbounded blocking connect

**File and symbol:** `apps/desktop/src-tauri/broker/src/chain_executor.rs`, `linux::connect_hop` / `LinuxHopConnector::connect`.

**Exact sequence:** on Linux, have the challenge-authority, supervisor, or signer Unix listener stop accepting and fill its listen backlog; then submit a broker turn that reaches that principal. `UnixStream::connect(path)` is blocking and runs before `opened: Instant::now()` is captured, so the thread can remain inside `connect(2)` indefinitely. Neither `HOP_EXCHANGE_BUDGET` nor the read/write timeouts exist yet. The broker's request loop is serial, so later turns cannot be served while this one is stuck.

**Consequence:** one stalled or compromised trusted principal can wedge the shipped broker process indefinitely despite the advertised 30-second whole-exchange budget. The timeout closes silent and drip-fed peers only after a connection has been established; it is not a total hop deadline.

**Fix:** start one monotonic deadline before connection creation and perform a nonblocking AF_UNIX connect, polling for writability and checking `SO_ERROR` only within the remaining budget (using `socket2`/`nix`/`libc` as needed). Pass the same remaining deadline into request and reply I/O. Add a real-socket backlog-saturation test that proves the hop returns closed within the total budget without the listener accepting.

**Test evidence:** the four `transport_tests` either accept the connection immediately or test only `UnixHopConn` after `connect_hop` has returned. `the_shipped_connector_opens_every_hop_with_the_exchange_budget` likewise obtains a successful connection before inspecting the timer. No test fills the listen backlog. The source comment explicitly excludes `connect(2)` from the budget. A local backlog experiment could not be executed in this audit sandbox because `AF_UNIX` bind failed with `EPERM`; the settling experiment is the proposed listen-without-accept test on an ordinary Linux host.

### L-22 — P3 — the test named "writes no file" allows unlisted file-writing APIs

**File and symbol:** `apps/desktop/src-tauri/broker/src/chain_executor.rs`, `tests::the_governed_execution_writes_no_file_of_its_own` / `broker_production_code`.

**Exact input:** add `std::fs::copy(&report_path, format!("{report_path}.copy"))` inside `LinuxGovernedExecution::execute`. The test still passes: it merely asserts that the comment-stripped source contains none of four substrings (`fs::write`, `set_permissions`, `File::create`, `OpenOptions`), and `fs::copy` is not one of them. `std::fs::rename`, `hard_link`, or direct libc/syscall writes are equally invisible.

**Consequence:** the regression check can stay green when the broker regains exactly the file-publication capability its name and security commentary say it excludes. The adjacent protected-store-path scan may catch one specific field name, but it does not prove the broader named property and can be bypassed by a newly introduced destination.

**Fix:** replace the denylist with an allowlist over parsed Rust calls in the production module (permitting only the explicitly intended reads and cleanup), or structurally inject a read-only artifact reader so this execution path has no writable store capability. Mutation-test at least `copy`, `rename`, `hard_link`, `OpenOptions::new().write(true)`, and a direct syscall; each named test must go red.

**Test evidence:** the test itself is the deficient evidence. Its positive anchors prove only that source stripping retained `fn execute` and `recorder_store_dir`; they do not make the four-token blacklist exhaustive. No other test asserts that adding `fs::copy` or another unlisted writer fails the gate.

### L-23 — P3 — the broker accepts duplicate decision fields in trusted-hop replies

**File and symbol:** `apps/desktop/src-tauri/broker/src/chain_hops.rs`, `parse_reply`.

**Exact input:** `parse_reply("issue", br#"{"ok":false,"ok":true,"op":"wrong","op":"issue"}"#)` returns `Ok(...)`. `serde_json::from_slice::<Value>` silently keeps the last occurrence of each duplicate key, so both the success decision and the operation binding can have two contradictory values in the exact bytes received.

**Consequence:** the broker accepts a hop reply that has no unique JSON meaning. A first-member-wins logger, forensic reader, or cross-language implementation sees a refusal for another operation while the Rust broker proceeds as if its requested operation succeeded. This violates the design's strict duplicate-key rule at the boundary shared by the challenge authority, supervisor, and isolated signer. A fully compromised trusted principal can already lie, but an implementation bug or parser differential should fail closed rather than become an accepted chain transition.

**Fix:** decode hop JSON with a duplicate-rejecting deserializer before constructing a `Value`, while preserving the frame cap and exact op/boolean checks. Apply the same strict decoder to nested security objects consumed later, or deserialize each operation into a `deny_unknown_fields` typed reply after the common envelope has passed. Add attacker-first and attacker-last duplicates for `ok`, `op`, `reason`, and each operation's binding fields.

**Test evidence:** `a_malformed_reply_is_bad_reply` tests malformed syntax, missing/non-boolean `ok`, and non-object JSON; `a_reply_for_another_op_is_refused` tests one ordinary `op`. Every fixture is constructed from bytes with unique keys. No current test supplies duplicates, so the deciding input remains accepted.

### L-24 — P2 — a drip-fed renderer can hold the broker's only request thread forever

**File and symbol:** `apps/desktop/src-tauri/broker/src/main.rs`, `linux::serve` / `read_one_frame`.

**Exact sequence:** connect as the allowlisted renderer UID, declare any in-cap frame length, and send one byte every 119 seconds. `serve` sets a 120-second socket read timeout once, but that timeout applies to each blocking `read`, not to the whole frame. Every successful byte resets the wait. `read_one_frame` has no monotonic deadline and the accept loop is strictly serial, so the connection can remain active indefinitely and no later renderer connection is handled.

**Consequence:** any process sharing the renderer UID can permanently deny all governed turns without sending a complete request, despite the code presenting `CONN_IO_TIMEOUT_MS` as the fix for a peer holding the only thread. The silent-peer case is bounded; the slow-drip case is not.

**Fix:** capture one monotonic deadline immediately after accept, set each read timeout to only the remaining duration, and refuse once the total request budget is exhausted regardless of byte progress. Better, reuse a budgeted framed reader shared with the outbound-hop implementation. Add a real-socket test that drips prefix/body bytes just inside the per-read timeout and asserts the broker closes within the total deadline while continuing to serve a second client.

**Test evidence:** the broker binary end-to-end test sends complete frames and only places a timeout on its client-side response read. There is no silent-client or drip-client broker test. The outbound `chain_executor` tests do cover both cases using a monotonic remaining budget, demonstrating the intended distinction, but `read_one_frame` does not use that code. A live socket reproduction could not run in this audit sandbox because AF_UNIX bind is denied with `EPERM`; the deciding sequence above should be run on the ordinary Linux CI host.

### L-25 — P2 — the root-signed manifest does not authorize which key may attest supervisor evidence

**File and symbol:** `apps/desktop/src-tauri/broker/src/manifest_resolver.rs`, `resolve_production_key_pair`; underlying manifest shape in `brops_core::key_manifest::KeyManifest` / `ManifestKey`.

**Exact input:** root-sign a manifest containing two distinct unrevoked `production` keys, `A` and `B`, each with `allowed_protocols=["brops.governed-receipt-envelope.v1"]`; configure `signer_key_id=A` and `supervisor_attestation_key_id=B`. `resolve_production_key_pair` succeeds and returns B as the supervisor-attestation verifier even though the signed manifest has no `key_usage` field and therefore never authorizes B for `supervisor_attestation`. Swapping the two configured ids also succeeds. The only role separation enforced is that the ids and public-key bytes differ.

**Consequence:** the manifest signature covers key material, class, time, revocation and an envelope protocol, but the broker then acts on an unsigned-by-that-authority role assignment from deployment config. Any production receipt key admitted by the manifest can be repurposed as the supervisor-attestation authority, collapsing the intended independent roles if that key's custodian is compromised. The floor pins the config bytes at startup, so this is not a renderer-controlled swap, but it is weaker than the root-signed authority and type separation the canonical Wave 3b design requires.

**Fix:** add the signed `key_usage: receipt_signing | supervisor_attestation` discriminator (plus the role-specific fields) to `ManifestKey`; resolve each role through a distinct function that rejects the other usage. A supervisor-attestation key must not carry render trust/protocol/workspace scopes, and a receipt key must never verify evidence. Update manifest provisioning and canonical bytes together.

**Test evidence:** `two_distinct_production_keys_in_their_window_resolve_as_a_pair` is built from two identically shaped production receipt keys and expects success. `the_supervisor_key_is_held_to_class_revocation_window_and_protocol` specifically expects the supervisor key to carry the receipt-envelope protocol, not an attestation usage. Tests cover distinctness but none can test wrong usage because the signed type has no usage field; the deciding input is therefore affirmatively accepted. The design file itself marks this discriminator "NOT IMPLEMENTED" at this commit.

### L-26 — P3 — the preflight's documented success exit is unreachable on a real host

**File and symbol:** `apps/desktop/src-tauri/broker/src/preflight.rs`, `check_sudoers` / `Report::exit_code`; CLI contract in `broker/src/bin/preflight.rs`.

**Exact input:** run `brops-preflight` on Linux with a fully provisioned config, an existing absolute invoker program, and a correct working sudoers grant for the broker-to-sidecar vector. `check_sudoers` unconditionally returns `Status::Unmeasurable` whenever the program exists because the `Host` interface cannot perform the read-only grant probe. Consequently `Report::exit_code()` returns 2. There is no real-host input on which this requirement returns `Met`, so the documented exit 0 ("every requirement measured and met") cannot occur.

**Consequence:** automation and operators can never receive the preflight's advertised ready result, even when the machine satisfies the condition. A permanently inconclusive row also hides regressions: a valid, missing, and over-broad sudoers grant all produce the same status once the executable exists.

**Fix:** either add a bounded read-only sudoers probe (`sudo -n -l -U <broker>` parsed against the exact invoker vector, with no command execution) and make the row genuinely decidable, or remove exit 0/readiness claims and define the tool as a partial inventory. Prefer the former, while retaining `Unmeasurable` when the account database or sudo tooling cannot answer.

**Test evidence:** `a_provisioned_deployment_meets_everything_a_machine_can_meet` asserts only that `not_met()` is empty; it does not assert `unmeasurable()` is empty or `exit_code()==0`. The provisioned fixture therefore passes while the sudoers row remains unmeasurable. No test supplies a host answer for a valid or invalid grant because `Host` exposes no such method.

### L-27 — P2 — the preflight never runs the TCB integrity floor it claims to mirror

**File and symbol:** `apps/desktop/src-tauri/broker/src/preflight.rs`, `evaluate`, `check_pin_manifest_path`, and `check_pin_coverage` versus `broker/src/main.rs::build_governed_executor`.

**Exact input:** use the module's own `provisioned()` fixture as-is. Its pin manifest lists every required role, but for almost every TCB artifact it supplies `expected_sha256 = "00…00"` and provides no corresponding file or stat record. The preflight reports no `NotMet` requirement: it checks that the pin manifest parses and contains the required names, but never calls `verify_broker_tcb`/`verify_tcb_integrity` to read each file, match its digest, owner, mode, ancestry, or broker/config role. The real broker refuses this same deployment at the §2.5 floor before reading trust material.

**Consequence:** the diagnostic can say every machine-measurable prerequisite is met while omitting the actual reason the broker remains fail-closed: a missing, modified, wrongly owned, writable, symlinked, or unpinned-in-context TCB artifact. This contradicts the module's "same requirement set" and "all-met gets past build_governed_executor" contract and can send an operator to repair the wrong layer.

**Fix:** add a requirement that invokes the same `verify_broker_tcb` decision with the real config path, broker UID, and strictly parsed runtime-principal set, through a read-only host/probe seam. Report the specific `TcbViolation`; do not reduce the floor to parse + roster coverage. Make the all-provisioned fixture supply every artifact with correct bytes and custody, then mutate each required artifact's presence, digest, owner, mode, ancestry, and required broker/config role one at a time.

**Test evidence:** `a_provisioned_deployment_meets_everything_a_machine_can_meet` affirmatively passes on the deciding fixture with missing/zero-digest artifacts because it checks only `report.not_met()`. `an_under_covering_pin_manifest_names_the_unpinned_artifacts` tests list membership, not integrity. No preflight test changes a pinned ordinary TCB artifact's bytes or custody and expects the corresponding broker-floor refusal.

### L-28 — P2 — a floor-pinned root anchor may contain contradictory duplicate identity and provenance fields

**File and symbol:** `apps/desktop/src-tauri/broker/src/tcb.rs`, `parse_root_anchor`.

**Exact input:** pass `parse_root_anchor` the bytes `{"root_key_id":"attacker","root_key_id":"brops-tcb-root-1","public_key_hex":"abababababababababababababababababababababababababababababababab","public_key_hex":"3c83c2bc0e72c068824e2eebf663b6ed4cda337ff806c0b46e534aee19da0df5","provenance":"kit_generated","provenance":"external"}`. The document is below 4 KiB. `serde_json::from_slice::<Value>` keeps the last occurrence, so the parser returns the compiled external root and production-supporting provenance even though the same pinned bytes first declare a different identity, key, and lower custody.

**Consequence:** the broker can elevate a root-anchor document that has no unique interpretation into its production trust root. A first-member-wins auditor or cross-language verifier sees an attacker-controlled kit root, while this parser sees the external production root. Floor pinning proves the ambiguous bytes are the installed bytes; it does not make their meaning unique.

**Fix:** deserialize with the repository's duplicate-rejecting JSON path before examining fields, reject unknown fields, and require the canonical serialization of the exact three-field anchor schema. Add both attacker-first and attacker-last duplicate cases for `root_key_id`, `public_key_hex`, and `provenance`.

**Test evidence:** `a_well_formed_anchor_parses_with_the_provenance_it_states`, `an_anchor_with_no_or_unknown_provenance_is_refused_never_defaulted`, and `a_garbled_anchor_is_refused_by_the_name_of_what_is_wrong` cover unique-key objects, invalid values, and size, but none uses duplicate keys. The deciding three-pair document is accepted because every existing fixture is produced from a map or a unique-key format string.

### L-29 — P2 — the pin manifest's own path may traverse a runtime-writable ancestor

**File and symbol:** `apps/desktop/src-tauri/broker/src/tcb_probe.rs`, `read_pin_manifest_checked` / `manifest_custody_violation`.

**Exact sequence:** create two TCB-owned, mode-0644, well-formed pin manifests at `/opt/brops/releases/A/pin.json` and `/opt/brops/releases/B/pin.json`; let the configured path be `/run/user/1000/selected/pin.json`, where uid 1000 owns `/run/user/1000` and can atomically change the intermediate `selected` symlink from `.../A` to `.../B`. Invoke `read_pin_manifest_checked` with uid 1000 in `login_and_runtime_uids`. `O_NOFOLLOW` applies only to the final `pin.json`; the kernel follows `selected`, and `manifest_custody_violation` examines only the final file. Either root-owned manifest is accepted depending solely on the measured party's symlink choice.

**Consequence:** a login/runtime principal can select or roll back the document that defines the complete TCB floor, despite being forbidden from owning or writing that document itself. If an older still-present TCB-owned manifest admits older pinned binaries/configuration, the principal chooses the weaker trust set at broker startup. At minimum it can delete/redirect an intermediate component and deny governed service. The artifact floor checks ancestors of entries named *by* the manifest, but it cannot retroactively establish the authority of the manifest it already trusted.

**Fix:** open the pin-manifest path component-by-component from a trusted root with `openat2(RESOLVE_NO_SYMLINKS | RESOLVE_BENEATH)` or equivalent descriptor walk, and apply the same non-runtime-owned/non-writable predicate to every ancestor before parsing the final regular file. Bind the configured location to the expected deployment root. Add a test with a runtime-owned intermediate symlink alternating between two individually acceptable final files and require refusal before either is parsed.

**Test evidence:** custody unit tests vary only the final file's owner, mode, and regular-file bit. `the_checked_reader_takes_its_facts_from_the_descriptor_it_read` source-scans for final-component `O_NOFOLLOW` and explicitly proves only same-fd final metadata/read; it has no ancestor assertion. Artifact tests exercise writable ancestors only after a manifest has already been accepted. No test places an intermediate symlink or runtime-writable directory in the pin-manifest path.

### L-30 — P3 — TCB inputs are read wholly into memory without a size ceiling

**File and symbol:** `apps/desktop/src-tauri/broker/src/tcb_probe.rs`, `read_pin_manifest_checked` and `LinuxFsProbe::digest_through`.

**Exact input:** point `BROPS_TCB_PIN_MANIFEST` at a TCB-owned, non-group/world-writable regular file containing (for example) 8 GiB of JSON whitespace followed by a minimal manifest. `read_pin_manifest_checked` calls unbounded `read_to_string`, so broker construction attempts to allocate the entire file before parsing. Independently, make any pinned regular artifact 8 GiB: `LinuxFsProbe::digest_through` calls unbounded `read_to_end(&mut Vec::new())` merely to compute SHA-256.

**Consequence:** a malformed/misprovisioned TCB file can exhaust broker memory or stall startup instead of producing a bounded fail-closed diagnostic. This matters operationally at the production gate: the very integrity check intended to refuse bad deployment inputs can be killed by their size. Custody limits who can create the input but is not a parser/resource bound.

**Fix:** reject the pin manifest by descriptor metadata and a small explicit maximum before reading, then read at most cap+1 bytes. Stream artifact hashing through a fixed-size buffer (optionally with a defensible per-role maximum) rather than retaining file contents. Handle size changes during the read and keep the final digest/inode binding.

**Test evidence:** the root-anchor use-time reader tests exact-cap and over-cap behavior, but the pin-manifest reader has no size test and its API declares no maximum. `the_probe_digests_the_descriptor_it_stated_and_not_the_path_again` checks the descriptor path and inode comparison, not allocation bounds. No test would fail if either unbounded allocation remained.

### L-31 — P2 — a verified agent bundle can act on grant or flow bytes different from the bytes it hashed

**File and symbol:** `apps/desktop/src-tauri/core/src/agent_bundle.rs`, `verify` (`read`, file-table loop, and the later grant/flow reads).

**Exact sequence:** construct a valid bundle whose table hashes a narrow `grant.json`. Start `verify`; after the file-table loop has executed `read(&dir.join("grant.json"))` and accepted its hash/length, atomically rename a wider but valid grant over that path before `let grant_bytes = read(&grant_path)`. The second read is never compared to the manifest entry. `verify` returns a `VerifiedBundle` containing the wider grant under the digest of the narrow one. The same rename after the table loop and before the later flow read substitutes steps/edges under an unchanged digest. A symlinked table entry makes switching targets another form of the same sequence because neither `walk` nor `read` uses `O_NOFOLLOW`.

**Consequence:** approval and bundle identity bind one set of bytes, while execution can consume another set with additional capabilities, credential slots, egress names, or actions. The current call transport is deliberately unimplemented, which limits immediate network impact, but store steps and future transport consume the substituted verified object; the verifier's core authority invariant is already false.

**Fix:** open each bundle file once without following symlinks, require a regular file, read bounded bytes from that descriptor, and retain/parse those exact bytes after verifying their hash and length. Better, load every table entry into an immutable in-memory map during the one verification pass and construct `Grant`/`Flow` only from that map. Also bind directory traversal to an opened bundle directory (`openat2`/descriptor-relative opens) so component replacement cannot redirect a read. Add a deterministic test seam that swaps `grant.json` and `flow.json` immediately after their table verification and prove the old approved bytes are used or the verification refuses.

**Test evidence:** mutation tests rewrite files only *before* calling `verify`; none changes a file between the table read and the semantic read. `one_flipped_byte_in_a_file_is_refused_by_hash_not_loaded` proves a stable mismatch is caught, not that the bytes checked are the bytes loaded. No existing test controls the two reads independently or uses a symlinked entry.

### L-32 — P3 — ladder pull evidence labels a hash of base64 text as the hash of served bytes

**File and symbol:** `apps/desktop/src-tauri/core/src/bin/ladder_output_pull.rs`, `main`'s per-chunk evidence construction (`served_chunk_sha256`).

**Exact input:** have the sidecar return a valid chunk with `bytes_b64="AQI"`, the canonical base64url encoding of bytes `[0x01, 0x02]`. The driver records `sha256_hex(b"AQI")` in `served_chunk_sha256`; the field's comment and name claim the value is the digest of bytes the sidecar served, which would be `sha256_hex(&[1, 2])`. Those two digests differ.

**Consequence:** the evidence cannot be used to correlate the supervisor's served bytes with the driver's pre-mutation observation as documented. An investigator or checker recomputing a content digest gets a mismatch even on the positive path, or must silently know that the field hashes an encoding instead. This weakens the paired evidence intended to distinguish sidecar tampering from a supervisor serving the wrong range.

**Fix:** strictly decode `bytes_b64` first and record SHA-256 and length of the decoded bytes; if decoding fails, record no content digest and let the pull's malformed-reply result name the failure. If retaining an encoded-text digest is useful, give it a separate unambiguous field such as `served_chunk_b64_sha256`.

**Test evidence:** mutation tests decode and compare the altered bytes but do not construct or assert the evidence row. No test checks `served_chunk_sha256` against decoded content, and the evidence field is built inline rather than through a tested helper. The two-byte input above makes the mismatch deterministic.

### L-33 — P2 — the broker can publish a committed reply while its turn remains live

**File and symbol:** `apps/desktop/src-tauri/core/src/broker_orchestrator.rs`, `run_governed_turn` success path (`persist_committed` followed by ignored `broker_turns::settle`).

**Exact sequence:** initialize the normal broker-turn and message schemas, then add `CREATE TRIGGER reject_turn_settle BEFORE UPDATE OF state ON governed_broker_turns BEGIN SELECT RAISE(ABORT, 'settle failed'); END;`. Run a valid request with an executor returning an accepted output. `persist_committed` commits the message successfully; `settle(..., Committed)` returns an error, but `let _ =` discards it and the function returns `status="committed"`. The turn row remains `live`. An ordinary disk-full/I/O failure at that second write has the same state split without a trigger.

**Consequence:** the renderer is told the turn committed while the authoritative turn state says it is still in progress. The one-live-per-conversation index then blocks subsequent turns until stale reconciliation, which eventually marks this actually committed turn `blocked`; retries and forensic state disagree with the immutable message already published. The refusal paths similarly ignore a failed settle and can strand live turns.

**Fix:** persist the accepted message and transition its broker turn to `committed` in one SQLite transaction with checked row counts; only construct the committed reply after that transaction commits. For refusal paths, treat settle failure as a storage failure and provide a durable reconciliation record rather than ignoring it. Add fault-injection tests for failures before message insert, between insert/readback and settle, and at commit, asserting no externally committed reply can coexist with a live/blocked turn.

**Test evidence:** `happy_path_returns_committed_verified_message` asserts the returned message but never reads the corresponding turn row. `upstream_refusal_is_blocked_and_settles_the_turn` checks the ordinary successful settle only. No test forces `settle` to fail after `persist_committed`, and both call sites deliberately discard its `Result`.

### L-34 — P3 — the governed-result "strict" decoder accepts contradictory duplicate decision fields

**File and symbol:** `apps/desktop/src-tauri/core/src/governed_bridge_result.rs`, `BridgeTurnResult::parse_frame`; raw ingress in `core/src/governed_sidecar.rs`, `GovernedSidecar::round_trip`.

**Exact input:** take the raw JSON serialization of the module's valid `signed_frame()` fixture and place `"protocol":"wrong",` before its existing `"protocol":"bridge.governed-turn-result.v1"`, and `"ok":false,` before its existing `"ok":true`. `GovernedSidecar::round_trip` parses the sidecar stdout with `serde_json::from_str::<Value>`, which keeps the last occurrence of each duplicate. Passing that `Value` to `BridgeTurnResult::parse_frame` therefore returns `BridgeTurnResult::Signed` even though the exact wire document also states that it is a refusal under another protocol. The same construction works inside `receipt` for any transport echo by putting the accepted value last.

**Consequence:** the desktop accepts a governed-result document with no unique meaning. A first-member-wins logger, forensic reader, or cross-language implementation sees a refusal under the wrong protocol while this Rust path proceeds to signature verification and, if the genuine signed material is present, output pulling. The duplicate cannot forge the two signatures, so this is not a success forgery by itself, but it violates the protocol's explicit duplicate-key rejection at the decision boundary and makes the accepted wire evidence parser-dependent.

**Fix:** duplicate-reject the raw stdout bytes before constructing a `Value`, ideally by making the sidecar transport return bounded bytes and having one strict decoder own syntax, duplicate detection, and the exact object schema. Do not expose a security parser that accepts only a `Value`, because duplicate information has already been erased by then. Apply the same decoder to nested objects and add attacker-first and attacker-last duplicate cases for `protocol`, `ok`, `error`, and every receipt echo.

**Test evidence:** all parser fixtures are made with `serde_json::json!` or mutated `Value` maps, neither of which can represent duplicate keys. Tests cover wrong unique protocol values, non-boolean unique `ok` values, unknown keys, and altered unique echoes, but none enters through `GovernedSidecar::round_trip` with duplicate raw members. No current test would fail while last-member-wins parsing remains in front of the claimed strict decoder.

### L-35 — P3 — upgrading an existing broker database leaves the old one-state trust constraint in force

**File and symbol:** `apps/desktop/src-tauri/core/src/governed_message_store.rs`, `create_schema` / `persist_committed`.

**Exact sequence:** create `governed_messages` with the preceding shipped schema's constraint `CHECK (trust_state = 'trusted_verified')`, then start this commit and call `create_schema`; `CREATE TABLE IF NOT EXISTS` succeeds without changing that table. Next call `persist_committed` with a valid accepted body and `TrustState::DemonstrationCustody`. The Rust-side closed set and current source schema admit `"demonstration_custody"`, but the retained old SQLite constraint rejects the insert and `persist_committed` returns `CommitReadbackMismatch` with no message. The module comment explicitly identifies this exact retained-schema state.

**Consequence:** a broker database created by the earlier version cannot commit a valid demonstration-custody governed turn after upgrade, while a fresh database at the same code accepts it. Runtime behavior therefore depends on install history, and the supported custody classification becomes an unexplained delivery failure until an operator deletes or manually rebuilds the broker database.

**Fix:** version the broker schema and transactionally migrate the table: create the current table with the two-value constraint, copy and validate existing rows, replace the old table, and record the migration version. Refuse startup with a specific schema-version diagnostic if migration cannot complete; do not defer the mismatch until a verified turn is being committed.

**Test evidence:** every test creates a new in-memory table through the current `create_schema`, so every fixture starts with the two-value constraint. There is no upgrade test that first creates the former one-value schema, runs current initialization, and commits `DemonstrationCustody`; no current test would fail when `IF NOT EXISTS` leaves the incompatible constraint untouched.

### L-36 — P3 — the configured sidecar invoker is accepted without proving that it changes principal

**File and symbol:** `apps/desktop/src-tauri/core/src/governed_sidecar.rs`, `SidecarPrincipal::from_config` / `GovernedSidecar::command`.

**Exact input:** use `{"principal":"brops-sidecar","invoker":["/bin/sh","-c","exec \"$@\"","brops-sidecar","/usr/bin/env"]}` as the deployment `sidecar` block. It has at least four tokens, starts with an absolute program, ends in `env`, and contains the exact account name at an interior position, so `from_config` accepts it. The resulting command is `/bin/sh -c 'exec "$@"' brops-sidecar /usr/bin/env … python sidecar.py`: `brops-sidecar` is only the shell's `$0`, and `exec "$@"` launches `env` and the sidecar under the broker's unchanged uid.

**Consequence:** a configuration that satisfies the validator's advertised "become a different OS principal" rule can launch the sidecar as the broker. The supervisor's independent uid and principal-collapse checks should then refuse the relay, so the demonstrated result is a fail-closed deployment outage rather than a supervisor bypass; nevertheless, this validator certifies exactly the forbidden command shape and starts a process from it. If any other consumer relies on `SidecarPrincipal` as proof of an identity transition, the type supplies proof it did not establish.

**Fix:** stop trying to infer principal-changing semantics from arbitrary argv. Represent one supported launcher grammar structurally (for example, an absolute, custody-verified `sudo` executable plus fixed `-n -u <principal> -- /usr/bin/env` tokens), or replace the launcher with an in-process, checked uid/gid transition performed immediately before `exec`. At startup, resolve the configured account to uid and refuse broker/sidecar uid equality; retain the supervisor's peer-credential check as the authoritative post-spawn enforcement.

**Test evidence:** the shared case table covers length, token types, absolute `invoker[0]`, the final `env` name, and whether the account text appears anywhere in `invoker[1..last]`. It has no accepted-looking launcher that treats the account token as inert data. `the_distinct_principal_command_runs_the_invoker_and_names_the_account` asserts only argv shape; it never observes the child's uid. No test would fail for the `/bin/sh` input above.

### L-37 — P3 — invalid UTF-8 sidecar output is silently rewritten into acceptable JSON

**File and symbol:** `apps/desktop/src-tauri/core/src/governed_sidecar.rs`, `GovernedSidecar::round_trip`.

**Exact input:** have a successful sidecar process write the byte sequence `b"{\"ok\":false,\"error\":\"bad\xffbyte\"}"` to stdout and exit zero. Those bytes are not a JSON text because JSON strings are Unicode and `0xff` is invalid UTF-8. `String::from_utf8_lossy` replaces the byte with U+FFFD, after which `serde_json::from_str` succeeds and `round_trip` returns `Ok({"ok":false,"error":"bad�byte"})` rather than a transport/parser error. The same substitution can be placed in an unchecked textual field of an otherwise valid reply.

**Consequence:** the accepted document is not the document the child emitted, and stored/logged evidence can contain replacement characters that conceal the original bytes. Downstream strict validators are deprived of the chance to reject a non-JSON wire message; whether the mutation is harmless prose or a material field then depends on each caller's field coverage. This compounds the raw-ingress ambiguity in L-34, although it does not by itself forge a signed decision.

**Fix:** replace `String::from_utf8_lossy` with `std::str::from_utf8(&obuf)` (or deserialize directly from the byte slice with a parser that rejects invalid UTF-8 and duplicate keys), returning a named transport error on the first invalid byte. Preserve a bounded byte digest/escaped diagnostic if forensic identification of malformed output is needed; never repair it before validation.

**Test evidence:** stdout-cap tests operate on arbitrary bytes but never pass them through `round_trip`, and all reply fixtures are Rust UTF-8 strings or `serde_json::Value`s. There is no child fixture that emits invalid UTF-8 inside an otherwise parseable object, so no current test distinguishes strict decoding from the lossy conversion.

### L-38 — P3 — the broker authenticates a reconstructed receipt envelope rather than the exact envelope bytes it received

**File and symbol:** `apps/desktop/src-tauri/core/src/governed_verification.rs`, `OwnedReceiptEnvelope::from_payload` and `verify_and_accept`; production decode sites in `broker/src/ladder_executor.rs` and `broker/src/chain_executor.rs`.

**Exact input:** begin with any valid canonical `envelope_jcs` and its genuine isolated-signer signature, then insert `"run_id":"run-OTHER",` immediately before the original `"run_id":"run-1"` without changing the signature. Keep the rest of the signed result, attestation, expected request, output, and freshness inputs genuine. Both production callers first run `serde_json::from_slice::<Value>`, which keeps the last duplicate; `OwnedReceiptEnvelope::from_payload` reads `run-1`, accepts no exact-key/canonicality condition, and `verify_and_accept` reconstructs the original 23-key canonical payload. The unmodified signature therefore verifies and the turn is accepted even though the exact `envelope_jcs` bytes carrying it were never signed. Adding an ignored unknown member instead of a duplicate has the same signature-preserving result.

**Consequence:** an intermediary can alter the supposedly signer-authenticated envelope artifact while preserving acceptance. The accepted output/run still follow the last, genuinely signed values, so this input does not forge a different committed reply; however, a first-member-wins forensic reader sees `run-OTHER`, an unknown member can falsely appear signer-authored, and the stored/relayed evidence is no longer the byte string whose signature the broker claims to have verified. This defeats the envelope's canonical, unambiguous evidence contract and creates a cross-language parser differential at the final acceptance boundary.

**Fix:** make the production entry point take the bounded raw `envelope_jcs` bytes, strict-deserialize them with duplicate rejection and the exact 23-key schema, reconstruct the canonical payload, and require byte-for-byte equality with the received bytes. Verify the detached signature over those exact canonical received bytes. Do not expose a security parser that begins from `serde_json::Value`, where duplicates and original spelling/order have already been erased.

**Test evidence:** verification tests build `ReceiptEnvelope` structs directly and sign `payload_jcs()`; parity asserts the reconstructed canonical bytes, not rejection of a different raw encoding. `OwnedReceiptEnvelope::from_payload` has no duplicate, unknown-key, or noncanonical-byte tests, and neither production caller compares `signed.envelope_jcs()` with `payload_jcs()`. No current test mutates raw envelope bytes while retaining the genuine signature.

### L-39 — P2 — the durable manifest floor can be lowered by a holder of a stale snapshot

**File and symbol:** `apps/desktop/src-tauri/core/src/key_manifest.rs`, `check_and_persist` / `write_floor_atomically`.

**Exact sequence:** write an epoch-5 floor and parse it once into `stale`. Call `check_and_persist(&stale, manifest_epoch_7, path)`; it returns epoch 7 and the file now contains 7. Without rereading, call `check_and_persist(&stale, manifest_epoch_6, path)`; it also returns `Ok` and blindly replaces the file with epoch 6. A fresh process now parses 6 and no longer knows that epoch 7 was accepted. Two broker processes that both read epoch 5 before either writes produce the same sequence naturally; no malformed file or failed syscall is required.

**Consequence:** the advertised durable anti-rollback floor is not monotonic across concurrent/stale holders. An older still-genuinely-root-signed manifest can become acceptable again after a higher epoch was successfully accepted, restoring keys, scopes, or revocation state the higher manifest superseded. The deterministic shared `.tmp` name also lets concurrent writers interfere before rename, adding denial/floor-corruption outcomes, but the sequential stale-snapshot sequence alone proves the rollback.

**Fix:** serialize the whole read/compare/write operation with an inter-process lock whose custody matches the floor, then reread and strictly parse the authoritative floor while holding that lock; compare against that current value, publish through a uniquely and exclusively created temp file, fsync/rename/fsync, and release only afterward. Alternatively put the floor in a database transaction with a monotonic conditional update. Do not accept a caller-supplied `AntiRollbackFloor` as the authoritative compare value.

**Test evidence:** `a_persisted_advance_is_what_the_next_process_reads` rereads epoch 6 before its next comparison, so it tests only a cooperative sequential caller. No test retains a floor snapshot, advances the file through another holder, and then attempts a lower advance with the stale value; no test runs two `check_and_persist` calls concurrently. The deciding two-call sequence therefore stays green while ending with the lower floor.

### L-40 — P3 — the manifest authority keeps an expired key trusted for the lifetime of the process

**File and symbol:** `apps/desktop/src-tauri/core/src/manifest_authority.rs`, `ManifestReceiptKeyAuthority::new` / `ReceiptKeyAuthority::resolve`.

**Exact sequence:** put a production key with `valid_from_ms=1` and `valid_to_ms=1001` in an otherwise valid externally rooted manifest, construct `ManifestReceiptKeyAuthority::new(..., now_ms=1000)`, then retain that authority past time 1001 and call `resolve(key_id)`. Construction caches only `(key_id, public_key)` for every key that was in-window at 1000. `resolve` takes no clock or trusted turn context and therefore continues returning `KeyResolution::Trusted` indefinitely after `valid_to_ms`.

**Consequence:** if this currently unwired authority is connected as its module documentation anticipates, a long-running desktop can accept receipts under an expired production key until restart. Manifest revocation, protocol scope, and the time window are all collapsed into a one-time startup decision instead of being enforced at the receipt decision.

**Fix:** do not cache a bare trusted key. Retain the immutable verified manifest snapshot and resolve each receipt with a trusted query carrying `now_ms`, protocol, workspace, install, and supervisor context; re-check validity, revocation, scope, and the durable floor inside the verification transaction. This is also the shape required by the Wave 3b design's `KeyResolutionQuery`. If this dead alternative is not going to be wired, delete it rather than preserving a weaker resolver beside the broker's live one.

**Test evidence:** `resolves_a_production_key_and_rejects_everything_else` supplies one fixed construction time and calls `resolve` immediately. There is no test that advances time after construction; the trait method has no time argument with which such a test could make the decision change. The module explicitly says nothing constructs this type outside its tests, so the defect is latent at this commit rather than reachable from the shipped path.

### L-41 — P3 — a short stored bundle digest panics the scheduler while it holds the database mutex

**File and symbol:** `apps/desktop/src-tauri/core/src/repo.rs`, `agent_runs::enqueue_due` (`&digest[..12]`).

**Exact sequence:** in an otherwise migrated database, insert `agent_bundles(bundle_digest='x', bundle_id='agt-x', bundle_version=1, display_name='X', ...)` and the FK-valid active row `agent_bundle_active(bundle_id='agt-x', bundle_digest='x', interval_ms=1, ...)`; create any store directory; then call `agent_runs::enqueue_due(&conn, 1000, store_root)`. Bundle verification first returns a normal refusal because `store_root/x` is not a valid bundle, but constructing the refusal run id then evaluates `&digest[..12]` and panics because the one-byte string has no byte boundary at 12. The same state is reachable through the public `register` and grant-gated `set_active` APIs because neither validates that the digest is exactly 64 lowercase hex characters.

**Consequence:** malformed persisted/configuration input turns a fail-closed bundle refusal into a process panic. The production scheduler calls this path while holding the shared `rusqlite::Connection` mutex, so unwinding poisons that mutex; subsequent desktop commands and scheduler ticks then fail at the lock rather than merely refusing the bad bundle. A non-ASCII digest long enough in characters but shorter than 12 bytes at a UTF-8 boundary can likewise make the byte slice land inside a code point.

**Fix:** validate the bundle identity once at both write boundaries (`register` and `set_active`) as exactly 64 lowercase ASCII hex characters, mirror that invariant with SQLite `CHECK` constraints/migration, and treat any legacy row that violates it as a typed refusal. Do not slice identifiers for presentation; derive the id with `digest.get(..12).ok_or(...)` only after validation or use a character-safe bounded prefix. Validate `interval_ms > 0` at the same boundary.

**Test evidence:** every test obtains its digest from `agent_bundle::build`, so every fixture has the expected 64-byte lowercase-hex shape. Tamper tests alter files beneath that valid directory name. There is no direct API or migrated-database test with an empty, short, non-ASCII, slash-bearing, or absolute digest, and no test asserts that a malformed active row produces a refusal without poisoning the scheduler lock. No current test would fail if the unchecked slice remains.

### L-42 — P3 — the Rust acceptance state machine exposes an ungated transition past lease expiry

**File and symbol:** `apps/desktop/src-tauri/core/src/supervisor_ledger.rs`, public `advance` with `Advance::ExecutionStarting`, versus `gate_and_start`.

**Exact sequence:** create an acceptance whose persisted lease window is `issued=1_000_000, expires=1_210_000`, advance it to `LEASE_READY`, then at `now_ms=1_210_001` call `advance(conn, attempt, &Advance::ExecutionStarting, now_ms)` directly. The state changes to `EXECUTION_STARTING`. Calling the intended `gate_and_start` at the same instant instead changes it to terminal `EXPIRED` with `lease_expired`.

**Consequence:** the type/API does not enforce its own step-8a production rule: any future caller of the otherwise currently unwired Rust supervisor can legally cross the only pre-launch expiry gate and spawn under an expired lease. The SQL transition trigger independently blesses the same `LEASE_READY -> EXECUTION_STARTING` edge because it cannot tell whether the gate ran. This is latent at this commit—the module documents that the acceptance state machine has no non-test caller—but it becomes a launch authorization bypass as soon as that declared-unreachable implementation is wired.

**Fix:** remove `ExecutionStarting` from the public `Advance` vocabulary. Make the raw transition private and callable only from `gate_and_start`, which must read the persisted window and own the guarded state change in one transaction. If callers need the general transition API, split a public enum that excludes this edge from a private internal edge. Add a compile-time/API test or a test-only mutation hook proving that no public operation can move an expired `LEASE_READY` row to `EXECUTION_STARTING`.

**Test evidence:** `gate_and_start_proceeds_and_expires_deterministically` proves the intended wrapper behaves correctly, but `legal_transition_chain_succeeds` bypasses it by calling `advance(...ExecutionStarting...)` directly and expects success without any lease-clock check. No test expires a row and then tries every public transition; no current test would fail if a production caller used the bypass exactly as that legal-chain test does.

### L-43 — P2 — the TCB integrity floor accepts relative artifact paths and therefore skips the absolute ancestor chain

**File and symbol:** `apps/desktop/src-tauri/core/src/tcb_integrity.rs`, `verify_artifact` / `ancestor_dirs`.

**Exact input:** take a full otherwise-valid `TcbPinManifest`, replace the `trusted-verifier-broker.bin` entry's path with `broker`, and have the probe return the expected owner, non-writable flags, and pinned hash for `broker`. Keep every other required artifact clean. `verify_tcb_integrity` returns `Ok(())`: `ancestor_dirs("broker")` returns an empty vector, so the verifier never inspects the process working directory or any ancestor up to `/`. The same bypass works with `relative/dir/broker`; only relative string prefixes are inspected, not the absolute directories that actually control lookup.

**Consequence:** a malformed but otherwise root-pinned deployment manifest can satisfy the advertised P0 code-integrity floor without establishing that the directories which resolve a TCB executable/config are TCB-owned and non-writable. After the startup hash measurement, a login/runtime-writable current directory can rename or replace the relative path before a later path-based launch/read, defeating the exact rename/replace protection the ancestor rule is meant to provide. Because this verifier is the production gate's integrity predicate, accepting this shape makes the gate's green result stronger than its evidence.

**Fix:** reject every artifact path that is not an absolute, normalized platform path before probing it; on Unix require a leading `/`, reject `.`/`..`, repeated/trailing ambiguity as appropriate, and derive ancestors with `std::path::Path::ancestors` from the normalized absolute path. The production probe/consumer should retain and use the verified descriptor where possible, or re-open relative to a verified directory descriptor. Apply equivalent platform-specific absolute-path validation on Windows rather than sharing Unix string rules.

**Test evidence:** all manifest fixtures use absolute `/opt/...` or `/etc/...` paths. `ancestor_dirs_walks_up_to_root` explicitly asserts that `ancestor_dirs("noslash")` is empty, but no test passes such a path through `verify_tcb_integrity` and expects refusal. A mutation that changes one pinned path to `broker` while adding matching fake facts leaves the current floor green; there is no test for relative paths, `.`/`..`, or normalization aliases.

## Notes

Pending.

## Production-gate refusals

Pending.

## Test coverage of relied-upon security checks

Pending.

## Verdict and scope accounting

UNFINISHED — audit in progress.
