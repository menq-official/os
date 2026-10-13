//! Wave 3b-1B — governed-chain IPC framing + peer authentication (design-GREEN rev-30 §2.1/§4.10(g)
//! transport layer). The trusted-principal AF_UNIX channels (renderer→broker, broker→authority,
//! broker→supervisor→signer) all share ONE length-prefixed frame FORMAT: a 4-byte big-endian length,
//! then that many bytes. The BOUND is not shared. [`MAX_FRAME_PAYLOAD_BYTES`] (8192) is what this
//! module's readers and `encode_frame` apply, and it is the cap of the legs the Rust side speaks:
//! renderer↔broker, and the broker's hops to the challenge authority and the supervisor (both Python
//! servers set `MAX_FRAME_BYTES = 8192`). The supervisor→signer leg is Python on both ends and its
//! server reads up to `512 * 1024` (`engine/runtime/isolated_signer_server.py`); nothing here frames it.
//!
//! The peer-auth rule ([`authorize_peer`]) is: authenticate the connecting peer's OS credentials
//! (`SO_PEERCRED` on Linux), refuse a UID on the deny list, and allow EXACTLY the expected principal
//! UID. It has ONE caller in this workspace — the broker's renderer door
//! (`broker/src/main.rs::handle_conn`) — and that caller passes an EMPTY deny list: there the renderer
//! is the allowed peer and any other UID is refused as `NotAllowed`. The doors a renderer or the
//! sidecar must not reach (challenge authority, supervisor, signer) are Python services with their
//! own peer checks; this function does not guard them.
//!
//! This module is the PURE, host-independent framing + peer-auth core (fully unit-tested). The real socket
//! `bind`/`accept`/`recv` + the `SO_PEERCRED` read are a thin Linux-gated wrapper that populates
//! [`PeerCred`] from the kernel and calls [`authorize_peer`]; keeping the decision logic pure means every
//! bound/malformed/wrong-peer rule is testable without a socket.

/// The maximum accepted frame payload (bytes). A frame declaring more is refused before allocation — a
/// bounded ingress that cannot be used to exhaust memory. Matches the renderer↔broker 8 KiB cap and the
/// authority reply cap; the larger staged inputs travel as store handles, never inline (rev-30 §2.4).
pub const MAX_FRAME_PAYLOAD_BYTES: usize = 8192;

/// The fixed length-prefix width (bytes, big-endian u32).
pub const LENGTH_PREFIX_BYTES: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    /// The payload exceeds [`MAX_FRAME_PAYLOAD_BYTES`].
    Oversize(usize),
    /// The buffer is shorter than the declared frame (need more bytes / truncated).
    Truncated,
    /// The length prefix declares a payload over the cap (rejected before allocation).
    DeclaredOversize(usize),
    /// Bytes remain after a complete frame where exactly one was expected.
    TrailingBytes,
    /// The frame has no payload. A frame carries one JSON document, and there is no empty one.
    Empty,
}

/// The payload length a 4-byte prefix declares, or why it is not a frame.
///
/// THE one place the length rule is written, for every reader in this module. Two things are
/// refused before a byte of payload is read or allocated: a length over the cap, and ZERO. The
/// zero rule used to be decided in three places and two ways — [`decode_one`] and
/// [`FrameDecoder::next_frame`] here accepted an empty frame, while the broker's two hand-rolled
/// socket readers (and every Python service on the other end of them) refused one.
///
/// "In this module" is the limit of that claim. Two readers OUTSIDE it still spell the same rule
/// out by hand over their own `u32::from_be_bytes`: `recv_all` in `broker/src/chain_executor.rs`
/// and `read_frame_payload` in `win-live/src/pipe.rs` (cockpit read R3-0676). They agree with this
/// function today and nothing but the shared constant ties them to it.
fn declared_len(prefix: [u8; LENGTH_PREFIX_BYTES]) -> Result<usize, FrameError> {
    let declared = u32::from_be_bytes(prefix) as usize;
    if declared == 0 {
        return Err(FrameError::Empty);
    }
    if declared > MAX_FRAME_PAYLOAD_BYTES {
        return Err(FrameError::DeclaredOversize(declared));
    }
    Ok(declared)
}

