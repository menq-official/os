//! Wave 3b-1B — renderer↔broker governed-turn IPC contract layer (implements the design-GREEN rev-30
//! §4.10(g) renderer↔broker contract: P0 broker-committed output delivery + P1-1 request correlation &
//! payload-aware idempotency).
//!
//! This module is the **pure, side-effect-free contract + validation layer** the trusted broker service
//! uses to (a) strict-decode the renderer's request frame, (b) decide payload-aware idempotency, and
//! (c) build the closed committed/blocked reply frame. It owns NO key, DB, socket, or verdict — those
//! live in the broker service: the socket in the `brops-broker` binary (`broker/src/main.rs`), the
//! control flow in `broker_orchestrator`, the live-turn rows in `broker_turns`, the committed row in
//! `governed_message_store`. Keeping the contract pure makes every rev-30 rule here unit-testable
//! without the OS trust chain.
//!
//! rev-30 rules encoded here:
//! - Request `brops.renderer-governed-turn.v1 { conversation_id, agent?, client_request_id }`; ANY other
//!   field (system/history/generation_config/hash/nonce/run_id/task_id/broker_turn_id/request_nonce/…) ⇒
//!   `malformed` (serde `deny_unknown_fields`). `client_request_id` is a NON-authoritative UUIDv4
//!   correlation token; it grants no signing/verification authority and never enters `request_sha256`.
//! - Reply `brops.renderer-governed-turn-result.v1`: on commit carries the broker-produced immutable
//!   projection `message { message_id, role:"assistant", author, body, created_at_ms, trust_state }`,
//!   where `trust_state` is the label the committing transaction stored — `"trusted_verified"`, or
//!   `"demonstration_custody"` for a chain that ran under a root whose custody proves nothing; on
//!   blocked carries NO `message` and a CLOSED `reason` enum.
//! - Idempotency key = normalized `{client_request_id, conversation_id, agent}`; live-duplicate ⇒
//!   reattach; same `client_request_id` + different conversation/agent ⇒ `retry_conflict`; a different
//!   request while the conversation has a live turn ⇒ `turn_in_progress`.

use serde::{Deserialize, Serialize};

/// Wire protocol discriminators (rev-30 §4.10(g)).
pub const REQUEST_PROTOCOL: &str = "brops.renderer-governed-turn.v1";
pub const RESULT_PROTOCOL: &str = "brops.renderer-governed-turn-result.v1";

/// Field caps (bytes). `conversation_id`/`agent` mirror the renderer-owned inputs; the request frame as a
/// whole is additionally bounded by `RENDERER_IPC_FRAME_BYTES` at the transport layer (broker service).
///
/// `MAX_ID_BYTES` caps the RENDERER's ids. It has the same value as `governed_prepare::MAX_ID_LEN`,
/// which caps the ids of the signed chain, and is deliberately not an alias of it: they bound
/// different inputs at different doors, and tying them would move one when the other is retuned.
///
/// It is a count of UTF-8 BYTES (`String::len()`), and the published schema is not:
/// `bridge/contracts/renderer-governed-turn.schema.json` gives `conversation_id` and `agent`
/// `"maxLength": 128` with no pattern, and JSON Schema counts `maxLength` in characters. For an ASCII
/// id the two agree. For any other they do not — 100 two-byte characters are 200 bytes, valid under
/// the schema and `malformed` here — so this decode is the narrower of the two and the schema alone
/// does not say what this door admits.
pub const MAX_ID_BYTES: usize = 128;
/// The frame bound, and it IS the transport's: [`crate::ipc_framing::MAX_FRAME_PAYLOAD_BYTES`]. It was
/// a second literal `8192` with nothing equating the two, so the size check in
/// [`ValidatedRequest::decode`] and the one the framing applies could have drifted apart unnoticed.
pub const RENDERER_IPC_FRAME_BYTES: usize = crate::ipc_framing::MAX_FRAME_PAYLOAD_BYTES;

/// The trust state a PRODUCTION-custody committed turn renders as. It is not the only state a
/// committed message can carry: `governed_message_store` also commits `demonstration_custody`, and
/// [`CommittedMessage::trust_state`] is whichever the row holds. This comment used to say "there is
/// exactly one value". What still holds is that the renderer can construct neither, and only the
/// broker verification transaction sets one (rev-30 P0).
pub const TRUSTED_VERIFIED: &str = "trusted_verified";
/// A committed assistant message always has this role.
pub const ASSISTANT_ROLE: &str = "assistant";

