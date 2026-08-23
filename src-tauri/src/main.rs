// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|arg| arg == "--smoke-local-hub") {
        match app_lib::run_packaged_local_hub_smoke() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("packaged local Hub smoke failed: {error}");
                std::process::exit(1);
            }
        }
    }
    if std::env::args().any(|arg| arg == "--smoke-local-hub-migration") {
        match app_lib::run_packaged_local_hub_migration_smoke() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("packaged local Hub migration smoke failed: {error}");
                std::process::exit(1);
            }
        }
    }
    if std::env::args().any(|arg| arg == "--smoke-multihub") {
        match app_lib::run_packaged_multihub_smoke() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("packaged multi-Hub smoke failed: {error}");
                std::process::exit(1);
            }
        }
    }
    if std::env::args().any(|arg| arg == "--smoke-multihub-verify") {
        match app_lib::run_packaged_multihub_cold_start_verify() {
            Ok(()) => std::process::exit(0),
            Err(error) => {
                eprintln!("packaged multi-Hub cold-start verification failed: {error}");
                std::process::exit(1);
            }
        }
    }
    app_lib::run()
}
