//! Cockpit read R3-0710. `Exposure::OwnerOnly` states the owner-only modes, and four functions in
//! `lib.rs` stated them again as bare `0o700` / `0o600`. They take the modes from the enum now;
//! these tests hold each of the four to it, by what the function does to a path or reports.
//!
//! This box's umask is 002 and CI's is 022, so every path is chmod-ed to a known loose mode
//! before the function under test runs: nothing here depends on what a plain create yields.
//!
//! No test here is compiled out. Where the platform has no modes the body says what is true
//! there instead: the two `secure_*` functions succeed and apply nothing, and the two reports
//! claim no mode.

use brops_provision as prov;
use brops_provision::{Exposure, Protection};

/// Set `path` to `to` and confirm it took, so the test starts from a mode it chose.
#[cfg(unix)]
fn chmod(path: &std::path::Path, to: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(to)).unwrap();
    assert_eq!(mode(path), to, "the fixture did not take its starting mode");
}

#[cfg(unix)]
fn mode(path: &std::path::Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o7777
}

#[test]
fn secure_data_dir_applies_the_owner_only_directory_mode() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("data");
    std::fs::create_dir(&dir).unwrap();
    #[cfg(unix)]
    chmod(&dir, 0o775);
    prov::secure_data_dir(&dir).unwrap();
    #[cfg(unix)]
    {
        assert_eq!(mode(&dir), Exposure::OwnerOnly.dir_mode());
        assert_eq!(mode(&dir), 0o700);
    }
}

#[test]
fn secure_owner_only_file_applies_the_owner_only_file_mode() {
    let scratch = tempfile::tempdir().unwrap();
    let file = scratch.path().join("secret");
    std::fs::write(&file, b"x").unwrap();
    #[cfg(unix)]
    chmod(&file, 0o664);
    prov::secure_owner_only_file(&file).unwrap();
    #[cfg(unix)]
    {
        assert_eq!(mode(&file), Exposure::OwnerOnly.file_mode());
        assert_eq!(mode(&file), 0o600);
    }
}

/// What the manifest records as "the protection applied" is the mode that was applied — and no
/// mode at all where none was.
#[test]
fn the_reported_directory_protection_is_the_owner_only_directory_mode() {
    let reported = prov::directory_protection();
    if cfg!(unix) {
        assert_eq!(reported, Protection::PosixMode(Exposure::OwnerOnly.dir_mode()));
        assert_eq!(reported, Protection::PosixMode(0o700));
    } else {
        assert!(matches!(reported, Protection::InheritedFromParent { .. }), "{reported}");
    }
}

#[test]
fn the_reported_key_file_protection_is_the_owner_only_file_mode() {
    let reported = prov::key_file_protection();
    if cfg!(unix) {
        assert_eq!(reported, Protection::PosixMode(Exposure::OwnerOnly.file_mode()));
        assert_eq!(reported, Protection::PosixMode(0o600));
    } else {
        assert!(matches!(reported, Protection::InheritedFromParent { .. }), "{reported}");
    }
}
