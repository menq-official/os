//! Wave 3b-1B — broker-owned committed governed-message store (implements the design-GREEN rev-30 §4.10(g)
//! P0 delivery invariant: the committed `message.body` is the exact accepted-output bytes, `message_id/
//! body/trust_state` equal the row the broker verification transaction committed, an in-transaction
//! re-read that disagrees FAILS CLOSED (`commit_readback_mismatch`), and only the broker writes a
//! committed row).
//!
//! This module is the BROKER-side persistence op only. The renderer never holds a handle to this DB.
//! A committed row carries one of TWO trust states — `trusted_verified` or `demonstration_custody`,
//! whichever the chain actually resolved (see [`create_schema`]) — and the table CHECK constraint
//! closes the set to those two. This header used to say the CHECK made `trusted_verified` the only
//! representable value; that stopped being true when custody started being resolved instead of
//! assumed. The state is set ONLY here, so no renderer/generic-chat write path can mint or mutate a
//! committed message, and a `demonstration_custody` row can never be read back as `trusted_verified`.

use rusqlite::{params, Connection};

use crate::governed_turn_ipc::{CommittedMessage, TurnReason, TRUSTED_VERIFIED};

/// The only trust states a committed row may carry — the closed set `TrustState::committed_label`
/// can produce. Kept beside the readback so a schema without the CHECK constraint (an older
/// database, a hand-made table) still cannot smuggle an unresolved state past verification.
const COMMITTABLE_TRUST_STATES: [&str; 2] = [TRUSTED_VERIFIED, "demonstration_custody"];

/// Lowercase-hex SHA-256 of `bytes`. This IS [`crate::receipt::sha256_hex`], re-exported under the
/// path the broker, launcher, executor and proof crates already import — it used to be a second
/// implementation whose doc promised it "matches the receipt/envelope hashing convention", which
/// nothing checked. One function cannot disagree with itself.
pub use crate::receipt::sha256_hex;

/// Create the broker committed-message table.
///
/// `trust_state` used to be pinned by `CHECK (trust_state = 'trusted_verified')`, so the column
/// could hold exactly one value and every committed row asserted full trust by construction.
/// Nothing computed it: an independent audit found that no production path ever called
/// `production_trust::resolve_trust_state`, so the custody question that module exists to answer
/// was never asked — and the answer was stored regardless.
///
/// The column now records what was actually RESOLVED. `demonstration_custody` is the honest value
/// for a run whose chain completed under a kit or demonstration root: real cryptography, real
/// binding, and custody that proves nothing about who controls the anchor. Storing that as
/// `trusted_verified` was the lie; refusing to store it at all would delete the evidence that the
/// chain ran. The renderer keys its badge off this string, so a demonstration turn renders as what
/// it is. The CHECK stays closed — an unresolved or invented state cannot be written.
///
/// AN EXISTING DATABASE (audit L-35). `CREATE TABLE IF NOT EXISTS` leaves an older table exactly
/// as it is, so a database made by the release before this constraint was widened kept the
/// one-state CHECK: a fresh install committed a demonstration-custody turn and an upgraded one
/// refused it, at the moment a verified turn was being committed. The table that is THERE is now
/// read back and told apart:
///
/// * the current shape — nothing to do;
/// * the former shape — rebuilt in one transaction ([`migrate_former_table`]), rows kept;
/// * anything else — refused here, at startup, with the shape named. This module will not guess
///   what a table it does not recognise is constrained to.
pub fn create_schema(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(&format!("CREATE TABLE IF NOT EXISTS governed_messages {COLUMNS_AND_CHECK};"))?;
    let existing: String = conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'governed_messages'",
        [],
        |r| r.get(0),
    )?;
    if existing.contains(CURRENT_TRUST_CHECK) {
        Ok(())
    } else if existing.contains(FORMER_TRUST_CHECK) {
        migrate_former_table(conn)
    } else {
        Err(schema_refusal(format!(
            "governed_messages exists with a shape this broker does not recognise, and is not \
             migrated or used: {existing}"
        )))
    }
}

/// The table's columns and its one constraint — the text both the fresh table and the migration
/// are built from, so they cannot come to differ.
const COLUMNS_AND_CHECK: &str = "(
            message_id     TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            broker_turn_id TEXT NOT NULL,
            author         TEXT NOT NULL,
            body           TEXT NOT NULL,
            body_sha256    TEXT NOT NULL,
            created_at_ms  INTEGER NOT NULL,
            trust_state    TEXT NOT NULL
                CHECK (trust_state IN ('trusted_verified', 'demonstration_custody'))
        )";

