// Tauri 2 shell (Vincent tg 824: 用 Tauri，替换 Electron).
// The http plugin backs the JS-side fetch patch — WKWebView enforces
// CORS and the hub sets no CORS headers, so requests go through Rust.
const SESSION_SERVICE: &str = "top.vansin.agentnetwork.desktop";
const SESSION_ACCOUNT: &str = "active-hub-session";

use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};
use tauri::Emitter;

static NETWORK_EVENT_TASKS: LazyLock<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum NetworkEventPayload {
    State {
        stream_id: String,
        state: String,
        error: Option<String>,
    },
    Event {
        stream_id: String,
        event: serde_json::Value,
    },
}

fn emit_network_state(app: &tauri::AppHandle, stream_id: &str, state: &str, error: Option<String>) {
    let _ = app.emit(
        "network-event-stream",
        NetworkEventPayload::State {
            stream_id: stream_id.to_owned(),
            state: state.to_owned(),
            error,
        },
    );
}

#[tauri::command]
fn start_network_event_stream(
    app: tauri::AppHandle,
    stream_id: String,
    server_url: String,
    token: String,
    network_id: String,
) -> Result<(), String> {
    if stream_id.is_empty() || stream_id.len() > 160 || network_id.is_empty() {
        return Err("invalid stream identity".into());
    }
    let base = reqwest::Url::parse(&server_url).map_err(|_| "invalid server URL")?;
    if !matches!(base.scheme(), "http" | "https") {
        return Err("server URL must use http or https".into());
    }
    let url = base
        .join(&format!(
            "events/network/{}",
            network_id.replace('/', "%2F")
        ))
        .map_err(|_| "invalid network event URL")?;

    if let Some(old) = NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .remove(&stream_id)
    {
        old.abort();
    }

    let task_id = stream_id.clone();
    let handle = tauri::async_runtime::spawn(async move {
        emit_network_state(&app, &task_id, "connecting", None);
        let response = match reqwest::Client::new()
            .get(url)
            .bearer_auth(token)
            .header("Accept", "text/event-stream")
            .send()
            .await
        {
            Ok(response) => response,
            Err(error) => {
                emit_network_state(&app, &task_id, "disconnected", Some(error.to_string()));
                return;
            }
        };
        if !response.status().is_success() {
            emit_network_state(
                &app,
                &task_id,
                "disconnected",
                Some(format!("HTTP {}", response.status().as_u16())),
            );
            return;
        }
        emit_network_state(&app, &task_id, "connected", None);

        let mut bytes = response.bytes_stream();
        let mut carry = String::new();
        while let Some(chunk) = bytes.next().await {
            let chunk = match chunk {
                Ok(value) => value,
                Err(error) => {
                    emit_network_state(&app, &task_id, "disconnected", Some(error.to_string()));
                    return;
                }
            };
            carry.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(end) = carry.find("\n\n") {
                let frame = carry[..end].replace("\r\n", "\n");
                carry.drain(..end + 2);
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() {
                    continue;
                }
                let event = serde_json::from_str(&data).unwrap_or_else(|_| {
                    serde_json::json!({
                        "type": "unknown", "_raw": data,
                    })
                });
                let _ = app.emit(
                    "network-event-stream",
                    NetworkEventPayload::Event {
                        stream_id: task_id.clone(),
                        event,
                    },
                );
            }
        }
        emit_network_state(
            &app,
            &task_id,
            "disconnected",
            Some("server closed stream".into()),
        );
    });
    NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .insert(stream_id, handle);
    Ok(())
}

#[tauri::command]
fn stop_network_event_stream(stream_id: String) -> Result<(), String> {
    if let Some(handle) = NETWORK_EVENT_TASKS
        .lock()
        .map_err(|_| "stream registry poisoned")?
        .remove(&stream_id)
    {
        handle.abort();
    }
    Ok(())
}

fn session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(SESSION_SERVICE, SESSION_ACCOUNT).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_session(session_json: String) -> Result<(), String> {
    session_entry()?
        .set_password(&session_json)
        .map_err(|error| error.to_string())
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

        entry
            .set_password(value)
            .expect("write native credential store");
        assert_eq!(
            entry.get_password().expect("read native credential store"),
            value
        );
        entry
            .delete_credential()
            .expect("delete native credential store fixture");
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
            start_network_event_stream,
            stop_network_event_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