/// The CLOSED renderer-facing refusal reason enum (rev-30 P0 — a `blocked` reply carries exactly one of
/// these and no `message`). Any other value is a protocol violation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnReason {
    /// Request frame failed strict decode/validation (unknown field, bad UUID, oversize, wrong protocol).
    Malformed,
    /// The connecting peer was not the pinned renderer/login identity.
    PeerDenied,
    /// Same `client_request_id` reused across a different conversation or agent.
    RetryConflict,
    /// A different request arrived while this conversation already has a live governed turn.
    TurnInProgress,
    /// After the verification tx committed, the broker re-read the row and it did not match the accepted
    /// output — fail closed, no committed frame (rev-30 P0 delivery invariant).
    CommitReadbackMismatch,
    /// An upstream stage (challenge/authority/supervisor/signer/verification) refused the turn.
    UpstreamBlocked,
}

/// The renderer's request frame, strict-decoded. `deny_unknown_fields` makes ANY field beyond these three
/// (+ `protocol`) a decode error ⇒ `malformed`, so the renderer can never smuggle
/// system/history/config/hashes/nonces or the broker's own `broker_turn_id`/`request_nonce`.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RendererGovernedTurnRequest {
    pub protocol: String,
    pub conversation_id: String,
    #[serde(default)]
    pub agent: Option<String>,
    pub client_request_id: String,
}

/// A validated request: the raw frame checked against every rev-30 rule (valid protocol, ids within
/// caps, canonical lowercase UUIDv4 correlation token).
///
/// [`ValidatedRequest::decode`] is the only function that RETURNS one, and the only way production
/// code obtains one (`broker_orchestrator::run_governed_turn`). The type does not enforce that: all
/// three fields are `pub`, so a struct literal compiles in any crate and carries no check — the
/// broker crate's test modules build theirs that way. The invariants are therefore `decode`'s, held
/// by every caller going through it, not a property of holding the type.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedRequest {
    pub conversation_id: String,
    pub agent: Option<String>,
    pub client_request_id: String,
}

impl ValidatedRequest {
    /// Strict-decode + validate a raw JSON request frame. Returns `TurnReason::Malformed` on any
    /// violation (unknown field, wrong protocol, oversize id, non-UUIDv4 correlation token). Pure.
    pub fn decode(raw: &str) -> Result<ValidatedRequest, TurnReason> {
        if raw.len() > RENDERER_IPC_FRAME_BYTES {
            return Err(TurnReason::Malformed);
        }
        let req: RendererGovernedTurnRequest =
            serde_json::from_str(raw).map_err(|_| TurnReason::Malformed)?;
        Self::from_decoded(req)
    }

    /// Validate an already-deserialized frame. `decode` is its only caller.
    fn from_decoded(req: RendererGovernedTurnRequest) -> Result<ValidatedRequest, TurnReason> {
        if req.protocol != REQUEST_PROTOCOL {
            return Err(TurnReason::Malformed);
        }
        if req.conversation_id.is_empty() || req.conversation_id.len() > MAX_ID_BYTES {
            return Err(TurnReason::Malformed);
        }
        if let Some(a) = &req.agent {
            if a.is_empty() || a.len() > MAX_ID_BYTES {
                return Err(TurnReason::Malformed);
            }
        }
        if !is_canonical_uuidv4(&req.client_request_id) {
            return Err(TurnReason::Malformed);
        }
        Ok(ValidatedRequest {
            conversation_id: req.conversation_id,
            agent: req.agent,
            client_request_id: req.client_request_id,
        })
    }

    /// The normalized idempotency key for this request (rev-30 P1-1).
    pub fn idempotency_key(&self) -> IdempotencyKey {
        IdempotencyKey {
            client_request_id: self.client_request_id.clone(),
            conversation_id: self.conversation_id.clone(),
            agent: self.agent.clone(),
        }
    }
}

/// `true` iff `s` is a canonical **lowercase** RFC-4122 version-4 UUID
/// (`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`). No regex dependency.
pub fn is_canonical_uuidv4(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (i, &c) in b.iter().enumerate() {
        let ok = match i {
            8 | 13 | 18 | 23 => c == b'-',
            14 => c == b'4',                                   // version nibble
            19 => matches!(c, b'8' | b'9' | b'a' | b'b'),      // variant nibble (lowercase)
            _ => matches!(c, b'0'..=b'9' | b'a'..=b'f'),       // lowercase hex only
        };
        if !ok {
            return false;
        }
    }
    true
}

