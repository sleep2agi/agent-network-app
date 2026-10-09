//! Historical dependency-level reproducer; does not build or certify the Tauri app.
use keyring::{Entry, Error};
use std::process::{self, Command};

const SERVICE: &str = "invalid.anet.linux-baseline";
const ACCOUNT: &str = "non-secret-fixture";
const VALUE: &str = "dummy-not-a-token";

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_default();
    let entry = Entry::new(SERVICE, ACCOUNT).expect("create fixture entry");
    if mode == "--child-read" {
        match entry.get_password() {
            Ok(value) if value == VALUE => process::exit(0),
            Err(Error::NoEntry) => process::exit(42),
            other => panic!("unexpected child read: {other:?}"),
        }
    }
    assert!(mode == "--expect-mock" || mode == "--require-persistence", "explicit mode required");
    let is_mock = entry.get_credential().downcast_ref::<keyring::mock::MockCredential>().is_some();
    entry.set_password(VALUE).expect("fixture write");
    assert_eq!(entry.get_password().expect("same-entry read"), VALUE);
    println!("same-entry round trip: PASS (not proof of native storage)");

    let reopened = Entry::new(SERVICE, ACCOUNT).expect("new entry with identical identity");
    let new_entry_missing = matches!(reopened.get_password(), Err(Error::NoEntry));
    let child = Command::new(std::env::current_exe().expect("probe executable"))
        .arg("--child-read").status().expect("child process");
    entry.delete_credential().expect("delete fixture");
    assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
    println!("backend_is_mock={is_mock}; new_entry_missing={new_entry_missing}; child_exit={:?}", child.code());

    if mode == "--expect-mock" {
        assert!(is_mock && new_entry_missing && child.code() == Some(42));
        println!("BASELINE REPRODUCED: credentials are lost outside the original Entry");
    } else {
        // This is deliberately RED on the historical configuration. Never turn this
        // failure into a Linux support claim just because --expect-mock was green.
        assert!(!is_mock && !new_entry_missing && child.success(), "PERSISTENCE REQUIRED: mock / lost credentials");
    }
}

