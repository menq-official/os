//! Wave 3b — the validated signed-manifest **receipt-key authority** (design §5): the in-crate resolver
//! that [`crate::receipt::ResolvedManifestKey`]'s doc names as the ONLY thing allowed to mint a resolved
//! key. It closes the seam Wave 3a shipped as [`crate::receipt_store::NoTrustedManifest`] (always
//! `Unavailable`): given an operator-provisioned key manifest that has been verified against a
//! **root anchor whose custody supports a production claim** + anti-rollback-checked AND PERSISTED,
//! it resolves a receipt's `key_id` to the pinned production verifying key.
//!
//! # NOT IN SERVICE
//!
//! **Nothing constructs this type outside this file's tests.** The desktop passes
//! [`crate::receipt_store::NoTrustedManifest`] at every call site (`commands.rs`), and the path a
//! governed turn would actually take resolves its keys in the BROKER, in
//! `broker/src/manifest_resolver.rs`, with its own copy of the verify / anti-rollback / resolve
//! sequence. Documents that say "select `GovernedEngine` with a real `ManifestReceiptKeyAuthority`"
//! name a wiring that has not been done.
//!
//! It is kept correct rather than deleted, so that wiring it does not wire a weaker check than the
//! live one. It used not to be: `new` called the bare [`crate::key_manifest::verify_manifest`],
//! which "answers only the arithmetic question" and returns no evidence of WHICH root verified, and
//! `check_and_advance(..).is_err()`, which drops the advanced floor — the two shapes
//! `key_manifest`'s own docs say a production verdict must not rest on — and then minted
//! `TrustClass::Production` regardless of the root's custody.
//!
//! FAIL-CLOSED: [`ManifestReceiptKeyAuthority::new`] verifies the manifest under the anchor, requires
//! that anchor's provenance to support a production claim, and advances AND WRITES the anti-rollback
//! floor at construction; on any failure — or via [`ManifestReceiptKeyAuthority::fail_closed`] — it
//! holds NO keys and every `resolve` returns `Unavailable` (identical to `NoTrustedManifest`). It only
//! ever mints a key that `resolve_production_key` classified as **production-class, in-window,
//! non-revoked, protocol-allowed** — never a development or expired/revoked key — so it cannot turn
//! a non-production key into "Verified".
//!
//! NOTE (scope): this resolves the trusted key; whether the Wave-3a `receipt_store` renders `trusted_verified`
//! for a production key is a SEPARATE, audited Wave-3b store change. On its own this authority does not
//! expose "Verified" — a production key still resolves to `Blocked` in the Wave-3a store.

use std::path::Path;

use crate::domain::CoreResult;
use crate::key_manifest::{
    check_and_persist, decode_hex32, resolve_production_key, verify_manifest_anchored, AntiRollbackFloor,
    KeyManifest, RootAnchor,
};
use crate::receipt::{ResolvedManifestKey, TrustClass};
use crate::receipt_store::{KeyResolution, ReceiptKeyAuthority};

/// A receipt-key authority backed by a root-verified, anti-rollback-checked production key manifest.
pub struct ManifestReceiptKeyAuthority {
    /// Every manifest key that resolved as a valid production key at construction time, WITH the
    /// window it was valid in. Empty ⇒ fail-closed (every resolve is `Unavailable`).
    keys: Vec<HeldKey>,
    /// The time a `resolve` is decided at. `None` — a clock that cannot be read — is a refusal.
    clock: Clock,
}

/// A source of "now", in milliseconds since the epoch.
pub type Clock = Box<dyn Fn() -> Option<i64> + Send + Sync>;

/// A key this authority may mint, and until when.
///
/// Audit L-40. Only `(key_id, public key)` was kept, so the window the manifest signed was a
/// decision taken once, at construction: an authority built one millisecond before a key's
/// `valid_to_ms` went on returning it `Trusted` for as long as the process lived.
struct HeldKey {
    key_id: String,
    public_key: Vec<u8>,
    valid_from_ms: i64,
    valid_to_ms: i64,
}

