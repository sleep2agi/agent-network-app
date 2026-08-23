// Tauri 2 shell (Vincent tg 824: 用 Tauri，替换 Electron).
// The http plugin backs the JS-side fetch patch — WKWebView enforces
// CORS and the hub sets no CORS headers, so requests go through Rust.
const SESSION_SERVICE: &str = "top.vansin.agentnetwork.desktop";
const SESSION_ACCOUNT: &str = "active-hub-session";

#[cfg(windows)]
use atomicwrites::{AllowOverwrite, AtomicFile};
use futures_util::StreamExt;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};
use tauri::Emitter;

static NETWORK_EVENT_TASKS: LazyLock<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static PROFILE_STORE: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

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

#[derive(Clone, serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileMetadata {
    profile_id: String,
    server_url: String,
    username: String,
    network_id: Option<String>,
    display_name: Option<String>,
    #[serde(default)]
    requires_reauth: bool,
    created_at: u64,
    updated_at: u64,
}

#[derive(Default, serde::Deserialize, Serialize)]
struct ProfileIndex {
    schema_version: u32,
    active_profile_id: Option<String>,
    profiles: Vec<ProfileMetadata>,
}

#[derive(serde::Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSessionInput {
    profile_id: Option<String>,
    server_url: String,
    token: String,
    network_id: Option<String>,
    username: Option<String>,
    display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProfileSessionOutput {
    profile_id: String,
    server_url: String,
    token: String,
    network_id: Option<String>,
    username: String,
    display_name: Option<String>,
}

fn app_root() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "home directory unavailable".to_string())?;
    Ok(PathBuf::from(home).join(".anet").join("app"))
}

fn profile_index_path() -> Result<PathBuf, String> {
    Ok(app_root()?.join("profiles").join("index.json"))
}

fn read_profile_index() -> Result<ProfileIndex, String> {
    let path = profile_index_path()?;
    read_profile_index_at(path)
}

fn read_profile_index_at(path: PathBuf) -> Result<ProfileIndex, String> {
    if !path.exists() {
        return Ok(ProfileIndex {
            schema_version: 1,
            ..Default::default()
        });
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    match serde_json::from_str(&raw) {
        Ok(index) => Ok(index),
        Err(_) => {
            // Never overwrite corrupt user state. Quarantine it beside the
            // registry, then recover to an empty versioned index so the app
            // can still open and the user can sign in again.
            let backup = path.with_file_name(format!(
                "index.corrupt-{}-{}.json",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_err(|error| error.to_string())?
                    .as_secs(),
                uuid::Uuid::new_v4()
            ));
            fs::rename(&path, backup).map_err(|error| error.to_string())?;
            Ok(ProfileIndex {
                schema_version: 1,
                ..Default::default()
            })
        }
    }
}

#[derive(Serialize)]
struct StorageDiagnostics {
    root: String,
    schema_version: u32,
    profile_count: usize,
    active_profile_id: Option<String>,
    corrupt_backups: Vec<String>,
}

#[tauri::command]
fn desktop_storage_diagnostics() -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let root = app_root()?;
    let index = read_profile_index()?;
    let profiles_dir = root.join("profiles");
    let mut corrupt_backups = if profiles_dir.exists() {
        fs::read_dir(&profiles_dir)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .filter_map(|entry| entry.file_name().into_string().ok())
            .filter(|name| name.starts_with("index.corrupt-") && name.ends_with(".json"))
            .collect::<Vec<_>>()
    } else {
        Vec::new()
    };
    corrupt_backups.sort();
    serde_json::to_string_pretty(&StorageDiagnostics {
        root: root.display().to_string(),
        schema_version: index.schema_version,
        profile_count: index.profiles.len(),
        active_profile_id: index.active_profile_id,
        corrupt_backups,
    })
    .map_err(|error| error.to_string())
}

fn write_private_atomic(path: &Path, value: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "invalid profile path".to_string())?;
    ensure_private_dir(parent)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let tmp = parent.join(format!(".write-{}.tmp", uuid::Uuid::new_v4()));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|error| error.to_string())?;
        file.write_all(value).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&tmp, path).map_err(|error| error.to_string())?;
    }
    #[cfg(windows)]
    {
        AtomicFile::new(path, AllowOverwrite)
            .write(|file| file.write_all(value))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn ensure_private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn save_profile_index(index: &ProfileIndex) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(index).map_err(|error| error.to_string())?;
    write_private_atomic(&profile_index_path()?, &bytes)?;
    write_private_atomic(
        &app_root()?.join("schema.json"),
        br#"{
  "schema_version": 1,
  "storage": "agent-network-app-profiles"
}
"#,
    )
}

