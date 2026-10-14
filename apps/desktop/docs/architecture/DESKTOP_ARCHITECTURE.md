# BroPS Desktop Architecture

## Stack
Tauri 2 + Rust host, React + TypeScript + Vite frontend, SQLite local database.

## Boundaries
- UI layer: rendering, navigation, local interaction state.
- Application layer: commands, queries, validation, orchestration.
- Domain layer: entities, policies and state machines.
- Infrastructure layer: SQLite, filesystem, secrets, providers, notifications and OS integration.
- Tauri boundary: minimal typed commands and events; no arbitrary shell execution.

## Local storage
SQLite uses migrations, foreign keys, WAL mode and transactional writes. User files remain in managed workspace directories; metadata and content hashes are stored in SQLite. Every external file path is normalized and access checked.

*(Read against the code 2026-10-14.)* Nothing about a file is stored in SQLite. None of the thirty-four tables the migrations create is a file table ([DATABASE_SCHEMA.md](DATABASE_SCHEMA.md); `file_records` was never created), and `src-tauri/src/files.rs` computes no hash: its three commands read and write the filesystem directly. "Metadata and content hashes are stored in SQLite" is the specification.

## Secrets
The desktop process holds **no secret values at all**. An integration or agent credential is stored as a *reference* (`auth_ref`: `engine:…`, `operator:…`, `keychain:…`, `env:…`, `vault:…`) that the engine or the operator resolves on the other side of the trust boundary — `src-tauri/core/src/credentials.rs`. Provider API keys for the ungoverned development providers are read from the process environment and never written to SQLite. Secrets are never stored in plaintext configuration, logs, analytics or exports.

*(This section said provider keys "MUST use the OS credential vault/keychain". No keyring integration exists in the tree, and migration 0022 settled the question the other way: a credential that reached this process would be a credential leaked.)*

## Files
File operations support import, copy, move, rename, preview, version metadata and trash-before-delete. Destructive actions require approval and audit records.

**Not implemented** (read against the code 2026-10-14): of the seven operations named, one exists. `src-tauri/src/files.rs` exposes three commands — `list_dir`, `read_file` and `write_file`; the Files page builds its preview on `read_file` (`PreviewPlane` in `src/features/Files.tsx`). There is no import, copy, move, rename, version metadata or trash.

## Backup and restore
Backups include database, managed files, settings and manifest checksums. Secrets are excluded unless explicitly exported through an encrypted flow. Restore validates schema version, checksums and available disk space before atomic replacement.

**Not implemented** (read against the code 2026-10-14): there is no backup and no restore. No command or module under `src-tauri/` takes or restores one; a case-insensitive search for `backup` over its `.rs`, `.sql`, `.toml` and `.json` files finds only the `.tfstate` deny pattern in `files.rs` and the Windows flag `FILE_FLAG_BACKUP_SEMANTICS`.

## Security
CSP enabled, Tauri capabilities allowlisted, updater signatures required, URLs validated, plugin boundaries explicit and audit logging append-only.

*(Read against the code 2026-10-14.)* There is no updater, so "updater signatures required" describes nothing that runs: `updater` appears in none of `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/` or `src-tauri/src/`. No update is fetched, signed or unsigned. The CSP is set (`app.security.csp` in `tauri.conf.json`).