fn system_now_ms() -> Option<i64> {
    let since_epoch = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since_epoch.as_millis()).ok()
}

impl ManifestReceiptKeyAuthority {
    /// A fail-closed authority: no trusted manifest ⇒ every `resolve` is `Unavailable`.
    pub fn fail_closed() -> Self {
        ManifestReceiptKeyAuthority { keys: Vec::new(), clock: Box::new(system_now_ms) }
    }

    /// Build from a provisioned manifest. In order, each a refusal that returns the fail-closed
    /// authority:
    ///
    /// 1. the root signature verifies under `anchor` ([`verify_manifest_anchored`], which returns the
    ///    evidence of which anchor that was);
    /// 2. that anchor's custody **supports a production claim**. Every key this type mints is
    ///    `TrustClass::Production`, so a manifest verified under a kit-generated or demonstration
    ///    root — or an install-minted one while the Owner's line is closed — mints nothing;
    /// 3. the manifest is not a rollback of `floor`, and the advanced floor is WRITTEN to
    ///    `floor_path` ([`check_and_persist`]). A floor that could not be written refuses.
    ///
    /// Then every manifest key is resolved through `resolve_production_key` (production-class /
    /// in-window / non-revoked / protocol-allowed) at `now_ms`, and only those are held.
    ///
    /// `floor` must be the floor read from durable storage, not one derived from `manifest`: a
    /// floor built from the manifest it is about to be compared with is a predicate that cannot
    /// fail.
    ///
    /// Each `resolve` afterwards is decided at the system clock's time, against the window the
    /// key was held with ([`Self::new_with_clock`] takes another clock).
    pub fn new(
        manifest: &KeyManifest,
        root_sig_b64: &str,
        anchor: &RootAnchor,
        floor: &AntiRollbackFloor,
        floor_path: &Path,
        protocol: &str,
        now_ms: i64,
    ) -> Self {
        Self::new_with_clock(
            manifest, root_sig_b64, anchor, floor, floor_path, protocol, now_ms, Box::new(system_now_ms),
        )
    }

    /// [`Self::new`], with the clock every later `resolve` reads.
    #[allow(clippy::too_many_arguments)]
    pub fn new_with_clock(
        manifest: &KeyManifest,
        root_sig_b64: &str,
        anchor: &RootAnchor,
        floor: &AntiRollbackFloor,
        floor_path: &Path,
        protocol: &str,
        now_ms: i64,
        clock: Clock,
    ) -> Self {
        let verified = match verify_manifest_anchored(manifest, root_sig_b64, anchor) {
            Ok(verified) => verified,
            Err(_) => return Self::fail_closed(),
        };
        if !verified.provenance().supports_production_claim() {
            return Self::fail_closed();
        }
        if check_and_persist(floor, manifest, floor_path).is_err() {
            return Self::fail_closed();
        }
        let mut keys = Vec::new();
        for k in &manifest.keys {
            if let Ok(rk) = resolve_production_key(manifest, &k.key_id, protocol, now_ms) {
                if let Some(bytes) = decode_hex32(&rk.public_key_hex) {
                    keys.push(HeldKey {
                        key_id: rk.key_id,
                        public_key: bytes.to_vec(),
                        valid_from_ms: k.valid_from_ms,
                        valid_to_ms: k.valid_to_ms,
                    });
                }
            }
        }
        ManifestReceiptKeyAuthority { keys, clock }
    }

    /// True iff at least one production key resolved (i.e. a trusted manifest is active).
    pub fn is_trusted(&self) -> bool {
        !self.keys.is_empty()
    }
}