/// Encode `payload` as a length-prefixed frame: `u32 big-endian length || payload`. Fails closed if the
/// payload exceeds the cap, or is empty — a frame every reader refuses is not one to send.
pub fn encode_frame(payload: &[u8]) -> Result<Vec<u8>, FrameError> {
    if payload.is_empty() {
        return Err(FrameError::Empty);
    }
    if payload.len() > MAX_FRAME_PAYLOAD_BYTES {
        return Err(FrameError::Oversize(payload.len()));
    }
    let mut out = Vec::with_capacity(LENGTH_PREFIX_BYTES + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Decode EXACTLY ONE frame from `buf`, returning its payload slice. The buffer must contain exactly the
/// length prefix + that many payload bytes and nothing more (a single-request/single-response channel).
/// The declared length is validated against the cap BEFORE any read, so an attacker-declared huge length
/// is refused without allocation.
pub fn decode_one(buf: &[u8]) -> Result<&[u8], FrameError> {
    if buf.len() < LENGTH_PREFIX_BYTES {
        return Err(FrameError::Truncated);
    }
    let declared = declared_len([buf[0], buf[1], buf[2], buf[3]])?;
    let end = LENGTH_PREFIX_BYTES + declared;
    if buf.len() < end {
        return Err(FrameError::Truncated);
    }
    if buf.len() > end {
        return Err(FrameError::TrailingBytes);
    }
    Ok(&buf[LENGTH_PREFIX_BYTES..end])
}

/// A streaming frame accumulator for a real socket read loop: feed it received bytes; it yields complete
/// frame payloads one at a time and buffers the remainder. Fails closed on a declared-oversize length.
#[derive(Debug, Default)]
pub struct FrameDecoder {
    buf: Vec<u8>,
}

impl FrameDecoder {
    pub fn new() -> Self {
        FrameDecoder { buf: Vec::new() }
    }

    /// Append received bytes.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    /// Pop the next complete frame payload, or None if not yet complete. `Err` on a declared-oversize
    /// or zero length (fail closed — the caller must drop the connection).
    pub fn next_frame(&mut self) -> Result<Option<Vec<u8>>, FrameError> {
        if self.buf.len() < LENGTH_PREFIX_BYTES {
            return Ok(None);
        }
        let declared = declared_len([self.buf[0], self.buf[1], self.buf[2], self.buf[3]])?;
        let end = LENGTH_PREFIX_BYTES + declared;
        if self.buf.len() < end {
            return Ok(None);
        }
        let payload = self.buf[LENGTH_PREFIX_BYTES..end].to_vec();
        self.buf.drain(..end);
        Ok(Some(payload))
    }
}

/// OS peer credentials of a connected AF_UNIX peer (from `SO_PEERCRED` on Linux). The real read is a
/// thin Linux-gated wrapper; this struct is what the pure auth rule consumes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeerCred {
    pub uid: u32,
    pub gid: u32,
    pub pid: i32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PeerError {
    /// The peer UID is explicitly on the deny list (e.g. the renderer/login or sidecar UID).
    Denied(u32),
    /// The peer UID is not the single allowed principal UID.
    NotAllowed(u32),
}

/// Authorize a connecting peer: it MUST be exactly `allowed_uid` and MUST NOT be a `denied` UID. The
/// deny list is consulted FIRST, so a denied UID is `Denied` and never the weaker `NotAllowed`.
///
/// The shape is the rev-30 §2.1 one (a door allowlists one principal UID and denies the
/// renderer/login and sidecar UIDs), and that is a statement about the shape, not about where it
/// runs: the one caller in this workspace is the broker's RENDERER door, which passes an empty
/// `denied`, so the `Denied` branch has no shipped caller that populates it. The challenge
/// authority, the supervisor and the signer are Python services and check their peers themselves.
pub fn authorize_peer(peer: &PeerCred, allowed_uid: u32, denied: &[u32]) -> Result<(), PeerError> {
    if denied.contains(&peer.uid) {
        return Err(PeerError::Denied(peer.uid));
    }
    if peer.uid != allowed_uid {
        return Err(PeerError::NotAllowed(peer.uid));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip() {
        let payload = br#"{"protocol":"brops.renderer-governed-turn.v1"}"#;
        let frame = encode_frame(payload).unwrap();
        assert_eq!(decode_one(&frame).unwrap(), payload);
    }

    #[test]
    fn encode_rejects_oversize_payload() {
        let big = vec![0u8; MAX_FRAME_PAYLOAD_BYTES + 1];
        assert_eq!(encode_frame(&big), Err(FrameError::Oversize(big.len())));
    }

    #[test]
    fn decode_rejects_truncated_and_trailing_and_declared_oversize() {
        let frame = encode_frame(b"hi").unwrap();
        assert_eq!(decode_one(&frame[..3]), Err(FrameError::Truncated)); // short prefix
        assert_eq!(decode_one(&frame[..5]), Err(FrameError::Truncated)); // short payload
        let mut trailing = frame.clone();
        trailing.push(0xff);
        assert_eq!(decode_one(&trailing), Err(FrameError::TrailingBytes));
        // a length prefix claiming a huge payload is refused before allocation
        let mut evil = (u32::MAX).to_be_bytes().to_vec();
        evil.extend_from_slice(b"x");
        assert_eq!(decode_one(&evil), Err(FrameError::DeclaredOversize(u32::MAX as usize)));
    }

    /// The zero rule, at every door: a frame with no payload is refused by the one-shot decoder
    /// and by the streaming decoder, and is not one this side will encode.
    #[test]
    fn an_empty_frame_is_refused_by_every_reader_and_never_encoded() {
        let empty = 0u32.to_be_bytes();
        assert_eq!(decode_one(&empty), Err(FrameError::Empty));
        let mut d = FrameDecoder::new();
        d.feed(&empty);
        assert_eq!(d.next_frame(), Err(FrameError::Empty));
        assert_eq!(encode_frame(b""), Err(FrameError::Empty));
        // Positive control: one byte is a frame, at both.
        let one = encode_frame(b"x").unwrap();
        assert_eq!(decode_one(&one).unwrap(), b"x");
        let mut d = FrameDecoder::new();
        d.feed(&one);
        assert_eq!(d.next_frame().unwrap(), Some(b"x".to_vec()));
    }

    /// The streaming reader over bytes that arrived together: exactly one frame per call, the
    /// bound judged on the prefix alone, and a peer that stopped early yields NO frame rather
    /// than a short one handed up as whole. (These cases were written against a blocking
    /// `read_one_frame` that nothing outside this module's tests called; it is gone, and the
    /// same inputs are put to the two readers that are called.)
    #[test]
    fn the_streaming_decoder_reads_exactly_one_bounded_frame_at_a_time() {
        let mut two = encode_frame(b"first").unwrap();
        two.extend_from_slice(&encode_frame(b"second").unwrap());
        let mut d = FrameDecoder::new();
        d.feed(&two);
        assert_eq!(d.next_frame().unwrap(), Some(b"first".to_vec()));
        // It consumed exactly one frame: the second is still there to be read.
        assert_eq!(d.next_frame().unwrap(), Some(b"second".to_vec()));
        assert_eq!(d.next_frame().unwrap(), None);
        // The one-shot decoder refuses the same bytes: one frame was expected, two arrived.
        assert_eq!(decode_one(&two), Err(FrameError::TrailingBytes));

        // One over the cap, declared with nothing after it: refused on the prefix alone.
        let over_cap = (MAX_FRAME_PAYLOAD_BYTES as u32 + 1).to_be_bytes();
        let mut d = FrameDecoder::new();
        d.feed(&over_cap);
        assert_eq!(d.next_frame(), Err(FrameError::DeclaredOversize(MAX_FRAME_PAYLOAD_BYTES + 1)));
        assert_eq!(decode_one(&over_cap), Err(FrameError::DeclaredOversize(MAX_FRAME_PAYLOAD_BYTES + 1)));

        let whole = encode_frame(b"hello").unwrap();
        for cut in [0, 2, 4, 6, whole.len() - 1] {
            let mut d = FrameDecoder::new();
            d.feed(&whole[..cut]);
            assert_eq!(d.next_frame(), Ok(None), "a stream cut at {cut} bytes is not a frame");
            assert_eq!(decode_one(&whole[..cut]), Err(FrameError::Truncated), "cut at {cut}");
        }
    }

    /// The cap is INCLUSIVE: a payload of exactly [`MAX_FRAME_PAYLOAD_BYTES`] is a frame at every
    /// door, and one byte more is not. Every other test in the workspace that names the constant
    /// uses `+ 1`, so `>` could have become `>=` in `declared_len` or `encode_frame` — refusing
    /// the largest frame the design allows — with nothing red (cockpit read R3-1241).
    #[test]
    fn a_frame_of_exactly_the_cap_is_accepted_and_one_byte_more_is_not() {
        let exactly = vec![b'a'; MAX_FRAME_PAYLOAD_BYTES];
        let frame = encode_frame(&exactly).expect("a payload of exactly the cap must encode");
        assert_eq!(frame.len(), LENGTH_PREFIX_BYTES + MAX_FRAME_PAYLOAD_BYTES);
        assert_eq!(frame[..LENGTH_PREFIX_BYTES], (MAX_FRAME_PAYLOAD_BYTES as u32).to_be_bytes());
        assert_eq!(decode_one(&frame).expect("…and decode"), &exactly[..]);
        let mut d = FrameDecoder::new();
        d.feed(&frame);
        assert_eq!(d.next_frame().expect("…and stream"), Some(exactly.clone()));

        let mut over = exactly;
        over.push(b'a');
        assert_eq!(encode_frame(&over), Err(FrameError::Oversize(MAX_FRAME_PAYLOAD_BYTES + 1)));
        let mut over_frame = (over.len() as u32).to_be_bytes().to_vec();
        over_frame.extend_from_slice(&over);
        assert_eq!(decode_one(&over_frame), Err(FrameError::DeclaredOversize(MAX_FRAME_PAYLOAD_BYTES + 1)));
    }

    #[test]
    fn streaming_decoder_yields_frames_across_chunks() {
        let f1 = encode_frame(b"first").unwrap();
        let f2 = encode_frame(b"second").unwrap();
        let mut d = FrameDecoder::new();
        d.feed(&f1[..2]); // partial prefix
        assert_eq!(d.next_frame().unwrap(), None);
        d.feed(&f1[2..]); // rest of frame 1
        assert_eq!(d.next_frame().unwrap(), Some(b"first".to_vec()));
        d.feed(&f2);
        assert_eq!(d.next_frame().unwrap(), Some(b"second".to_vec()));
        assert_eq!(d.next_frame().unwrap(), None);
    }

    #[test]
    fn streaming_decoder_fails_closed_on_declared_oversize() {
        let mut d = FrameDecoder::new();
        d.feed(&(u32::MAX).to_be_bytes());
        assert_eq!(d.next_frame(), Err(FrameError::DeclaredOversize(u32::MAX as usize)));
    }

    /// `NM-IPC-06` — "Renderer → any service IPC". The matrix row names its spec section and
    /// `config/negative-matrix.json` carries it; this comment deliberately does NOT repeat the
    /// number, because `check_spec_references.py` reads a § in the source as a claim that the
    /// whole section holds, and what was established here is one row. A UID on the deny list is
    /// refused by `authorize_peer` BEFORE any frame is read. The row bound here is the renderer arm;
    /// the same assertion block also covers the sidecar arm and the not-on-the-allowlist arm, which
    /// belong to other rows and are deliberately left where they are rather than split apart.
    ///
    /// WHAT THIS DOES NOT ESTABLISH. It exercises the PREDICATE, with three invented UIDs. It used
    /// to conclude "so no trusted-principal channel can be reached from the window", and that is
    /// not shown here: the one caller of `authorize_peer` in this workspace is the broker's
    /// RENDERER door (`broker/src/main.rs::handle_conn`), which passes an EMPTY deny list — there
    /// the renderer is the allowed peer, and a wrong UID is refused as `NotAllowed`. The doors a
    /// renderer must not reach (challenge authority, supervisor, signer) are Python services with
    /// their own peer checks and their own rows. So the `Denied` branch below has no shipped
    /// caller that populates it, and the matrix row resting on this test alone overstates it.
    ///
    /// Order matters and is what the mutation proves: `denied` is consulted FIRST, so a renderer
    /// gets `Denied`, not `NotAllowed`. Delete that check and the renderer still fails to connect
    /// — for the weaker reason that it is not the broker — and a test asserting only "connection
    /// refused" would stay green while the deny list had stopped existing.
    #[test]
    fn nm_ipc_06_a_renderer_uid_is_denied_at_a_trusted_channel_door() {
        // NM-IPC-06 — Renderer → any service IPC: the renderer/login UID is on the deny list and
        // is refused before any frame is read, with `Denied` rather than the weaker `NotAllowed`.
        const BROKER: u32 = 5002;
        const RENDERER: u32 = 1000;
        const SIDECAR: u32 = 5004;
        let denied = [RENDERER, SIDECAR];
        assert!(authorize_peer(&PeerCred { uid: BROKER, gid: 0, pid: 10 }, BROKER, &denied).is_ok());
        assert_eq!(authorize_peer(&PeerCred { uid: RENDERER, gid: 0, pid: 11 }, BROKER, &denied), Err(PeerError::Denied(RENDERER)));
        assert_eq!(authorize_peer(&PeerCred { uid: SIDECAR, gid: 0, pid: 12 }, BROKER, &denied), Err(PeerError::Denied(SIDECAR)));
        assert_eq!(authorize_peer(&PeerCred { uid: 9999, gid: 0, pid: 13 }, BROKER, &denied), Err(PeerError::NotAllowed(9999)));
    }
}
