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
    app_lib::run()
}
