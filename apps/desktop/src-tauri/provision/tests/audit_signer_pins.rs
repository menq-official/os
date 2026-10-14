//! Pure properties of `audit_signer` that nothing asserted. They run on every host.

use brops_provision::audit_signer as anc;
use brops_provision::audit_signer::{AnchorRefusal, AppTokenPosture, Separation};

/// A plausible interactive user: `S-1-5-21-<machine>-<rid>`.
const APP: &str = "S-1-5-21-1004336348-1177238915-682003330-1001";

/// Cockpit read R3-0708. `SIGNER_SERVICE_NAME` is documented as the one string the service
/// name, the account name and the derived SID share. `Separation::claim` returns `&'static str`
/// and types the account name out again in both arms; this is what ties the two to the constant.
#[test]
fn every_claim_names_the_account_the_service_name_constant_names() {
    let account = format!("NT SERVICE\\{}", anc::SIGNER_SERVICE_NAME);
    for posture in [
        AppTokenPosture::StandardUser,
        AppTokenPosture::FilteredAdministrator,
        AppTokenPosture::ElevatedAdministrator,
    ] {
        let claim = Separation::from_posture(posture).claim();
        assert!(claim.contains(&account), "the claim does not name {account}: {claim}");
    }
}

/// Cockpit read R3-0375. `check_principals` carries a second refusal — "the signer is one of
/// [`anc::TCB_SIDS`]" — behind the service-SID check, where it cannot be taken today: neither TCB
/// SID begins `S-1-5-80-`. The branch stays; this holds the property whichever of the two rules
/// does the refusing. It walks the constant, so every SID in `TCB_SIDS` is tried by name.
#[test]
fn no_tcb_principal_is_accepted_as_the_signer() {
    assert!(!anc::TCB_SIDS.is_empty());
    for tcb in anc::TCB_SIDS {
        assert!(
            matches!(
                anc::key_dacl_plan(APP, tcb),
                Err(AnchorRefusal::SignerNotAServiceAccount { ref sid }) if sid == tcb
            ),
            "the key plan took {tcb} as its signer"
        );
        assert!(
            matches!(
                anc::ledger_dacl_plan(APP, tcb),
                Err(AnchorRefusal::SignerNotAServiceAccount { ref sid }) if sid == tcb
            ),
            "the ledger plan took {tcb} as its signer"
        );
    }
}
