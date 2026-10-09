use keyring::{Entry, Error};

fn main() {
    let mode = std::env::args().nth(1).expect("mode");
    let entry = Entry::new("invalid.anet.persistence-fixture", "dummy-profile").expect("entry");
    assert!(entry.get_credential().downcast_ref::<keyring::mock::MockCredential>().is_none(), "mock forbidden");
    match mode.as_str() {
        "write" => {
            entry.set_password("dummy-not-a-token").expect("write real Secret Service");
            let reopened = Entry::new("invalid.anet.persistence-fixture", "dummy-profile").unwrap();
            assert_eq!(reopened.get_password().expect("new Entry"), "dummy-not-a-token");
        }
        "read" => assert_eq!(entry.get_password().expect("new process"), "dummy-not-a-token"),
        "delete" => entry.delete_credential().expect("delete real item"),
        "missing" => assert!(matches!(entry.get_password(), Err(Error::NoEntry))),
        "unavailable" => {
            assert!(matches!(entry.set_password("dummy-not-a-token"),
                Err(Error::NoStorageAccess(_)) | Err(Error::PlatformFailure(_))),
                "unavailable service must report a storage failure, not accept write");
            assert!(matches!(entry.get_password(),
                Err(Error::NoStorageAccess(_)) | Err(Error::PlatformFailure(_))),
                "unavailable service must report a storage failure, not return a secret/NoEntry");
        }
        _ => panic!("unknown mode"),
    }
    println!("PASS {mode}");
}
