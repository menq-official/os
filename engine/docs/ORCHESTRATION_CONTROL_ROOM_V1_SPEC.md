# Bro Orchestration and Control Room V1 — Scope Specification

**Status:** Phase 1 canonical contracts merged to `main`  
**Reviewed:** 2026-07-15  
**Repository:** `menqstudio/Bro`  
**Approved candidate HEAD:** `4edb441838a79ae12779f21b6de9800c06a177be`  
**Merge commit:** `9f847a29b2b37c33eb6a9a6c9fd468e4d8a045ad`

## 1. Purpose

Define the first owner-facing product layer above the merged Execution Control Plane V2 without weakening its security boundaries.

Phase 0 specification and Phase 1 canonical orchestration contracts are complete and merged. This baseline includes the orchestration SST, event and command schemas, deterministic Control Room projection, validator wiring, negative tests, and canonical registry integration. Orchestration Runtime V1 foundation was subsequently merged in PR #6, and the governed read-only Control Room API V1 was merged in PR #8. Visual UI, production credentials, external evidence services, deployment, and production automation remain separate scopes.

## 2. Locked actors

- Gev is the owner and final approval authority.
- `bro-000` is the only conductor and owner-facing conversational agent.
- Specialist agents keep immutable canonical IDs.
- Builders cannot self-verify medium, high, or critical work.
- Only the canonical Push Executor may perform release transport under Release Grant V3.

## 3. Canonical orchestration SST

The canonical source is:

```text
orchestration/registry.json
```

It owns task lifecycle states and transitions, queue classes, routing policy, verifier separation, checkpoint and budget policies, governed commands, recovery/quarantine semantics, and Control Room surface contracts. No competing orchestration truth may be added to prose, analytics files, runtime code, or UI code.

## 4. Merged lifecycle and boundaries

The merged lifecycle is fail closed from `draft` through approval, queueing, routing, running, verification, recovery/quarantine, and terminal states. Every event binds task identity, sequence, previous/next state, actor identity, time, reason, evidence, correlation, and repository binding when code mutation is involved.

Unknown states, impossible transitions, broken event chains, stale commands, invalid actor identity, missing evidence, expired commands, and mutation events without repository binding are denied.

Control Room remains read-first. V1 command contracts cover approve, deny, cancel, retry, reassign, and request-verification; direct repository, credential, evidence-ledger, or release mutation from UI is forbidden.

## 5. Verification evidence

- exact candidate HEAD: `4edb441838a79ae12779f21b6de9800c06a177be`
- GitHub Actions run `29376410325`: Windows GREEN and Ubuntu GREEN
- independent exact-head artifact audit in a temporary real Git worktree: foundation GREEN
- unique full suite: 102/102 GREEN
- targeted orchestration tests: 5/5 GREEN, included in the 102 total
- documentation inventory: 60/60
- open P0/P1 findings at merge: none

## 6. Subsequent runtime merge

Orchestration Runtime V1 foundation is merged in PR #6 at merge commit `8b454d934c779f534d459c47976e3aaba424a70c`. It implements durable task contracts, append-only hash-chained records, deterministic queue claims, cross-process serialization, expiring leases, checkpoints, budgets, cancellation, recovery, projections, and integrity checks.

## 7. Subsequent API merge

Control Room API V1 is merged in PR #8 at merge commit `3bbe41492ff819160742c325e7d158476856dc59`. It exposes integrity-bound mission, task, queue, canonical agent, checkpoint, budget, approval, recovery/quarantine, and audit read models plus validation-only command intent.

## 8. Next phase

The next scoped phase is **Control Room visual surfaces V1**. It must consume the merged API without creating competing lifecycle, authorization, integrity, or mutation truth. Production credentials, external evidence-service deployment, distributed queue/database deployment, direct repository/release mutation, BroPS, deployment, and production rollout remain separate scopes.