/// How the two shapes this module knows are recognised in `sqlite_master`, which keeps a table's
/// text as it was written: each constraint is one line of the statement that made it.
const CURRENT_TRUST_CHECK: &str = "CHECK (trust_state IN ('trusted_verified', 'demonstration_custody'))";
const FORMER_TRUST_CHECK: &str = "CHECK (trust_state = 'trusted_verified')";

/// Rebuild a former-shape table under the current constraint, in ONE transaction: the new table,
/// every row copied, the count compared, the old table dropped, the new one given its name. A
/// failure at any step leaves the database as it was — the former table, intact — and is the
/// startup error. Every former row is `trusted_verified`, which the wider constraint admits.
fn migrate_former_table(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(&format!(
        "DROP TABLE IF EXISTS governed_messages_migrating;
         CREATE TABLE governed_messages_migrating {COLUMNS_AND_CHECK};
         INSERT INTO governed_messages_migrating
             (message_id, conversation_id, broker_turn_id, author, body, body_sha256, created_at_ms, trust_state)
         SELECT message_id, conversation_id, broker_turn_id, author, body, body_sha256, created_at_ms, trust_state
           FROM governed_messages;"
    ))?;
    let count = |table: &str| -> rusqlite::Result<i64> {
        tx.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
    };
    let (before, after) = (count("governed_messages")?, count("governed_messages_migrating")?);
    if before != after {
        return Err(schema_refusal(format!(
            "governed_messages migration copied {after} of {before} rows; nothing was changed"
        )));
    }
    tx.execute_batch(
        "DROP TABLE governed_messages;
         ALTER TABLE governed_messages_migrating RENAME TO governed_messages;",
    )?;
    tx.commit()
}

/// A refusal of this module's own, in the error type the schema functions return.
fn schema_refusal(message: String) -> rusqlite::Error {
    rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_SCHEMA), Some(message))
}

/// What the broker holds after verification succeeds: the accepted output whose byte-length AND SHA-256
/// already matched the signed envelope (§4.7/§6.1). `accepted_body` is the exact strict-UTF8 bytes.
pub struct AcceptedOutput {
    pub broker_turn_id: String,
    pub message_id: String,
    pub conversation_id: String,
    pub author: String,
    pub accepted_body: String,
    /// The SHA-256 the signed envelope committed to (lowercase hex).
    pub envelope_body_sha256: String,
    pub created_at_ms: i64,
}

/// Verify a committed-row re-read against the accepted output (rev-30 P0 commit-readback invariant). Any
/// disagreement in body, hash, or trust state ⇒ `CommitReadbackMismatch`. Pure — unit-testable in isolation.
pub fn verify_readback(
    readback_body: &str,
    readback_sha256: &str,
    readback_trust_state: &str,
    accepted_body: &str,
    envelope_body_sha256: &str,
    expected_trust_state: &str,
) -> Result<(), TurnReason> {
    let ok = readback_body == accepted_body
        && readback_sha256 == envelope_body_sha256
        && sha256_hex(readback_body.as_bytes()) == envelope_body_sha256
        // Both halves matter. The equality catches a row that stored something other than what the
        // chain resolved; the membership catches a schema (an older DB without the CHECK) where the
        // caller and the row could agree on a value neither is allowed to use.
        && readback_trust_state == expected_trust_state
        && COMMITTABLE_TRUST_STATES.contains(&readback_trust_state);
    if ok {
        Ok(())
    } else {
        Err(TurnReason::CommitReadbackMismatch)
    }
}

/// Persist the verified accepted output as the committed message — `trusted_verified` or
/// `demonstration_custody`, per `trust_state` below — then **re-read the row
/// in the same connection** and fail closed on ANY mismatch (rev-30 P0). Returns the exact broker-produced
/// immutable projection to hand to the renderer, or a `TurnReason` (never a partial/committed frame on
/// failure). The pre-persist gate also rejects an accepted body whose recomputed SHA-256 does not equal the
/// envelope's (defense in depth — the caller should already have verified this).
///
/// `trust_state` is the state the chain actually RESOLVED for this turn, and it is a parameter
/// rather than a constant because that resolution used to not happen at all: every row was written
/// `'trusted_verified'` literally, so the value carried no information and could not be wrong. It
/// now has to be produced by someone who consulted the manifest and its root anchor, and a state
/// that does not warrant storing at all is refused here rather than downgraded silently.
pub fn persist_committed(
    conn: &Connection,
    accepted: &AcceptedOutput,
    trust_state: &crate::production_trust::TrustState,
) -> Result<CommittedMessage, TurnReason> {
    persist_committed_with(conn, accepted, trust_state, |_| Ok(()))
}

