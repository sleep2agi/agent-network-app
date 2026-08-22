// Tauri 2 shell (Vincent tg 824: 用 Tauri，替换 Electron).
// The http plugin backs the JS-side fetch patch — WKWebView enforces
// CORS and the hub sets no CORS headers, so requests go through Rust.
const SESSION_SERVICE: &str = "top.vansin.agentnetwork.desktop";
const SESSION_ACCOUNT: &str = "active-hub-session";

fn session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SESSION_SERVICE, SESSION_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_session(session_json: String) -> Result<(), String> {
    session_entry()?.set_password(&session_json).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_desktop_session() -> Result<Option<String>, String> {
    match session_entry()?.get_password() {
        Ok(session) => Ok(Some(session)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn clear_desktop_session() -> Result<(), String> {
    match session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // This deliberately exercises the platform credential store, rather than
    // a mock. It catches builds where keyring compiles but no macOS/Windows
    // backend feature was enabled (the regression shipped in 0.2.10).
    #[test]
    fn desktop_session_round_trip_uses_native_store() {
        let account = format!("ci-session-{}", std::process::id());
        let entry = keyring::Entry::new(SESSION_SERVICE, &account)
            .expect("native credential-store backend must be installed");
        let value = r#"{"serverUrl":"https://example.invalid","token":"test-token"}"#;

        entry.set_password(value).expect("write native credential store");
        assert_eq!(entry.get_password().expect("read native credential store"), value);
        entry.delete_credential().expect("delete native credential store fixture");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_desktop_session,
            load_desktop_session,
            clear_desktop_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