/// The payload-aware idempotency key (rev-30 P1-1): the exact normalized tuple. Equality of the whole
/// tuple is a live-duplicate; equal `client_request_id` with a differing conversation/agent is a
/// `retry_conflict`.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IdempotencyKey {
    pub client_request_id: String,
    pub conversation_id: String,
    pub agent: Option<String>,
}

/// A currently-live governed turn the broker is tracking (its key + the authoritative broker-minted id).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveTurn {
    pub key: IdempotencyKey,
    pub broker_turn_id: String,
}

/// The idempotency decision for an incoming request against the set of live turns (rev-30 P1-1).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IdempotencyDecision {
    /// Identical live duplicate — re-attach to the same broker turn (never start a second).
    Reattach(String),
    /// Same `client_request_id` reused on a different conversation/agent.
    RetryConflict,
    /// A different request while this conversation already has a live turn.
    TurnInProgress,
    /// No conflict — mint a fresh `broker_turn_id` and start the turn.
    New,
}

/// Decide idempotency for `req` against the currently-live turns. Order (rev-30 P1-1): exact-key live
/// duplicate ⇒ Reattach; same `client_request_id` on a different conversation/agent ⇒ RetryConflict;
/// same conversation with a different request ⇒ TurnInProgress; otherwise New. Pure.
pub fn decide_idempotency(req: &ValidatedRequest, live: &[LiveTurn]) -> IdempotencyDecision {
    let key = req.idempotency_key();
    if let Some(t) = live.iter().find(|t| t.key == key) {
        return IdempotencyDecision::Reattach(t.broker_turn_id.clone());
    }
    if live
        .iter()
        .any(|t| t.key.client_request_id == key.client_request_id)
    {
        // same correlation token but (since the exact key didn't match) a different conversation/agent
        return IdempotencyDecision::RetryConflict;
    }
    if live.iter().any(|t| t.key.conversation_id == key.conversation_id) {
        return IdempotencyDecision::TurnInProgress;
    }
    IdempotencyDecision::New
}

/// The broker-produced UI projection of a verified+persisted assistant message (rev-30 P0).
/// In production it is built in one place, `governed_message_store`, from the row its verification
/// transaction committed; `body` is the exact strict-UTF8-decoded accepted-output bytes and equals
/// the committed row. That is a convention of the callers and not of this type: every field is `pub`,
/// [`CommittedMessage::new`] is `pub` and takes any `trust_state` string, and the struct derives
/// `Deserialize`, so any crate can build one. What keeps a renderer from minting one is that it is
/// the other end of the socket, not anything here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommittedMessage {
    pub message_id: String,
    /// Always [`ASSISTANT_ROLE`].
    pub role: String,
    pub author: String,
    pub body: String,
    pub created_at_ms: i64,
    /// The label the committing transaction stored: [`TRUSTED_VERIFIED`] or `demonstration_custody`.
    /// NOT a constant — see [`CommittedMessage::new`].
    pub trust_state: String,
}

impl CommittedMessage {
    /// Build the projection from the exact committed row.
    ///
    /// `trust_state` used to be the constant `TRUSTED_VERIFIED`, which made this field
    /// unfalsifiable: every projection ever constructed carried it, so anything downstream that
    /// compared against it — the live driver's `bound`, the renderer's badge — was comparing a
    /// value with itself and could not come out false. It is now the label the committing
    /// transaction actually stored, so a demonstration-custody row projects as what it is.
    ///
    /// `role` stays constant: a committed governed message is always the assistant's.
    pub fn new(
        message_id: String,
        author: String,
        body: String,
        created_at_ms: i64,
        trust_state: String,
    ) -> CommittedMessage {
        CommittedMessage {
            message_id,
            role: ASSISTANT_ROLE.to_string(),
            author,
            body,
            created_at_ms,
            trust_state,
        }
    }
}

/// The renderer↔broker reply frame (rev-30 P0). The two constructors below keep the rule —
/// [`committed`](RendererGovernedTurnResult::committed) carries a `message` and no `reason`,
/// [`blocked`](RendererGovernedTurnResult::blocked) a `reason` and no `message` — and every reply
/// echoes the correlation ids. The TYPE is not closed: `status` is a `String`, `message` and `reason`
/// are two independent `pub` options, and the struct derives `Deserialize`, so a value with both, with
/// neither, or with a third `status` can be written as a literal or decoded off a wire. A reader of
/// this frame has to check the pairing itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RendererGovernedTurnResult {
    pub protocol: String,
    pub status: String,
    pub client_request_id: String,
    pub broker_turn_id: String,
    pub conversation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<CommittedMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<TurnReason>,
}

