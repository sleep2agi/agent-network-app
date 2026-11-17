fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    assert_eq!(args.len(), 2, "usage: native-install SESSION_FILE REPORT_FILE");
    if let Err(error) = local_daemon_init_regression::native_install(args[0].as_ref(), args[1].as_ref()) {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
