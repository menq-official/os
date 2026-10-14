# Database Schema Contract

BroPS uses SQLite in WAL mode with foreign keys enabled. Migrations are ordered, immutable SQL files.

## Tables

The numbered migrations under `src-tauri/core/schema/` (`0001` … `0026`, the twenty-six files `db::migrate` applies in `src-tauri/core/src/db.rs`) are the app database's schema; this list is read off them (`grep -ohE "CREATE TABLE (IF NOT EXISTS )?[a-z_0-9]+" src-tauri/core/schema/0*.sql`, less the one transient name below). Thirty-four tables:

agent_bundle_active, agent_bundles, agents, approvals, audit_events, automation_runs, automations, conversation_participants, conversations, credential_bindings, decisions, demonstration_verified_messages, events, flow_receipts, flow_runs, integrations, knowledge_notes, library_items, memory_entries, messages, notifications, projects, receipt_challenges, receipt_ids_seen, receipt_verification_attempts, research_items, run_steps, runs, scheduler_ticks, settings, store_write_records, task_dependencies, tasks, workspaces — plus the FTS5 table `search_index` and the `_migrations` ledger, which `db::migrate` creates itself.

*(This section listed `users`, `commands`, `tool_calls`, `memories`, `file_records`, `knowledge_items` and `conversation_members`. None of them was ever created; the names that were are `memory_entries`, `knowledge_notes` and `conversation_participants`.)*

*(Until 2026-10-14 the list had forty-three names, nine of which are not tables of the app database. `receipt_verification_attempts_v16` exists only inside migration `0016`, which creates it, drops the old `receipt_verification_attempts` and renames the new one to that name. The other eight — `governed_evidence_head_floor`, `governed_output_streams`, `governed_turn_acceptance`, `governed_turn_completion`, `governed_turn_outbox`, `governed_turn_staging`, `governed_turn_staging_chunk`, `governed_turn_staging_session` — are in `supervisor_ledger.sql`, which sits in the same directory and which `db::migrate` does not apply. `supervisor_ledger::create_schema` applies it, and its callers are the broker (`src-tauri/broker/src/main.rs`), the `win-live` crate and the `proof` binaries: those tables belong to the broker's database.)*

## Indexes

Read off the same twenty-six files — twenty-eight indexes over twenty-seven column sets:

- tasks(project_id, status, updated_at)
- messages(conversation_id, created_at)
- runs(status, updated_at)
- run_steps(run_id, position) — indexed twice: a plain index (migration `0006`) and a UNIQUE one, `idx_run_steps_run_pos` (migration `0011`)
- approvals(status, requested_at) and approvals(entity_id, status)
- notifications(read_at, created_at)
- audit_events(entity_type, entity_id, created_at)
- projects(workspace_id, status), conversations(kind, updated_at), decisions(status, updated_at), memory_entries(scope, updated_at), knowledge_notes(updated_at), library_items(updated_at), research_items(updated_at), events(starts_at), integrations(status), automation_runs(automation_id, ran_at), flow_runs(state, bundle_digest), task_dependencies(task_id), task_dependencies(depends_on_id)
- conversation_participants(conversation_id) (`0017`), store_write_records(subject_kind, subject_id, seq) (`0021`), receipt_verification_attempts(receipt_id) and receipt_verification_attempts(verified_at) (`0014`, created again by `0016` after it rebuilds the table)
- integrations(auth_ref), partial: `WHERE auth_ref IS NOT NULL` (`0022`)
- receipt_verification_attempts(message_id), UNIQUE and partial: `WHERE message_id IS NOT NULL` (`0023`)

*(Until 2026-10-14 this list stopped at the `task_dependencies` line: it left out the six indexes of the last three lines and did not say that `run_steps(run_id, position)` is also a UNIQUE index.)*

*(The contract asked for `runs(command_id, created_at)`, `approvals(status, created_at)` and `knowledge_items(content_hash)`. No `command_id` or `content_hash` column exists.)*

## Integrity

Foreign keys are required. JSON columns store versioned envelopes. Secret values are never stored in SQLite; only secret references are stored. Full-text search is one standalone FTS5 table, `search_index` (migration `0010`), kept in step by triggers. Backups are transactionally consistent snapshots and include schema version metadata. **Not implemented** (read against the code 2026-10-14): there is no backup. No command, module or migration under `src-tauri/` takes, stores or restores one; a case-insensitive search for `backup` over its `.rs`, `.sql`, `.toml` and `.json` files finds only the `.tfstate` deny pattern in `src-tauri/src/files.rs` and the Windows flag `FILE_FLAG_BACKUP_SEMANTICS`. The sentence is the specification.

## Migration policy

Migrations MUST be forward-only. Destructive migrations require an export, backup verification and explicit owner approval. Application startup MUST refuse to open a database newer than the supported schema version. **Not implemented:** `db::migrate` (`src-tauri/core/src/db.rs`) skips the versions already applied and applies the missing ones, and never compares the database's highest applied version with `SCHEMA_VERSION` — that constant is read by nothing outside tests. An older binary opening a newer database is therefore not refused today.