/// [`persist_committed`], with one more write inside the SAME transaction.
///
/// `before_commit` runs after the row has been inserted, re-read and verified, and before the
/// transaction commits. If it refuses, the transaction rolls back and the message is never
/// durable. Audit L-33: the broker wrote the message in one transaction and its turn's state in
/// a second write whose failure it ignored, so a message could be published — and the renderer
/// told `committed` — for a turn whose own row said `live` or `blocked`.
pub fn persist_committed_with(
    conn: &Connection,
    accepted: &AcceptedOutput,
    trust_state: &crate::production_trust::TrustState,
    before_commit: impl FnOnce(&Connection) -> Result<(), TurnReason>,
) -> Result<CommittedMessage, TurnReason> {
    // Pre-persist: the body bytes must hash to exactly the envelope-committed digest.
    if sha256_hex(accepted.accepted_body.as_bytes()) != accepted.envelope_body_sha256 {
        return Err(TurnReason::CommitReadbackMismatch);
    }
    // A turn whose chain did not bind has nothing to commit. `NoTrustedManifest` reaching here is a
    // caller that verified nothing and asked to store it anyway — refuse, do not record a weaker
    // claim, because a row in this table IS the claim that a governed turn produced this body.
    let stored_state = trust_state.committed_label().ok_or(TurnReason::UpstreamBlocked)?;
    // Open ONE explicit transaction so the INSERT, the re-read, and every verification form a single
    // atomic snapshot. `unchecked_transaction` takes `&Connection` and yields a `Transaction` that ROLLS
    // BACK on drop unless `commit()` is called — so any fail-closed return below leaves NO committed row
    // (rev-30 §4.10(g) P0: the trusted_verified row must not durably survive a readback mismatch).
    let tx = conn
        .unchecked_transaction()
        .map_err(|_| TurnReason::CommitReadbackMismatch)?;

    tx.execute(
        "INSERT INTO governed_messages
            (message_id, conversation_id, broker_turn_id, author, body, body_sha256, created_at_ms, trust_state)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            accepted.message_id,
            accepted.conversation_id,
            accepted.broker_turn_id,
            accepted.author,
            accepted.accepted_body,
            accepted.envelope_body_sha256,
            accepted.created_at_ms,
            stored_state,
        ],
    )
    .map_err(|_| TurnReason::CommitReadbackMismatch)?;

    // In-tx re-read: the just-inserted row must equal the accepted output, else fail closed. Because this
    // read runs inside `tx`, a mismatch return drops `tx` (rollback) and the row never becomes durable.
    let (rb_body, rb_sha, rb_trust, rb_created): (String, String, String, i64) = tx
        .query_row(
            "SELECT body, body_sha256, trust_state, created_at_ms FROM governed_messages WHERE message_id = ?1",
            params![accepted.message_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .map_err(|_| TurnReason::CommitReadbackMismatch)?;

    verify_readback(
        &rb_body,
        &rb_sha,
        &rb_trust,
        &accepted.accepted_body,
        &accepted.envelope_body_sha256,
        stored_state,
    )?;
    if rb_created != accepted.created_at_ms {
        return Err(TurnReason::CommitReadbackMismatch);
    }

    // Whatever must become true together with this message, in this transaction.
    before_commit(&tx)?;

    // Only now — after the readback AND the created_at_ms equality both pass — make the row durable.
    tx.commit().map_err(|_| TurnReason::CommitReadbackMismatch)?;

    Ok(CommittedMessage::new(
        accepted.message_id.clone(),
        accepted.author.clone(),
        rb_body, // the exact committed-row body, not the caller's copy
        rb_created,
        rb_trust, // likewise the row's own re-read trust state, not the value we asked it to store
    ))
}

/// What an independent post-commit re-read establishes about a [`CommittedMessage`] projection: it is
/// backed by a durable committed row, and the body it carries hashes to the digest the signed envelope
/// committed to (the row's `body_sha256`, which [`persist_committed`] proved equal to
/// `envelope.output_sha256` before making the row durable).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommittedBinding {
    pub message_id: String,
    /// The envelope-committed body digest as stored in the durable row (lowercase hex).
    pub envelope_body_sha256: String,
}