impl ReceiptKeyAuthority for ManifestReceiptKeyAuthority {
    fn resolve<'a>(&'a self, key_id: &str) -> CoreResult<KeyResolution<'a>> {
        let Some(held) = self.keys.iter().find(|held| held.key_id == key_id) else {
            return Ok(KeyResolution::Unavailable(
                "key_id is not a resolved production key in the trusted manifest",
            ));
        };
        // The window, at the time of THIS receipt — the same half-open test
        // `resolve_production_key` applied when the key was taken in.
        let Some(now_ms) = (self.clock)() else {
            return Ok(KeyResolution::Unavailable("the clock could not be read, so no key is in its window"));
        };
        if now_ms < held.valid_from_ms || now_ms >= held.valid_to_ms {
            return Ok(KeyResolution::Unavailable(
                "the key was a production key when the manifest was accepted and is outside its validity window now",
            ));
        }
        Ok(KeyResolution::Trusted(ResolvedManifestKey::manifest_resolved(
            &held.key_id,
            &held.public_key,
            TrustClass::Production,
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key_manifest::{
        parse_floor_json, ManifestKey, PinnedRoot, RootProvenance, TrustClass as MTrustClass,
    };
    use base64::Engine as _;
    use ed25519_dalek::{Signer, SigningKey};

    fn sk(seed: [u8; 32]) -> SigningKey {
        SigningKey::from_bytes(&seed)
    }
    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }

    const PROTO: &str = "brops.governed-receipt-envelope.v1";

    fn manifest_with(keys: Vec<ManifestKey>) -> KeyManifest {
        KeyManifest { manifest_epoch: 2, root_key_id: "root-1".into(), keys }
    }
    fn key(id: &str, pk_hex: String, cls: MTrustClass, revoked: bool) -> ManifestKey {
        ManifestKey {
            key_id: id.into(),
            public_key_hex: pk_hex,
            trust_class: cls,
            valid_from_ms: 1,
            valid_to_ms: 9_999_999_999_999,
            key_epoch: 2,
            revoked,
            allowed_protocols: vec![PROTO.to_string()],
        }
    }

    /// One production key under a root, with the root's signature and an anchor of the given
    /// custody. The floor is BELOW the manifest (epoch 1 against the manifest's 2) and its hash is
    /// not the manifest's — a floor that was not derived from the thing it is compared with.
    struct Fixture {
        manifest: KeyManifest,
        root_sig: String,
        anchor: RootAnchor,
        floor: AntiRollbackFloor,
        dir: tempfile::TempDir,
    }

    impl Fixture {
        fn with(keys: Vec<ManifestKey>, provenance: RootProvenance) -> Self {
            let root = sk([9u8; 32]);
            let manifest = manifest_with(keys);
            let root_sig = base64::engine::general_purpose::STANDARD
                .encode(root.sign(&manifest.canonical_bytes()).to_bytes());
            Fixture {
                manifest,
                root_sig,
                anchor: RootAnchor {
                    pinned: PinnedRoot {
                        root_key_id: "root-1".into(),
                        public_key_hex: hex(root.verifying_key().as_bytes()),
                    },
                    provenance,
                },
                floor: AntiRollbackFloor { highest_epoch: 1, highest_hash: "f".repeat(64) },
                dir: tempfile::tempdir().unwrap(),
            }
        }
        fn production(provenance: RootProvenance) -> Self {
            let prod = sk([1u8; 32]);
            Self::with(
                vec![key("prod-1", hex(prod.verifying_key().as_bytes()), MTrustClass::Production, false)],
                provenance,
            )
        }
        fn floor_path(&self) -> std::path::PathBuf {
            self.dir.path().join("floor.json")
        }
        fn authority(&self) -> ManifestReceiptKeyAuthority {
            ManifestReceiptKeyAuthority::new(
                &self.manifest, &self.root_sig, &self.anchor, &self.floor, &self.floor_path(), PROTO, 1000,
            )
        }
    }

    fn trusted(auth: &ManifestReceiptKeyAuthority, key_id: &str) -> bool {
        matches!(auth.resolve(key_id).unwrap(), KeyResolution::Trusted(_))
    }

    #[test]
    fn resolves_a_production_key_and_rejects_everything_else() {
        let prod = sk([1u8; 32]);
        let dev = sk([2u8; 32]);
        let revoked = sk([3u8; 32]);
        let scoped = sk([4u8; 32]);
        let mut scoped_key =
            key("scoped-1", hex(scoped.verifying_key().as_bytes()), MTrustClass::Production, false);
        scoped_key.allowed_protocols = vec!["brops.other.v1".to_string()];
        let f = Fixture::with(
            vec![
                key("prod-1", hex(prod.verifying_key().as_bytes()), MTrustClass::Production, false),
                key("dev-1", hex(dev.verifying_key().as_bytes()), MTrustClass::Development, false),
                key("rev-1", hex(revoked.verifying_key().as_bytes()), MTrustClass::Production, true),
                scoped_key,
            ],
            RootProvenance::External,
        );
        let auth = f.authority();
        assert!(auth.is_trusted());
        // The production key resolves Trusted with its pinned bytes.
        assert!(trusted(&auth, "prod-1"));
        // Development, revoked, out-of-protocol-scope and unknown key ids are all Unavailable.
        for id in ["dev-1", "rev-1", "scoped-1", "nope"] {
            assert!(!trusted(&auth, id), "{id} must be Unavailable");
        }
    }

    /// L-40, the reviewer's sequence: a key valid until 1001, an authority built at 1000 and kept.
    /// At 1000 it is trusted; from 1001 on it is not, in the same process, without a restart.
    #[test]
    fn a_key_that_expires_while_the_authority_is_held_stops_resolving() {
        use std::sync::atomic::{AtomicI64, Ordering};
        use std::sync::Arc;
        let prod = sk([1u8; 32]);
        let mut expiring = key("prod-1", hex(prod.verifying_key().as_bytes()), MTrustClass::Production, false);
        expiring.valid_from_ms = 1;
        expiring.valid_to_ms = 1001;
        let f = Fixture::with(vec![expiring], RootProvenance::External);
        let now = Arc::new(AtomicI64::new(1000));
        let read = now.clone();
        let auth = ManifestReceiptKeyAuthority::new_with_clock(
            &f.manifest, &f.root_sig, &f.anchor, &f.floor, &f.floor_path(), PROTO, 1000,
            Box::new(move || Some(read.load(Ordering::SeqCst))),
        );
        assert!(trusted(&auth, "prod-1"), "in its window it resolves");
        now.store(1001, Ordering::SeqCst);
        assert!(!trusted(&auth, "prod-1"), "valid_to_ms is exclusive: at 1001 it has expired");
        now.store(5_000_000, Ordering::SeqCst);
        assert!(!trusted(&auth, "prod-1"));
        // The window has two ends: a clock set back before `valid_from_ms` does not resolve either.
        now.store(0, Ordering::SeqCst);
        assert!(!trusted(&auth, "prod-1"));
        // And it is a window, not a latch: back inside, it resolves again.
        now.store(1000, Ordering::SeqCst);
        assert!(trusted(&auth, "prod-1"));
    }

    /// A clock that cannot be read decides nothing in a key's favour.
    #[test]
    fn an_unreadable_clock_resolves_no_key() {
        let f = Fixture::production(RootProvenance::External);
        let auth = ManifestReceiptKeyAuthority::new_with_clock(
            &f.manifest, &f.root_sig, &f.anchor, &f.floor, &f.floor_path(), PROTO, 1000,
            Box::new(|| None),
        );
        assert!(auth.is_trusted(), "the key was taken in");
        assert!(!trusted(&auth, "prod-1"));
    }

    /// The ordinary constructor reads the real clock, and a key valid now resolves under it.
    #[test]
    fn the_ordinary_constructor_decides_against_the_real_clock() {
        let f = Fixture::production(RootProvenance::External);
        assert!(trusted(&f.authority(), "prod-1"));
        // A key whose window closed in 1970 is not taken in at a construction time inside it and
        // then trusted today: construction at 1000 holds it, the real clock refuses it.
        let prod = sk([1u8; 32]);
        let mut long_gone = key("prod-1", hex(prod.verifying_key().as_bytes()), MTrustClass::Production, false);
        long_gone.valid_to_ms = 2000;
        let f = Fixture::with(vec![long_gone], RootProvenance::External);
        let auth = f.authority();
        assert!(auth.is_trusted(), "at 1000 the key was in its window");
        assert!(!trusted(&auth, "prod-1"), "today it is not");
    }

    #[test]
    fn a_bad_root_signature_is_fail_closed() {
        let mut f = Fixture::production(RootProvenance::External);
        // Garbage root signature ⇒ no keys ⇒ every resolve Unavailable.
        f.root_sig = "bogus".into();
        let auth = f.authority();
        assert!(!auth.is_trusted());
        assert!(!trusted(&auth, "prod-1"));
        // ...and a refused manifest writes no floor.
        assert!(!f.floor_path().exists(), "a manifest that did not verify must not advance the floor");
        // The explicit fail-closed constructor is also always Unavailable.
        assert!(!trusted(&ManifestReceiptKeyAuthority::fail_closed(), "prod-1"));
    }

    /// The custody rule. Everything is right — signature, floor, key class, window, protocol —
    /// except who could have produced the root. This type mints `TrustClass::Production`, so a
    /// root that cannot support a production claim mints nothing. It used to mint under any root
    /// whose signature verified: a demonstration root's own manifest verifies perfectly well.
    #[test]
    fn a_root_whose_custody_cannot_support_production_mints_nothing() {
        for provenance in [
            RootProvenance::Demonstration,
            RootProvenance::KitGenerated,
            // The Owner's line ships closed, so an install-minted root is not production either.
            RootProvenance::InstallMinted,
        ] {
            let f = Fixture::production(provenance);
            let auth = f.authority();
            assert!(!auth.is_trusted(), "{provenance:?} minted a Production key");
            assert!(!trusted(&auth, "prod-1"), "{provenance:?}");
            assert!(!f.floor_path().exists(), "{provenance:?}: nothing was accepted, so nothing advances");
        }
        // Positive control: the same fixture under an external root does mint.
        assert!(Fixture::production(RootProvenance::External).authority().is_trusted());
    }

    /// The anti-rollback floor is ADVANCED AND WRITTEN. `check_and_advance(..).is_err()` compared
    /// and threw the result away, so the "highest accepted epoch" never rose and a restart reset
    /// it. Here the file a new process would read holds the manifest's epoch and hash.
    #[test]
    fn the_accepted_manifest_becomes_the_durable_floor() {
        let f = Fixture::production(RootProvenance::External);
        assert!(f.authority().is_trusted());
        let written = parse_floor_json(&std::fs::read(f.floor_path()).expect("the floor was written"))
            .expect("and it parses");
        assert_eq!(written.highest_epoch, f.manifest.manifest_epoch);
        assert_eq!(written.highest_hash, f.manifest.content_hash());
    }

    #[test]
    fn a_rolled_back_manifest_or_an_unwritable_floor_is_fail_closed() {
        // A floor ABOVE the manifest: a rollback.
        let mut f = Fixture::production(RootProvenance::External);
        f.floor = AntiRollbackFloor { highest_epoch: 3, highest_hash: "f".repeat(64) };
        assert!(!f.authority().is_trusted());
        assert!(!f.floor_path().exists());

        // The same epoch with a different hash: a fork at that epoch.
        let mut f = Fixture::production(RootProvenance::External);
        f.floor = AntiRollbackFloor { highest_epoch: 2, highest_hash: "f".repeat(64) };
        assert!(!f.authority().is_trusted());

        // A floor that cannot be written is a floor that did not advance.
        let f = Fixture::production(RootProvenance::External);
        let nowhere = f.dir.path().join("no-such-directory").join("floor.json");
        let auth = ManifestReceiptKeyAuthority::new(
            &f.manifest, &f.root_sig, &f.anchor, &f.floor, &nowhere, PROTO, 1000,
        );
        assert!(!auth.is_trusted());
    }
}
