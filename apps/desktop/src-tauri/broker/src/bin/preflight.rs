//! `brops-preflight` — say, by name, which prerequisites of a governed turn this machine meets.
//!
//! ```text
//! brops-preflight [--socket /run/brops/broker.sock] [--login-uid 1000]
//! ```
//!
//! Reads `$BROPS_BROKER_CONFIG` and the deployment it names, measures every requirement in
//! [`brops_broker::preflight::REQUIREMENTS`], and prints one line per requirement. `--socket` is the
//! broker's listening socket as its launcher would pass it in argv: the broker derives its database
//! path from that and from nothing else, so without it the durable-ledger row is reported as
//! unmeasurable rather than guessed. `--login-uid` is the uid the broker is launched for, its second
//! argument: the §2.5 integrity floor is decided against it and no config names it, so without it
//! that row is unmeasurable too.
//!
//! Exit codes — deliberately three, so "ready" cannot be collapsed with "could not tell":
//!
//! * `0` every requirement measured and met
//! * `1` at least one requirement NOT met
//! * `2` nothing not-met, but something could not be measured here
//!
//! This binary is a REPORT. It opens no socket, spawns no process, writes no file, and cannot make
//! any governed surface reachable — an all-met report still leaves
//! `governed_verification_unconfigured()`, `connect_broker()` and `UpstreamBlockedExecutor` exactly
//! where they are.

use brops_broker::preflight::{evaluate_as, RealHost};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut socket: Option<String> = None;
    let mut login_uid: Option<u32> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--socket" => {
                match args.get(i + 1) {
                    Some(v) => socket = Some(v.clone()),
                    None => {
                        eprintln!("brops-preflight: --socket needs a path");
                        std::process::exit(64);
                    }
                }
                i += 2;
            }
            "--login-uid" => {
                match args.get(i + 1).and_then(|v| v.parse::<u32>().ok()) {
                    Some(uid) => login_uid = Some(uid),
                    None => {
                        eprintln!("brops-preflight: --login-uid needs a numeric uid");
                        std::process::exit(64);
                    }
                }
                i += 2;
            }
            "-h" | "--help" => {
                println!("usage: brops-preflight [--socket <broker socket path>] [--login-uid <uid>]");
                std::process::exit(0);
            }
            other => {
                eprintln!("brops-preflight: unknown argument `{other}`");
                std::process::exit(64);
            }
        }
    }

    let report = evaluate_as(&RealHost, socket.as_deref(), login_uid);
    print!("{}", report.render());
    std::process::exit(report.exit_code());
}