fn profile_entry(profile_id: &str) -> Result<keyring::Entry, String> {
    if profile_id.is_empty()
        || profile_id.len() > 80
        || !profile_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("invalid profile id".into());
    }
    keyring::Entry::new(SESSION_SERVICE, &format!("hub-profile-{profile_id}"))
        .map_err(|error| error.to_string())
}

fn profile_data_path(profile_id: &str, relative_path: &str) -> Result<PathBuf, String> {
    profile_entry(profile_id)?; // reuse strict immutable-id validation
    let relative = Path::new(relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
    {
        return Err("invalid profile data path".into());
    }
    Ok(app_root()?.join("profiles").join(profile_id).join(relative))
}

#[tauri::command]
fn write_desktop_profile_file(
    profile_id: String,
    relative_path: String,
    contents: String,
) -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile store lock poisoned")?;
    write_private_atomic(
        &profile_data_path(&profile_id, &relative_path)?,
        contents.as_bytes(),
    )
}

#[tauri::command]
fn read_desktop_profile_file(
    profile_id: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile store lock poisoned")?;
    let path = profile_data_path(&profile_id, &relative_path)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn output_for(profile: &ProfileMetadata) -> Result<ProfileSessionOutput, String> {
    let token = profile_entry(&profile.profile_id)?
        .get_password()
        .map_err(|error| error.to_string())?;
    Ok(ProfileSessionOutput {
        profile_id: profile.profile_id.clone(),
        server_url: profile.server_url.clone(),
        token,
        network_id: profile.network_id.clone(),
        username: profile.username.clone(),
        display_name: profile.display_name.clone(),
    })
}

fn save_desktop_profile_unlocked(session_json: String) -> Result<String, String> {
    let input: ProfileSessionInput =
        serde_json::from_str(&session_json).map_err(|error| error.to_string())?;
    let profile_id = input
        .profile_id
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let mut index = read_profile_index()?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let created_at = index
        .profiles
        .iter()
        .find(|p| p.profile_id == profile_id)
        .map(|p| p.created_at)
        .unwrap_or(now);
    let profile = ProfileMetadata {
        profile_id: profile_id.clone(),
        server_url: input.server_url.trim_end_matches('/').to_owned(),
        username: input.username.unwrap_or_default(),
        network_id: input.network_id,
        display_name: input.display_name,
        requires_reauth: false,
        created_at,
        updated_at: now,
    };
    profile_entry(&profile_id)?
        .set_password(&input.token)
        .map_err(|error| error.to_string())?;
    ensure_private_dir(&app_root()?.join("profiles").join(&profile_id))?;
    index.profiles.retain(|p| p.profile_id != profile_id);
    index.profiles.push(profile.clone());
    index.active_profile_id = Some(profile_id);
    index.schema_version = 1;
    save_profile_index(&index)?;
    serde_json::to_string(&output_for(&profile)?).map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_profile(session_json: String) -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    save_desktop_profile_unlocked(session_json)
}

#[tauri::command]
fn list_desktop_profiles() -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    serde_json::to_string(&read_profile_index()?).map_err(|error| error.to_string())
}

#[tauri::command]
fn switch_desktop_profile(profile_id: String) -> Result<String, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    let profile = index
        .profiles
        .iter()
        .find(|p| p.profile_id == profile_id)
        .cloned()
        .ok_or_else(|| "profile not found".to_string())?;
    let output = output_for(&profile)?;
    index.active_profile_id = Some(profile_id);
    save_profile_index(&index)?;
    serde_json::to_string(&output).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_desktop_profile(profile_id: String) -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    if !index.profiles.iter().any(|p| p.profile_id == profile_id) {
        return Ok(());
    }
    match profile_entry(&profile_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(error.to_string()),
    }
    index.profiles.retain(|p| p.profile_id != profile_id);
    if index.active_profile_id.as_deref() == Some(&profile_id) {
        index.active_profile_id = index.profiles.first().map(|p| p.profile_id.clone());
    }
    let profile_dir = app_root()?.join("profiles").join(&profile_id);
    if profile_dir.exists() {
        fs::remove_dir_all(profile_dir).map_err(|error| error.to_string())?;
    }
    save_profile_index(&index)
}

#[tauri::command]
fn mark_desktop_profile_requires_reauth(profile_id: String, required: bool) -> Result<(), String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    set_profile_requires_reauth(&mut index, &profile_id, required)?;
    save_profile_index(&index)
}

