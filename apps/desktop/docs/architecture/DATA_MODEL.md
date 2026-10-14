# BroPS Data Model

Status: Implementing

## Core entities

- User: owner identity, preferences, locale, theme.
- Workspace: bounded operating surface.
- Project: goal, state, participants, files, decisions and tasks.
- Task: actionable work item with owner, status, priority, due date and dependencies.
- Agent: specialist identity, capabilities, policy, model and runtime state.
- Conversation: direct or group thread containing messages and execution references.
- Message: immutable authored content with attachments and provenance.
- Command: normalized user intent submitted to Bro.
- Run: execution instance for a command or automation.
- Step: atomic run unit with input, output, status and evidence.
- ToolCall: requested external or local action.
- Approval: owner decision required before a protected action.
- Decision: durable accepted choice with rationale and consequences.
- Memory: reviewed personal or operational fact with source and retention class.
- KnowledgeItem: indexed document, note, URL or artifact.
- FileRecord: local file metadata, checksum and associations.
- Notification: user-facing event with read and action state.
- Automation: trigger, conditions, action plan and safety policy.
- AuditEvent: append-only record of material state changes.

*(Read against the code 2026-10-14.)* The nineteen entities above are the specified model. Fifteen of them have a table in the app database, under these names: `workspaces`, `projects`, `tasks` (with `task_dependencies`), `agents`, `conversations`, `messages`, `runs`, `run_steps` (Step), `approvals`, `decisions`, `memory_entries` (Memory), `knowledge_notes` (KnowledgeItem), `notifications`, `automations`, `audit_events`. Four have none — **User, Command, ToolCall and FileRecord**: no migration under `src-tauri/core/schema/` creates a `users`, `commands`, `tool_calls` or `file_records` table ([DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) lists the thirty-four that exist), and `src-tauri/core/src/domain.rs` has no struct for any of the four.

## Relationships

A Project has many Tasks, Conversations, Decisions, Files and Runs. A Task may depend on other Tasks and may be assigned to a User or Agent. A Command creates zero or more Runs. A Run has ordered Steps and ToolCalls. Protected ToolCalls require an Approval. KnowledgeItems and Memories may be linked to Projects, Tasks, Conversations and Decisions. Every material mutation produces an AuditEvent.

*(Read against the code 2026-10-14.)* The relationships that run through the four unpersisted entities are not in the schema: `runs` has no command column (its columns are `id`, `intent`, `status`, `plan`, `created_at`, `updated_at` — migration `0005`), nothing stores a tool call, and an approval is tied to its subject by `approvals.entity_type` / `entity_id`, which for a run is a `run_step`.

## State rules

- IDs are UUID **v4** strings (`brops_core::id()` calls `Uuid::new_v4`); they are opaque text everywhere in the schema, and nothing relies on their ordering. This line said UUIDv7.
- Timestamps are epoch-millisecond text, zero-padded to 13 digits (`brops_core::now()`). This line said UTC ISO-8601.
- User-authored records are never silently overwritten.
- Message, Decision and AuditEvent records are append-only; corrections create superseding records.
- Deletion defaults to soft delete and tombstones.
- *(Read against the code 2026-10-14 — the two lines above are the specification, and the store does this instead.)* **Deletion is hard deletion.** No migration has a `deleted_at` column or a tombstone, and `src-tauri/core/src/repo.rs` removes the row with `DELETE FROM` in seven places: `conversations`, `knowledge_notes`, `memory_entries`, `library_items`, `research_items`, `events`, `automations`. **Messages are not append-only against their conversation:** `messages.conversation_id` is `ON DELETE CASCADE` (migration `0003`), so deleting a conversation deletes its messages; apart from that nothing updates or deletes a message. A decision is only ever inserted and listed (`repo::decisions` has `create` and `list`), so there is no correction and no superseding record. `audit_events` is only inserted into.
- Every external result stores provider, model/tool, request correlation and evidence references.
- Local database is authoritative for device state; sync is an optional later capability.

## Canonical enums

TaskStatus: inbox, planned, active, blocked, review, done, cancelled.
RunStatus: drafted, queued, planning, awaiting_approval, running, paused, succeeded, failed, cancelled.
ApprovalStatus: pending, approved, rejected, consumed, escalated — the set the database trigger admits (migrations `0011` and `0019`). This line said `expired, revoked`, which the trigger refuses; `ApprovalStatus` in `src/domain/enums.ts` still says `expired | cancelled` and is wrong in the same way.
AgentStatus: offline, idle, observing, thinking, working, blocked, review, failed, completed — as in `src/domain/enums.ts`; there is no `error` status and no database guard on this column.
RiskLevel: low, medium, high, critical.

---

# Տվյալների մոդել

BroPS-ի հիմնական օբյեկտներն են օգտատերը, workspace-ը, նախագիծը, առաջադրանքը, գործակալը, զրույցը, հրամանը, run-ը, քայլը, tool call-ը, approval-ը, որոշումը, հիշողությունը, գիտելիքը, ֆայլը, notification-ը, automation-ը և audit event-ը։ Բոլոր կարևոր փոփոխությունները ապացուցելի են, append-only պատմություն ունեն և չեն վերագրվում լուռ կերպով։

*(Կոդի դեմ կարդացված 2026-10-14։)* Վերևի պարբերությունը սահմանված մոդելն ա։ Տասնինը entity-ից տասնհինգը app-ի բազայում աղյուսակ ունի (`workspaces`, `projects`, `tasks` ու `task_dependencies`, `agents`, `conversations`, `messages`, `runs`, `run_steps`, `approvals`, `decisions`, `memory_entries`, `knowledge_notes`, `notifications`, `automations`, `audit_events`)։ Չորսը չունի՝ **օգտատերը (User), հրամանը (Command), tool call-ը ու ֆայլը (FileRecord)**. `src-tauri/core/schema/`-ի ոչ մի migration `users`, `commands`, `tool_calls` կամ `file_records` աղյուսակ չի ստեղծում, ու `src-tauri/core/src/domain.rs`-ում դրանցից ոչ մեկի struct-ը չկա։ `runs`-ը command-ի սյուն չունի, tool call ոչինչ չի պահում։

**Ջնջումը hard delete ա**, ոչ soft delete՝ ոչ մի migration `deleted_at` սյուն կամ tombstone չունի, ու `repo.rs`-ը տողը հանում ա `DELETE FROM`-ով յոթ տեղում (`conversations`, `knowledge_notes`, `memory_entries`, `library_items`, `research_items`, `events`, `automations`)։ Հաղորդագրությունը իր զրույցի դեմ append-only չի՝ `messages.conversation_id`-ն `ON DELETE CASCADE` ա (migration `0003`), զրույցը ջնջելը ջնջում ա նաև իր հաղորդագրությունները։ Որոշումը միայն ստեղծվում ու թվարկվում ա, ուղղում կամ superseding գրառում չկա։ `audit_events`-ի մեջ միայն insert ա արվում։