# Notifications and Permissions

## Notifications
Channels: in-app inbox, desktop notification, badge and optional email integration.
Types: approval required, run completed, run failed, task due, mention, assignment, automation result, security warning and backup status.
Each notification stores severity, source entity, created/read timestamps, action target and deduplication key. Users can configure per-type channel, quiet hours and digest behavior.

*(Read against the code 2026-10-14.)* The three lines above are the specification. What exists is the in-app list and nothing else:

- **Stored.** The `notifications` table (migration `0001`, altered by no later one) has nine columns: `id`, `type`, `severity`, `title`, `body`, `entity_type`, `entity_id`, `read_at`, `created_at`. There is no action-target column and no deduplication key, and nothing stores a per-type channel, quiet hours or a digest setting.
- **Channels.** Two commands serve it, `list_notifications` and `mark_notification_read` (`src-tauri/src/commands.rs`). No desktop-notification or mail dependency is in `src-tauri/Cargo.toml`, `src-tauri/core/Cargo.toml` or `package.json`, so no desktop notification and no email is sent.
- **Types.** Outside the first-run seed and the tests, `src-tauri/core/src/repo.rs` writes two: `approval_required`, when an approval is escalated, and `automation`, when an automation's notify action runs. The seed also writes `run_completed`. Run failed, task due, mention, assignment, security warning and backup status are written by nothing.

## Permission model
Roles: Owner, Admin, Member, Viewer, Agent and Service.
Scopes: workspace, project, conversation, file, task, automation, provider, secret and system setting.
Actions: view, create, edit, delete, execute, approve, export, manage members and manage secrets.
Rules are deny-by-default and evaluated from explicit grants plus ownership. Sensitive actions require fresh authorization and audit events.

*(Read against the code 2026-10-14.)* The four lines above are the specification, and none of the role model is built. The application is single-user (`SECURITY.md`: "single-user local desktop app"), and [PROJECT_CONTEXT.md](../PROJECT_CONTEXT.md) files multi-user organization administration under "Outside MVP but architecture-ready". There is no `users`, role, member or grant table among the thirty-four the migrations create ([DATABASE_SCHEMA.md](DATABASE_SCHEMA.md)), and `src-tauri/core/src/domain.rs` has no role type: its only `role` fields are a message's author role (`MESSAGE_ROLES`: `user`, `agent`, `system`) and an agent's domain label (the seed gives `Research`, `Comms` and the like). What gates a call in the shipped application is the Tauri capability allowlist (`src-tauri/capabilities/default.json`), the command policy (`src-tauri/command-policy.json`) and the `approvals` table.

## Mandatory approval gates
- File deletion or overwrite
- External message/send/publish
- Secret access or provider-key changes
- Destructive database actions
- Automation enabling with external side effects
- High-cost or high-risk AI runs
- Permission changes

All grants, denials, approvals and notification deliveries MUST be auditable.
