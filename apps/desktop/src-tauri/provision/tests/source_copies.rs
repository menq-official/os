//! Copies that cannot be shared, held equal by reading the sources.
//!
//! Each test here exists because one rule is written out in more than one place and the crate
//! graph, or a platform gate, keeps the copies from becoming one item: `brops-win-live` is a
//! dependency of this crate on Windows only, and half of `provision_with_anchor` is reached on
//! Windows only. A copy that drifts would change nothing a test on this host executes, so the
//! tests compare the text. They read files relative to `CARGO_MANIFEST_DIR` and write nothing.

use std::path::Path;

use brops_provision::audit_signer as anc;

fn source(relative: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(relative);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// The body of the one `fn looks_like_sid` in the file, with all whitespace removed and the
/// closure parameter spelled `p` — `pipe_acl` calls it `part`, which is the only difference
/// between the three bodies and not a difference in the rule.
fn looks_like_sid_body(relative: &str) -> String {
    const SIGNATURE: &str = "fn looks_like_sid(s: &str) -> bool {";
    let text = source(relative);
    assert_eq!(text.matches(SIGNATURE).count(), 1, "{relative}: expected one `{SIGNATURE}`");
    let after = text.split(SIGNATURE).nth(1).unwrap();
    let end = after.find("\n}").unwrap_or_else(|| panic!("{relative}: the body has no end"));
    let body: String = after[..end].chars().filter(|c| !c.is_whitespace()).collect();
    assert!(!body.is_empty(), "{relative}: the body is empty");
    body.replace("part", "p")
}

/// Cockpit read R3-0706. `audit_signer::looks_like_sid` says it is the same rule as the two
/// private copies in `brops-win-live`. Nothing held the three equal.
#[test]
fn the_three_looks_like_sid_bodies_are_one_rule() {
    let here = looks_like_sid_body("src/audit_signer.rs");
    for other in ["../win-live/src/provision_custody.rs", "../win-live/src/pipe_acl.rs"] {
        assert_eq!(
            here,
            looks_like_sid_body(other),
            "{other} no longer states the rule this crate states"
        );
    }
}

/// What that rule is, on the copy this crate can call.
#[test]
fn looks_like_sid_accepts_dash_separated_digits_after_s_1_and_nothing_else() {
    for sid in ["S-1-5-18", "S-1-5-32-544", "S-1-5-80-1-2-3-4-5", "S-1-0"] {
        assert!(anc::looks_like_sid(sid), "{sid:?} was refused");
    }
    for not_a_sid in [
        "", "S-1-", "S-1", "S-1--5", "s-1-5-18", "S-2-5-18", "S-1-5-x", "S-1-5-18 ", "S-1-5-18-",
        " S-1-5-18",
    ] {
        assert!(!anc::looks_like_sid(not_a_sid), "{not_a_sid:?} was accepted");
    }
}

/// Cockpit read R3-0712. The staging directory's name is built in three places — two in
/// `lib.rs`, one in `posix_install.rs` — and `tests/provision.rs` and `tests/anchor_custody.rs`
/// look for leftovers by that prefix. One of the three is on a path only Windows reaches.
#[test]
fn every_staging_directory_is_named_with_the_one_prefix() {
    const BUILT: &str = "format!(\".trust-staging-{}\"";
    assert_eq!(source("src/lib.rs").matches(BUILT).count(), 2, "src/lib.rs");
    assert_eq!(source("src/posix_install.rs").matches(BUILT).count(), 1, "src/posix_install.rs");
}

/// A Rust string literal's `\`-newline continuation, undone, so a sentence wrapped differently
/// in two files still compares equal.
fn unwrapped(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(at) = rest.find('\\') {
        let (before, after) = rest.split_at(at);
        out.push_str(before);
        let tail = &after[1..];
        if tail.starts_with('\n') || tail.starts_with("\r\n") {
            rest = tail.trim_start();
        } else {
            out.push('\\');
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// Cockpit read R3-0713. `settle_existing` says it refuses a manifest-less directory "exactly as
/// `provision_with_anchor` refuses it". The two refusals are written out separately, and the one
/// in `provision_with_anchor` is past the point where every platform but Windows has returned.
#[test]
fn both_refusals_of_a_manifestless_anchor_directory_say_the_same_thing() {
    const WHAT: &str =
        "\"the trust anchor path already holds something that is not a provisioned anchor\"";
    const DETAIL: &str = "\"{} exists but has no {MANIFEST_FILE}. It is either a half-removed \
        anchor or a directory something else owns; minting over it would destroy whichever it is";
    for relative in ["src/lib.rs", "src/posix_install.rs"] {
        let text = unwrapped(&source(relative));
        assert_eq!(text.matches(WHAT).count(), 1, "{relative}: the refusal's name");
        assert_eq!(text.matches(DETAIL).count(), 1, "{relative}: the refusal's detail");
    }
}