fn set_profile_requires_reauth(
    index: &mut ProfileIndex,
    profile_id: &str,
    required: bool,
) -> Result<(), String> {
    let profile = index
        .profiles
        .iter_mut()
        .find(|profile| profile.profile_id == profile_id)
        .ok_or_else(|| "profile not found".to_string())?;
    profile.requires_reauth = required;
    Ok(())
}

#[tauri::command]
fn load_active_desktop_profile() -> Result<Option<String>, String> {
    let _guard = PROFILE_STORE
        .lock()
        .map_err(|_| "profile registry lock poisoned")?;
    let mut index = read_profile_index()?;
    if let Some(id) = index.active_profile_id.clone() {
        if let Some(profile) = index.profiles.iter().find(|p| p.profile_id == id) {
            return serde_json::to_string(&output_for(profile)?)
                .map(Some)
                .map_err(|error| error.to_string());
        }
    }
    // One-time migration from v0.2.11+ single-session credential. The old
    // entry is deleted only after the new profile credential + index commit.
    let legacy = match session_entry()?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let mut input: ProfileSessionInput =
        serde_json::from_str(&legacy).map_err(|error| error.to_string())?;
    input.profile_id = None;
    let saved = save_desktop_profile_unlocked(
        serde_json::to_string(&input).map_err(|error| error.to_string())?,
    )?;
    index = read_profile_index()?;
    if index.active_profile_id.is_some() {
        let _ = session_entry()?.delete_credential();
    }
    Ok(Some(saved))
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

    #[test]
    fn profile_registry_metadata_never_serializes_secrets() {
        let profile = ProfileMetadata {
            profile_id: "91f0f5df-0eef-486a-b302-1a15f501a1cf".into(),
            server_url: "https://hub.example".into(),
            username: "admin".into(),
            network_id: Some("net_test".into()),
            display_name: None,
            requires_reauth: false,
            created_at: 1,
            updated_at: 2,
        };
        let json = serde_json::to_string(&ProfileIndex {
            schema_version: 1,
            active_profile_id: Some(profile.profile_id.clone()),
            profiles: vec![profile],
        })
        .expect("serialize registry");
        assert!(!json.contains("token"));
        assert!(!json.contains("password"));
        assert!(json.contains("profileId"));
    }

    #[test]
    fn corrupt_profile_registry_is_quarantined_without_data_loss() {
        let fixture = std::env::temp_dir().join(format!(
            "agent-network-profile-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&fixture).expect("create recovery fixture");
        let index_path = fixture.join("index.json");
        let corrupt_bytes = b"{not-valid-json";
        fs::write(&index_path, corrupt_bytes).expect("write corrupt registry");

        let recovered = read_profile_index_at(index_path.clone()).expect("recover registry");
        assert_eq!(recovered.schema_version, 1);
        assert!(recovered.profiles.is_empty());
        assert!(!index_path.exists());

        let backups = fs::read_dir(&fixture)
            .expect("read recovery fixture")
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert!(backups[0]
            .file_name()
            .to_string_lossy()
            .starts_with("index.corrupt-"));
        assert_eq!(
            fs::read(backups[0].path()).expect("read backup"),
            corrupt_bytes
        );

        fs::remove_dir_all(fixture).expect("remove recovery fixture");
    }

    #[test]
    fn revoked_profile_marker_is_isolated() {
        let make_profile = |profile_id: &str| ProfileMetadata {
            profile_id: profile_id.into(),
            server_url: format!("https://{profile_id}.example"),
            username: "admin".into(),
            network_id: None,
            display_name: None,
            requires_reauth: false,
            created_at: 1,
            updated_at: 1,
        };
        let mut index = ProfileIndex {
            schema_version: 1,
            active_profile_id: Some("profile-b".into()),
            profiles: vec![make_profile("profile-a"), make_profile("profile-b")],
        };

        set_profile_requires_reauth(&mut index, "profile-b", true).expect("mark profile b");
        assert!(!index.profiles[0].requires_reauth);
        assert!(index.profiles[1].requires_reauth);
        assert_eq!(index.active_profile_id.as_deref(), Some("profile-b"));
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
            save_desktop_profile,
            list_desktop_profiles,
            switch_desktop_profile,
            remove_desktop_profile,
            mark_desktop_profile_requires_reauth,
            load_active_desktop_profile,
            write_desktop_profile_file,
            read_desktop_profile_file,
            desktop_storage_diagnostics,
            start_network_event_stream,
            stop_network_event_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