impl RendererGovernedTurnResult {
    /// A committed reply carrying the broker-produced verified message projection.
    pub fn committed(
        client_request_id: String,
        broker_turn_id: String,
        conversation_id: String,
        message: CommittedMessage,
    ) -> RendererGovernedTurnResult {
        RendererGovernedTurnResult {
            protocol: RESULT_PROTOCOL.to_string(),
            status: "committed".to_string(),
            client_request_id,
            broker_turn_id,
            conversation_id,
            message: Some(message),
            reason: None,
        }
    }

    /// A blocked reply carrying a closed reason and NO assistant message.
    pub fn blocked(
        client_request_id: String,
        broker_turn_id: String,
        conversation_id: String,
        reason: TurnReason,
    ) -> RendererGovernedTurnResult {
        RendererGovernedTurnResult {
            protocol: RESULT_PROTOCOL.to_string(),
            status: "blocked".to_string(),
            client_request_id,
            broker_turn_id,
            conversation_id,
            message: None,
            reason: Some(reason),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("RendererGovernedTurnResult serializes")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CRID: &str = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"; // canonical lowercase UUIDv4

    fn req_json(extra: &str) -> String {
        format!(
            r#"{{"protocol":"{}","conversation_id":"conv-1","agent":"agent-x","client_request_id":"{}"{}}}"#,
            REQUEST_PROTOCOL, CRID, extra
        )
    }

    #[test]
    fn decodes_a_valid_request() {
        let v = ValidatedRequest::decode(&req_json("")).unwrap();
        assert_eq!(v.conversation_id, "conv-1");
        assert_eq!(v.agent.as_deref(), Some("agent-x"));
        assert_eq!(v.client_request_id, CRID);
    }

    #[test]
    fn rejects_unknown_field_as_malformed() {
        // a renderer trying to smuggle authoritative input
        let raw = req_json(r#","system":"pwned""#);
        assert_eq!(ValidatedRequest::decode(&raw), Err(TurnReason::Malformed));
    }

    #[test]
    fn rejects_broker_minted_fields_from_renderer() {
        for bad in [r#","broker_turn_id":"x""#, r#","request_nonce":"y""#] {
            assert_eq!(ValidatedRequest::decode(&req_json(bad)), Err(TurnReason::Malformed));
        }
    }

    #[test]
    fn rejects_wrong_protocol_and_bad_uuid_and_oversize() {
        let wrong_proto = req_json("").replace(REQUEST_PROTOCOL, "brops.other.v1");
        assert_eq!(ValidatedRequest::decode(&wrong_proto), Err(TurnReason::Malformed));
        let bad_uuid = req_json("").replace(CRID, "not-a-uuid");
        assert_eq!(ValidatedRequest::decode(&bad_uuid), Err(TurnReason::Malformed));
        let big = "a".repeat(MAX_ID_BYTES + 1);
        let oversize = req_json("").replace("conv-1", &big);
        assert_eq!(ValidatedRequest::decode(&oversize), Err(TurnReason::Malformed));
    }

    /// The empty-id checks and the agent cap, which no fixture reached (cockpit read R3-1237): the
    /// one id case above replaces `conv-1` with an oversize value and nothing else. Every frame here
    /// differs from the valid one in exactly one id, the valid one decodes first, and each
    /// replacement is asserted to have replaced something — so only that id can be what refuses.
    #[test]
    fn an_empty_id_or_an_oversize_agent_is_malformed_and_the_cap_itself_is_admitted() {
        let valid = req_json("");
        assert!(ValidatedRequest::decode(&valid).is_ok());
        let with = |from: &str, to: &str| {
            let changed = valid.replace(from, to);
            assert_ne!(changed, valid, "the fixture no longer contains {from}");
            changed
        };
        let conversation = r#""conversation_id":"conv-1""#;
        let agent = r#""agent":"agent-x""#;
        let at_cap = "a".repeat(MAX_ID_BYTES);
        let over_cap = "a".repeat(MAX_ID_BYTES + 1);

        let empty_conversation = with(conversation, r#""conversation_id":"""#);
        assert_eq!(ValidatedRequest::decode(&empty_conversation), Err(TurnReason::Malformed));
        let empty_agent = with(agent, r#""agent":"""#);
        assert_eq!(ValidatedRequest::decode(&empty_agent), Err(TurnReason::Malformed));
        let oversize_agent = with(agent, &format!(r#""agent":"{over_cap}""#));
        assert_eq!(ValidatedRequest::decode(&oversize_agent), Err(TurnReason::Malformed));

        // The cap is inclusive on both ids: exactly `MAX_ID_BYTES` decodes.
        let agent_at_cap = with(agent, &format!(r#""agent":"{at_cap}""#));
        assert_eq!(ValidatedRequest::decode(&agent_at_cap).unwrap().agent.as_deref(), Some(at_cap.as_str()));
        let conversation_at_cap = with(conversation, &format!(r#""conversation_id":"{at_cap}""#));
        assert_eq!(ValidatedRequest::decode(&conversation_at_cap).unwrap().conversation_id, at_cap);

        // `agent` is optional, and an absent one is not an empty one.
        let no_agent = with(&format!("{agent},"), "");
        assert_eq!(ValidatedRequest::decode(&no_agent).unwrap().agent, None);
    }

    /// `MAX_ID_BYTES` counts UTF-8 bytes, which the schema's `maxLength` does not (see the constant).
    /// 64 two-byte characters are exactly the cap and decode; 100 of them are 100 characters — inside
    /// the schema's 128 — and 200 bytes, and are refused here.
    #[test]
    fn the_id_cap_counts_utf8_bytes_not_characters() {
        let valid = req_json("");
        let conversation = r#""conversation_id":"conv-1""#;
        assert!(valid.contains(conversation));
        let two_byte = "Ա";
        assert_eq!(two_byte.len(), 2);

        let at_cap = two_byte.repeat(MAX_ID_BYTES / 2);
        assert_eq!((at_cap.chars().count(), at_cap.len()), (64, MAX_ID_BYTES));
        let admitted = valid.replace(conversation, &format!(r#""conversation_id":"{at_cap}""#));
        assert_eq!(ValidatedRequest::decode(&admitted).unwrap().conversation_id, at_cap);

        let inside_the_schema = two_byte.repeat(100);
        assert!(inside_the_schema.chars().count() <= 128 && inside_the_schema.len() > MAX_ID_BYTES);
        let refused = valid.replace(conversation, &format!(r#""conversation_id":"{inside_the_schema}""#));
        assert_eq!(ValidatedRequest::decode(&refused), Err(TurnReason::Malformed));
    }

    #[test]
    fn uuidv4_validation_is_strict() {
        assert!(is_canonical_uuidv4(CRID));
        assert!(!is_canonical_uuidv4(&CRID.to_uppercase())); // must be lowercase
        assert!(!is_canonical_uuidv4("3f2504e0-4f89-11d3-9a0c-0305e82c3301")); // version != 4
        assert!(!is_canonical_uuidv4("3f2504e0-4f89-41d3-7a0c-0305e82c3301")); // variant nibble bad
        assert!(!is_canonical_uuidv4("3f2504e04f8941d39a0c0305e82c3301")); // no dashes
    }

    fn key(crid: &str, conv: &str, agent: Option<&str>) -> IdempotencyKey {
        IdempotencyKey {
            client_request_id: crid.to_string(),
            conversation_id: conv.to_string(),
            agent: agent.map(|s| s.to_string()),
        }
    }

    #[test]
    fn idempotency_reattaches_exact_live_duplicate() {
        let req = ValidatedRequest::decode(&req_json("")).unwrap();
        let live = vec![LiveTurn { key: req.idempotency_key(), broker_turn_id: "bt-1".into() }];
        assert_eq!(decide_idempotency(&req, &live), IdempotencyDecision::Reattach("bt-1".into()));
    }

    #[test]
    fn idempotency_retry_conflict_on_same_crid_different_conversation() {
        let req = ValidatedRequest::decode(&req_json("")).unwrap();
        let live = vec![LiveTurn { key: key(CRID, "OTHER-conv", Some("agent-x")), broker_turn_id: "bt-9".into() }];
        assert_eq!(decide_idempotency(&req, &live), IdempotencyDecision::RetryConflict);
    }

    #[test]
    fn idempotency_retry_conflict_on_same_crid_different_agent() {
        let req = ValidatedRequest::decode(&req_json("")).unwrap();
        let live = vec![LiveTurn { key: key(CRID, "conv-1", Some("other-agent")), broker_turn_id: "bt-9".into() }];
        assert_eq!(decide_idempotency(&req, &live), IdempotencyDecision::RetryConflict);
    }

    #[test]
    fn idempotency_turn_in_progress_on_live_conversation_with_new_request() {
        let req = ValidatedRequest::decode(&req_json("")).unwrap();
        // different client_request_id, same conversation, already live
        let other = key("00000000-0000-4000-8000-000000000000", "conv-1", Some("agent-x"));
        let live = vec![LiveTurn { key: other, broker_turn_id: "bt-2".into() }];
        assert_eq!(decide_idempotency(&req, &live), IdempotencyDecision::TurnInProgress);
    }

    #[test]
    fn idempotency_new_when_no_live_turn() {
        let req = ValidatedRequest::decode(&req_json("")).unwrap();
        assert_eq!(decide_idempotency(&req, &[]), IdempotencyDecision::New);
    }

    /// The role is constant; the trust state is NOT, and the projection carries whichever it was
    /// given. This test used to be named `..._is_always_assistant_and_trusted_verified` and passed
    /// `TRUSTED_VERIFIED` in to assert it back out — true of any struct with a field.
    #[test]
    fn committed_message_is_always_assistant_and_carries_the_state_it_was_committed_under() {
        let m = CommittedMessage::new("m-1".into(), "Bro".into(), "hello".into(), 1234, TRUSTED_VERIFIED.into());
        assert_eq!(m.role, ASSISTANT_ROLE);
        assert_eq!(m.trust_state, TRUSTED_VERIFIED);

        // A demonstration-custody row projects as what it is, on the struct and on the wire.
        let d = CommittedMessage::new("m-2".into(), "Bro".into(), "hello".into(), 1234, "demonstration_custody".into());
        assert_eq!(d.role, ASSISTANT_ROLE);
        assert_ne!(d.trust_state, TRUSTED_VERIFIED, "demonstration custody must not be reported as trusted_verified");
        let json = RendererGovernedTurnResult::committed(CRID.into(), "bt-1".into(), "conv-1".into(), d).to_json();
        assert!(json.contains(r#""trust_state":"demonstration_custody""#), "{json}");
        assert!(!json.contains(TRUSTED_VERIFIED), "{json}");
    }

    /// The frame bound in `decode`, which no test reached: the only "oversize" case above is the
    /// ID cap. The request here is VALID — the same frame the happy path decodes — padded with
    /// trailing whitespace, which JSON permits, so nothing but the size check can refuse it.
    #[test]
    fn a_request_larger_than_one_frame_is_malformed_even_when_it_would_decode() {
        let valid = req_json("");
        assert!(ValidatedRequest::decode(&valid).is_ok());
        let at_the_bound = format!("{valid}{}", " ".repeat(RENDERER_IPC_FRAME_BYTES - valid.len()));
        assert_eq!(at_the_bound.len(), RENDERER_IPC_FRAME_BYTES);
        assert!(ValidatedRequest::decode(&at_the_bound).is_ok(), "exactly one frame is allowed");
        let over = format!("{at_the_bound} ");
        assert_eq!(ValidatedRequest::decode(&over), Err(TurnReason::Malformed));
        // One number, not two that happen to agree.
        assert_eq!(RENDERER_IPC_FRAME_BYTES, crate::ipc_framing::MAX_FRAME_PAYLOAD_BYTES);
    }

    #[test]
    fn committed_reply_carries_message_and_no_reason() {
        let m = CommittedMessage::new("m-1".into(), "Bro".into(), "hi".into(), 7, TRUSTED_VERIFIED.into());
        let r = RendererGovernedTurnResult::committed(CRID.into(), "bt-1".into(), "conv-1".into(), m);
        let json = r.to_json();
        assert!(json.contains(r#""status":"committed""#));
        assert!(json.contains(r#""trust_state":"trusted_verified""#));
        assert!(json.contains(r#""broker_turn_id":"bt-1""#));
        assert!(!json.contains(r#""reason""#)); // committed carries no reason
    }

    #[test]
    fn blocked_reply_carries_reason_and_no_message() {
        let r = RendererGovernedTurnResult::blocked(
            CRID.into(), "bt-1".into(), "conv-1".into(), TurnReason::TurnInProgress);
        let json = r.to_json();
        assert!(json.contains(r#""status":"blocked""#));
        assert!(json.contains(r#""reason":"turn_in_progress""#));
        assert!(!json.contains(r#""message""#)); // blocked carries no assistant message
    }
}