/// Check that a [`CommittedMessage`] projection is actually backed by the durable committed row it
/// claims, re-reading the row and recomputing the digest here.
///
/// WHY this exists, plainly. A driver that wanted to report whether a turn was "bound" used to read
/// `message.trust_state == TRUSTED_VERIFIED`. That value WAS a hardcoded constant in
/// `CommittedMessage::new` — `trusted_verified` for every projection ever constructed, so the
/// comparison could not fail and the reported boolean was decoration. (It is a parameter now: the
/// label the committing transaction stored.) The falsifiable question a caller holding a projection
/// can ask is a DELIVERY question: is this projection backed by a durable committed row, does the
/// body it is about to display hash to that row's envelope-committed digest, and is the trust state
/// it is about to render THE ROW'S? Everything below can be false — a rolled-back transaction, a
/// projection for a message that was never committed, a row or a projection altered after the
/// commit, a stored digest that no longer matches its body, a projection that says `trusted_verified`
/// over a row that says `demonstration_custody`.
///
/// LIMIT: this re-verifies delivery, not cryptography. The envelope signature and the
/// output-length/digest gates are `governed_verification::verify_and_accept`'s job and are NOT redone
/// here; this only ensures nothing between that acceptance and the caller substituted the bytes.
pub fn verify_committed_binding(
    conn: &Connection,
    message: &CommittedMessage,
) -> Result<CommittedBinding, TurnReason> {
    let row: Option<(String, String, String, String, i64)> = conn
        .query_row(
            "SELECT body, body_sha256, trust_state, author, created_at_ms
               FROM governed_messages WHERE message_id = ?1",
            params![message.message_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .ok();
    // No durable row ⇒ the projection is not backed by a commit (rolled back, or never persisted).
    let (body, body_sha256, trust_state, author, created_at_ms) =
        row.ok_or(TurnReason::CommitReadbackMismatch)?;

    if body != message.body {
        return Err(TurnReason::CommitReadbackMismatch);
    }
    // The binding itself: the bytes the caller will report must hash to the digest the envelope
    // committed to. Recomputed here rather than trusted from either side.
    if sha256_hex(message.body.as_bytes()) != body_sha256 {
        return Err(TurnReason::CommitReadbackMismatch);
    }
    // Defence in depth behind the table CHECK constraint: a row reached through a schema that lacks
    // it (an older DB, a hand-made table) must not pass. The set is closed — an unresolved or
    // invented state is refused here even if some other schema let it be written.
    if !COMMITTABLE_TRUST_STATES.contains(&trust_state.as_str()) {
        return Err(TurnReason::CommitReadbackMismatch);
    }
    // The label the caller will render must be the label the row holds. The membership check above
    // was the ONLY thing this function did with the row's trust state, and it never read the
    // projection's — so a projection raised to `trusted_verified` over a `demonstration_custody`
    // row passed, both values being committable. This is the field the badge is drawn from.
    if trust_state != message.trust_state {
        return Err(TurnReason::CommitReadbackMismatch);
    }
    if author != message.author || created_at_ms != message.created_at_ms {
        return Err(TurnReason::CommitReadbackMismatch);
    }

    Ok(CommittedBinding { message_id: message.message_id.clone(), envelope_body_sha256: body_sha256 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::production_trust::TrustState;

    fn production() -> TrustState {
        TrustState::Production {
            key_id: "signer-prod".into(),
            key_epoch: 3,
            root_key_id: "root-external".into(),
        }
    }

    fn demonstration() -> TrustState {
        TrustState::DemonstrationCustody {
            key_id: "signer-prod".into(),
            key_epoch: 3,
            root_key_id: "root-kit".into(),
            root_provenance: crate::key_manifest::RootProvenance::KitGenerated,
        }
    }

    fn accepted(body: &str) -> AcceptedOutput {
        AcceptedOutput {
            broker_turn_id: "bt-1".into(),
            message_id: "m-1".into(),
            conversation_id: "conv-1".into(),
            author: "Bro".into(),
            accepted_body: body.into(),
            envelope_body_sha256: sha256_hex(body.as_bytes()),
            created_at_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn persist_then_readback_yields_the_committed_projection() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        assert_eq!(msg.message_id, "m-1");
        assert_eq!(msg.body, "hello world");
        assert_eq!(msg.role, crate::governed_turn_ipc::ASSISTANT_ROLE);
        assert_eq!(msg.trust_state, TRUSTED_VERIFIED);
    }

    /// The custody gate itself. `trust_state` used to be the literal `'trusted_verified'` in the
    /// INSERT, so this could not be written as a test at all — there was no input to vary. Delete
    /// the `ok_or` in `persist_committed` and this goes red.
    #[test]
    fn a_turn_with_no_resolved_custody_cannot_be_committed() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let unresolved = TrustState::NoTrustedManifest("no anchor in this deployment");
        assert_eq!(
            persist_committed(&conn, &accepted("hello world"), &unresolved),
            Err(TurnReason::UpstreamBlocked)
        );
        // And nothing durable was left behind — a refusal is not a half-commit.
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM governed_messages", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 0, "a refused turn must leave no row");
    }

    /// A demonstration-custody run is a real chain run whose anchor proves nothing about who holds
    /// the root. It commits — the evidence that the chain ran is worth keeping — but it commits
    /// under its own label, and nothing downstream can mistake it for production.
    /// The table as the release before `09b4803` created it: one trust state, by constraint.
    const FORMER_DDL: &str = "CREATE TABLE IF NOT EXISTS governed_messages (
            message_id     TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            broker_turn_id TEXT NOT NULL,
            author         TEXT NOT NULL,
            body           TEXT NOT NULL,
            body_sha256    TEXT NOT NULL,
            created_at_ms  INTEGER NOT NULL,
            trust_state    TEXT NOT NULL CHECK (trust_state = 'trusted_verified')
        );";

    /// L-35, the reviewer's sequence: a database the former release made, opened by this one,
    /// commits a demonstration-custody turn — and keeps the row it already held.
    #[test]
    fn a_database_from_the_former_release_is_migrated_and_keeps_its_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(FORMER_DDL).unwrap();
        conn.execute(
            "INSERT INTO governed_messages VALUES ('m-old','conv-0','bt-0','Bro','before',?1,7,'trusted_verified')",
            [sha256_hex(b"before")],
        )
        .unwrap();

        create_schema(&conn).unwrap();

        let msg = persist_committed(&conn, &accepted("hello world"), &demonstration())
            .expect("a demonstration turn commits after the upgrade");
        assert_eq!(msg.trust_state, "demonstration_custody");
        let kept: (String, String, i64, String) = conn
            .query_row(
                "SELECT conversation_id, body, created_at_ms, trust_state FROM governed_messages WHERE message_id = 'm-old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .expect("the row from before the upgrade is still there");
        assert_eq!(kept, ("conv-0".into(), "before".into(), 7, "trusted_verified".into()));
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM governed_messages", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 2);
    }

    /// After the migration the table is the current one: a second start does nothing, and the
    /// constraint is still closed.
    #[test]
    fn a_migrated_database_is_the_current_shape_and_starting_again_changes_nothing() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(FORMER_DDL).unwrap();
        create_schema(&conn).unwrap();
        let shape = |c: &Connection| -> String {
            c.query_row("SELECT sql FROM sqlite_master WHERE name = 'governed_messages'", [], |r| r.get(0)).unwrap()
        };
        let migrated = shape(&conn);
        assert!(migrated.contains("demonstration_custody"), "{migrated}");
        create_schema(&conn).unwrap();
        assert_eq!(shape(&conn), migrated);
        let leftovers: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'governed_messages_migrating'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(leftovers, 0);
        // Still a closed set: a state nobody resolved cannot be written to the migrated table.
        let invented = conn.execute(
            "INSERT INTO governed_messages VALUES ('m-x','c','bt','Bro','b','h',1,'looks_fine')",
            [],
        );
        assert!(invented.is_err());
    }

    /// A table this module did not make is not migrated and not used: startup refuses, names
    /// the shape, and leaves the table and its rows alone.
    #[test]
    fn a_table_of_an_unrecognised_shape_refuses_startup_and_is_left_alone() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE governed_messages (message_id TEXT PRIMARY KEY, trust_state TEXT NOT NULL);
             INSERT INTO governed_messages VALUES ('m-1', 'whatever');",
        )
        .unwrap();
        let e = create_schema(&conn).unwrap_err().to_string();
        assert!(e.contains("does not recognise"), "{e}");
        assert!(e.contains("trust_state TEXT NOT NULL"), "the refusal does not show the shape: {e}");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM governed_messages", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
    }

    /// A migration that cannot finish leaves the former table as it was. Here the copy is made
    /// to fail by a row the wider constraint still refuses — a state that is neither value,
    /// which only a table edited by hand could hold.
    #[test]
    fn a_migration_that_fails_leaves_the_former_table_and_its_rows() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(FORMER_DDL).unwrap();
        conn.execute_batch(
            "PRAGMA ignore_check_constraints = ON;
             INSERT INTO governed_messages VALUES ('m-odd','c','bt','Bro','b','h',1,'looks_fine');
             PRAGMA ignore_check_constraints = OFF;",
        )
        .unwrap();
        assert!(create_schema(&conn).is_err());
        let shape: String = conn
            .query_row("SELECT sql FROM sqlite_master WHERE name = 'governed_messages'", [], |r| r.get(0))
            .unwrap();
        assert!(shape.contains("trust_state = 'trusted_verified'"), "the former table is gone: {shape}");
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM governed_messages", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 1);
        let leftovers: i64 = conn
            .query_row("SELECT COUNT(*) FROM sqlite_master WHERE name = 'governed_messages_migrating'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(leftovers, 0, "a half-made table survived the failed migration");
    }

    #[test]
    fn demonstration_custody_commits_under_its_own_label_not_trusted_verified() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &demonstration()).unwrap();
        assert_eq!(msg.trust_state, "demonstration_custody");
        assert_ne!(msg.trust_state, TRUSTED_VERIFIED, "demonstration custody is NOT production trust");
        // The projection is the row, not a hopeful copy of it.
        let stored: String = conn
            .query_row("SELECT trust_state FROM governed_messages WHERE message_id = 'm-1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stored, msg.trust_state);
    }

    /// The two states must not be interchangeable at the storage layer either: a row that says one
    /// thing while the chain resolved the other fails the readback. Delete the equality half of
    /// `verify_readback` and this goes red.
    #[test]
    fn readback_rejects_a_row_whose_trust_state_is_not_the_resolved_one() {
        let body = "reply";
        let good = sha256_hex(body.as_bytes());
        // Both values are individually legal; they simply are not the same answer.
        assert_eq!(
            verify_readback(body, &good, "demonstration_custody", body, &good, TRUSTED_VERIFIED),
            Err(TurnReason::CommitReadbackMismatch)
        );
        assert_eq!(
            verify_readback(body, &good, TRUSTED_VERIFIED, body, &good, "demonstration_custody"),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }

    /// Cockpit read R3-0112. The other half, which nothing reached: with the membership clause
    /// deleted every test in this module stayed green (measured 2026-10-13), because each case
    /// that used a label outside the set also made the two labels differ. Here the row and the
    /// caller AGREE — on a value neither may use — which is the case the clause is for.
    #[test]
    fn readback_rejects_a_label_outside_the_set_even_when_the_row_and_the_caller_agree() {
        let body = "reply";
        let good = sha256_hex(body.as_bytes());
        for label in ["unverified", "development_untrusted", "", "TRUSTED_VERIFIED"] {
            assert!(!COMMITTABLE_TRUST_STATES.contains(&label), "the fixture must be outside the set");
            assert_eq!(
                verify_readback(body, &good, label, body, &good, label),
                Err(TurnReason::CommitReadbackMismatch),
                "`{label}` was committed because both sides said it"
            );
        }
        // and every label inside the set, agreed on, passes — so the refusal above is the set's
        for label in COMMITTABLE_TRUST_STATES {
            assert_eq!(verify_readback(body, &good, label, body, &good, label), Ok(()));
        }
    }

    /// `committed_label` is the only door from a resolved state to a stored string, so the closed
    /// set it can produce is what the CHECK constraint and the readback are allowed to accept.
    #[test]
    fn every_committable_label_is_one_a_trust_state_can_actually_produce() {
        assert_eq!(production().committed_label(), Some(TRUSTED_VERIFIED));
        assert_eq!(demonstration().committed_label(), Some("demonstration_custody"));
        assert_eq!(TrustState::NoTrustedManifest("x").committed_label(), None);
        for label in COMMITTABLE_TRUST_STATES {
            assert!(
                [production().committed_label(), demonstration().committed_label()].contains(&Some(label)),
                "{label} is accepted by the readback but no TrustState can produce it"
            );
        }
    }

    #[test]
    fn pre_persist_rejects_body_not_matching_envelope_hash() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let mut a = accepted("hello");
        a.envelope_body_sha256 = sha256_hex(b"a DIFFERENT body"); // envelope says something else
        assert_eq!(
            persist_committed(&conn, &a, &production()),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }

    #[test]
    fn readback_verify_fails_closed_on_any_mismatch() {
        let body = "reply";
        let good = sha256_hex(body.as_bytes());
        // happy path
        assert!(verify_readback(body, &good, TRUSTED_VERIFIED, body, &good, TRUSTED_VERIFIED).is_ok());
        // tampered body
        assert_eq!(
            verify_readback("TAMPERED", &good, TRUSTED_VERIFIED, body, &good, TRUSTED_VERIFIED),
            Err(TurnReason::CommitReadbackMismatch)
        );
        // wrong stored hash
        assert_eq!(
            verify_readback(body, "deadbeef", TRUSTED_VERIFIED, body, &good, TRUSTED_VERIFIED),
            Err(TurnReason::CommitReadbackMismatch)
        );
        // downgraded trust state
        assert_eq!(
            verify_readback(body, &good, "unverified", body, &good, TRUSTED_VERIFIED),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }

    #[test]
    fn table_check_constraint_refuses_a_non_verified_trust_state() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        // a direct write attempting any other trust state must be refused by the DB itself
        let r = conn.execute(
            "INSERT INTO governed_messages
                (message_id, conversation_id, broker_turn_id, author, body, body_sha256, created_at_ms, trust_state)
             VALUES ('x','c','bt','a','b',?1,1,'forged_verified')",
            params![sha256_hex(b"b")],
        );
        assert!(r.is_err(), "CHECK constraint must reject a non-trusted_verified trust_state");
    }

    #[test]
    fn readback_mismatch_rolls_back_the_committed_row_atomically() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        // An AFTER INSERT trigger tampers with the just-inserted row's body so the in-tx readback will
        // disagree with the accepted output. If persist_committed's INSERT + readback + verify were NOT
        // wrapped in one transaction, the tampered row would durably survive the fail-closed return. With
        // the fix, the transaction drops on the Err and the row is rolled back.
        conn.execute_batch(
            "CREATE TRIGGER tamper_after_insert
             AFTER INSERT ON governed_messages
             BEGIN
                 UPDATE governed_messages
                    SET body = 'TAMPERED-BY-TRIGGER'
                  WHERE message_id = NEW.message_id;
             END;",
        )
        .unwrap();

        // Must fail closed on the readback mismatch...
        assert_eq!(
            persist_committed(&conn, &accepted("hello world"), &production()),
            Err(TurnReason::CommitReadbackMismatch)
        );

        // ...and no row may survive: the whole transaction (INSERT + trigger UPDATE) rolled back.
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM governed_messages WHERE message_id = ?1",
                params!["m-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0, "orphaned trusted_verified row must NOT survive the fail-closed path");
    }

    #[test]
    fn happy_path_commits_the_row_durably() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        // No tampering: readback matches, so the transaction must commit and the row must be durable.
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        assert_eq!(msg.body, "hello world");
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM governed_messages WHERE message_id = ?1 AND trust_state = 'trusted_verified'",
                params!["m-1"],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "a matching readback must leave exactly one committed trusted_verified row");
    }

    // ---- verify_committed_binding ------------------------------------------------------------------
    //
    // Each case below is constructed so that EXACTLY ONE of the checks in `verify_committed_binding`
    // rejects it. Delete that check and the corresponding test starts passing where it must not.

    #[test]
    fn committed_binding_returns_the_envelope_digest_for_a_real_committed_row() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        let b = verify_committed_binding(&conn, &msg).unwrap();
        assert_eq!(b.message_id, "m-1");
        assert_eq!(b.envelope_body_sha256, sha256_hex(b"hello world"));
    }

    #[test]
    fn committed_binding_refuses_a_projection_with_no_durable_row() {
        // The row-exists check in isolation: a projection whose message_id was never committed (a
        // rolled-back turn, or a projection minted by something other than persist_committed). Every
        // other check is unreachable because there is nothing to compare against.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let ghost = CommittedMessage::new("never-committed".into(), "Bro".into(), "hi".into(), 1, TRUSTED_VERIFIED.into());
        assert_eq!(
            verify_committed_binding(&conn, &ghost),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }

    #[test]
    fn committed_binding_refuses_a_row_whose_body_drifted_from_the_projection() {
        // The body-equality check in isolation. Only `body` is rewritten, so the row's stored
        // body_sha256 still equals SHA-256 of the PROJECTION's body — the digest check passes and only
        // the body comparison can catch the drift.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        conn.execute("UPDATE governed_messages SET body = 'TAMPERED' WHERE message_id = 'm-1'", [])
            .unwrap();
        assert_eq!(verify_committed_binding(&conn, &msg), Err(TurnReason::CommitReadbackMismatch));
    }

    #[test]
    fn committed_binding_refuses_a_body_that_does_not_hash_to_the_stored_envelope_digest() {
        // The digest check in isolation: body and projection still agree, so the body-equality check
        // passes; only recomputing SHA-256 against the stored envelope digest catches it.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        conn.execute(
            "UPDATE governed_messages SET body_sha256 = ?1 WHERE message_id = 'm-1'",
            params![sha256_hex(b"a DIFFERENT body")],
        )
        .unwrap();
        assert_eq!(verify_committed_binding(&conn, &msg), Err(TurnReason::CommitReadbackMismatch));
    }

    #[test]
    fn committed_binding_refuses_a_row_that_is_not_trusted_verified() {
        // The trust-state MEMBERSHIP check in isolation. `create_schema`'s CHECK constraint makes
        // this unreachable through the normal table, so the test builds the same table WITHOUT the
        // constraint — the shape an older/hand-made DB could present. Body, digest, author and
        // timestamp all agree, and so does the LABEL: the projection says `unverified` too.
        //
        // It used to say `trusted_verified` over the `unverified` row (cockpit read R3-1226), so
        // the equality check below the membership check refused it as well, and this test could
        // not tell whether the membership check ran. The control at the end is the same table,
        // another row, the same agreement, on each label inside the set: those are bound.
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE governed_messages (
                message_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, broker_turn_id TEXT NOT NULL,
                author TEXT NOT NULL, body TEXT NOT NULL, body_sha256 TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL, trust_state TEXT NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO governed_messages VALUES ('m-1','c','bt','Bro','hello world',?1,7,'unverified')",
            params![sha256_hex(b"hello world")],
        )
        .unwrap();
        let agreed = "unverified";
        assert!(!COMMITTABLE_TRUST_STATES.contains(&agreed), "the fixture must be outside the set");
        let msg = CommittedMessage::new("m-1".into(), "Bro".into(), "hello world".into(), 7, agreed.into());
        assert_eq!(verify_committed_binding(&conn, &msg), Err(TurnReason::CommitReadbackMismatch));

        for (id, label) in [("m-2", COMMITTABLE_TRUST_STATES[0]), ("m-3", COMMITTABLE_TRUST_STATES[1])] {
            conn.execute(
                "INSERT INTO governed_messages VALUES (?1,'c','bt','Bro','hello world',?2,7,?3)",
                params![id, sha256_hex(b"hello world"), label],
            )
            .unwrap();
            let msg = CommittedMessage::new(id.into(), "Bro".into(), "hello world".into(), 7, label.into());
            assert!(
                verify_committed_binding(&conn, &msg).is_ok(),
                "`{label}`, agreed on, is refused: the refusal above is not the set's"
            );
        }
    }

    #[test]
    fn committed_binding_refuses_a_projection_whose_trust_state_is_not_the_rows() {
        // The trust-state EQUALITY in isolation. The row is a real `demonstration_custody` commit
        // and the projection is the one `persist_committed` returned for it, with one field
        // changed: the label, raised to `trusted_verified`. Both labels are committable, so the
        // membership check passes; body, digest, author and timestamp are untouched. Only the
        // comparison of the projection's label with the row's can refuse this.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &demonstration()).unwrap();
        assert_eq!(msg.trust_state, "demonstration_custody");
        // Positive control: the honest projection is bound.
        assert!(verify_committed_binding(&conn, &msg).is_ok());

        let raised = CommittedMessage::new(
            msg.message_id.clone(), msg.author.clone(), msg.body.clone(), msg.created_at_ms,
            TRUSTED_VERIFIED.into(),
        );
        assert_eq!(verify_committed_binding(&conn, &raised), Err(TurnReason::CommitReadbackMismatch));

        // And the other direction: a production row is not bound to a projection that lowers it.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        let lowered = CommittedMessage::new(
            msg.message_id.clone(), msg.author.clone(), msg.body.clone(), msg.created_at_ms,
            "demonstration_custody".into(),
        );
        assert_eq!(verify_committed_binding(&conn, &lowered), Err(TurnReason::CommitReadbackMismatch));
    }

    #[test]
    fn committed_binding_refuses_a_projection_whose_identity_fields_drifted() {
        // The author/created_at check in isolation: the body and its digest are untouched, so the two
        // content checks pass and only the identity comparison can reject the substitution.
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        let msg = persist_committed(&conn, &accepted("hello world"), &production()).unwrap();
        let restamped =
            CommittedMessage::new(msg.message_id.clone(), msg.author.clone(), msg.body.clone(), 1, TRUSTED_VERIFIED.into());
        assert_eq!(
            verify_committed_binding(&conn, &restamped),
            Err(TurnReason::CommitReadbackMismatch)
        );
        let reauthored =
            CommittedMessage::new(msg.message_id.clone(), "Someone Else".into(), msg.body.clone(), msg.created_at_ms, TRUSTED_VERIFIED.into());
        assert_eq!(
            verify_committed_binding(&conn, &reauthored),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }

    #[test]
    fn duplicate_message_id_is_refused() {
        let conn = Connection::open_in_memory().unwrap();
        create_schema(&conn).unwrap();
        persist_committed(&conn, &accepted("one"), &production()).unwrap();
        // same message_id again ⇒ PK violation ⇒ mapped to fail-closed
        assert_eq!(
            persist_committed(&conn, &accepted("one"), &production()),
            Err(TurnReason::CommitReadbackMismatch)
        );
    }
}
