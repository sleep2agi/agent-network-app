use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{LazyLock, Mutex},
    thread,
    time::Duration,
};

use super::{
    app_root, output_for, read_profile_index, save_desktop_profile_unlocked, write_private_atomic,
    ProfileSessionInput, ProfileSessionOutput, SESSION_SERVICE,
};

const LOCAL_PROFILE_ID: &str = "local-workspace";
const LOCAL_USERNAME: &str = "local-admin";
const LOCAL_PASSWORD_ACCOUNT: &str = "local-hub-bootstrap-password";
const PREFERRED_PORT: u16 = 9200;
const LAST_PORT: u16 = 9299;
const EXPECTED_HUB_VERSION: &str = "0.9.0-preview.29";
const MAX_LOG_BYTES: u64 = 2 * 1024 * 1024;

struct ManagedHub {
    child: Child,
    lock_path: PathBuf,
    generation: String,
}

static LOCAL_HUB: LazyLock<Mutex<Option<ManagedHub>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalHubConfig {
    schema_version: u32,
    enabled: bool,
    host: String,
    port: u16,
    endpoint: String,
    hub_version: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalHubResult {
    state: String,
    endpoint: String,
    port: u16,
    hub_version: String,
    pid: Option<u32>,
    session: Option<ProfileSessionOutput>,
    error: Option<String>,
    logs_path: String,
}

#[derive(Deserialize)]
struct HealthPayload {
    ok: bool,
    version: Option<String>,
    api_version: Option<String>,
    security: Option<String>,
}

#[derive(Deserialize)]
struct BootstrapPayload {
    ok: bool,
    error: Option<String>,
    token: Option<String>,
    network_id: Option<String>,
}

fn local_root() -> Result<PathBuf, String> {
    Ok(app_root()?.join("local-hub"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(local_root()?.join("config.json"))
}

fn read_config() -> Result<Option<LocalHubConfig>, String> {
    let path = config_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|error| error.to_string())
}

fn save_config(config: &LocalHubConfig) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(config).map_err(|error| error.to_string())?;
    write_private_atomic(&config_path()?, &bytes)
}

fn sidecar_path() -> Result<PathBuf, String> {
    let parent = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .ok_or_else(|| "desktop executable directory unavailable".to_string())?
        .to_path_buf();
    Ok(parent.join(if cfg!(windows) {
        "commhub.exe"
    } else {
        "commhub"
    }))
}

fn port_is_free(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn select_port(saved: Option<u16>) -> Result<u16, String> {
    if let Some(port) = saved.filter(|port| (PREFERRED_PORT..=LAST_PORT).contains(port)) {
        if port_is_free(port) {
            return Ok(port);
        }
    }
    (PREFERRED_PORT..=LAST_PORT)
        .find(|port| port_is_free(*port))
        .ok_or_else(|| format!("no free loopback port in {PREFERRED_PORT}..={LAST_PORT}"))
}

fn endpoint(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

fn rotate_log(path: &Path) -> Result<(), String> {
    if path.metadata().map(|meta| meta.len()).unwrap_or(0) < MAX_LOG_BYTES {
        return Ok(());
    }
    let previous = path.with_extension("previous.log");
    if previous.exists() {
        fs::remove_file(&previous).map_err(|error| error.to_string())?;
    }
    fs::rename(path, previous).map_err(|error| error.to_string())
}

fn open_log(path: &Path) -> Result<File, String> {
    rotate_log(path)?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())
}

fn health(endpoint: &str) -> Result<HealthPayload, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1))
        .build()
        .map_err(|error| error.to_string())?
        .get(format!("{endpoint}/health"))
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "health returned HTTP {}",
            response.status().as_u16()
        ));
    }
    response.json().map_err(|error| error.to_string())
}

fn wait_ready(endpoint: &str) -> Result<HealthPayload, String> {
    let mut last = "not ready".to_string();
    for _ in 0..40 {
        match health(endpoint) {
            Ok(payload) if payload.ok => return Ok(payload),
            Ok(_) => last = "health response was not ok".into(),
            Err(error) => last = error,
        }
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("local Hub did not become ready: {last}"))
}

fn validate_health(payload: &HealthPayload) -> Result<(), String> {
    if payload.version.as_deref() != Some(EXPECTED_HUB_VERSION) {
        return Err(format!(
            "local Hub version mismatch: expected {EXPECTED_HUB_VERSION}, got {}",
            payload.version.as_deref().unwrap_or("unknown")
        ));
    }
    if payload.api_version.as_deref() != Some("v3")
        || payload.security.as_deref() != Some("secured")
    {
        return Err("local Hub compatibility/security contract mismatch".into());
    }
    Ok(())
}

fn random_password() -> String {
    format!("{}-{}-A9!", uuid::Uuid::new_v4(), uuid::Uuid::new_v4())
}

fn existing_local_session() -> Result<Option<ProfileSessionOutput>, String> {
    let index = read_profile_index()?;
    match index
        .profiles
        .iter()
        .find(|profile| profile.profile_id == LOCAL_PROFILE_ID)
    {
        Some(profile) => output_for(profile).map(Some),
        None => Ok(None),
    }
}

fn bootstrap(endpoint: &str, database_existed: bool) -> Result<ProfileSessionOutput, String> {
    if let Some(session) = existing_local_session()? {
        return Ok(session);
    }
    let password_entry = keyring::Entry::new(SESSION_SERVICE, LOCAL_PASSWORD_ACCOUNT)
        .map_err(|error| error.to_string())?;
    let password = if database_existed {
        password_entry.get_password().map_err(|_| {
            "local Hub data exists but its native credential is missing; use diagnostics or explicit local-data reset".to_string()
        })?
    } else {
        let generated = random_password();
        password_entry
            .set_password(&generated)
            .map_err(|error| error.to_string())?;
        generated
    };
    let body = serde_json::json!({
        "username": LOCAL_USERNAME,
        "password": password,
        "display_name": "Local workspace",
    });
    let route = if database_existed {
        "login"
    } else {
        "register"
    };
    let response = reqwest::blocking::Client::new()
        .post(format!("{endpoint}/api/auth/{route}"))
        .header("Content-Type", "application/json")
        .body(body.to_string())
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let payload: BootstrapPayload = response.json().map_err(|error| error.to_string())?;
    if !status.is_success() || !payload.ok {
        if !database_existed {
            let _ = password_entry.delete_credential();
        }
        return Err(payload
            .error
            .unwrap_or_else(|| format!("bootstrap returned HTTP {}", status.as_u16())));
    }
    let token = payload
        .token
        .ok_or_else(|| "bootstrap response omitted token".to_string())?;
    let input = ProfileSessionInput {
        profile_id: Some(LOCAL_PROFILE_ID.into()),
        server_url: endpoint.into(),
        token,
        network_id: payload.network_id,
        username: Some(LOCAL_USERNAME.into()),
        display_name: Some("Local workspace".into()),
    };
    let raw = save_desktop_profile_unlocked(
        serde_json::to_string(&input).map_err(|error| error.to_string())?,
    )?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn running_result(
    managed: &ManagedHub,
    config: &LocalHubConfig,
    session: Option<ProfileSessionOutput>,
) -> LocalHubResult {
    LocalHubResult {
        state: "running".into(),
        endpoint: config.endpoint.clone(),
        port: config.port,
        hub_version: config.hub_version.clone(),
        pid: Some(managed.child.id()),
        session,
        error: None,
        logs_path: local_root().map(|root| root.join("logs").display().to_string()).unwrap_or_default(),
    }
}

fn terminate_child(child: &mut Child, lock_path: &Path) {
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(lock_path);
}

fn monitor_local_hub(generation: String) {
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(1));
            let exited = {
                let mut guard = match LOCAL_HUB.lock() {
                    Ok(guard) => guard,
                    Err(_) => return,
                };
                let Some(managed) = guard.as_mut() else { return };
                if managed.generation != generation {
                    return;
                }
                match managed.child.try_wait() {
                    Ok(None) => false,
                    Ok(Some(_)) | Err(_) => {
                        let _ = fs::remove_file(&managed.lock_path);
                        *guard = None;
                        true
                    }
                }
            };
            if !exited {
                continue;
            }

            // A crash should not turn into an unbounded hot loop. Retry a
            // finite number of times with capped exponential backoff; the UI
            // can still offer an explicit restart after the final attempt.
            for delay in [1_u64, 2, 4, 8, 16, 30] {
                thread::sleep(Duration::from_secs(delay));
                if start_local_hub().is_ok() {
                    return;
                }
            }
            return;
        }
    });
}

#[tauri::command]
pub fn start_local_hub() -> Result<String, String> {
    let mut guard = LOCAL_HUB
        .lock()
        .map_err(|_| "local Hub supervisor lock poisoned")?;
    if let Some(managed) = guard.as_mut() {
        if managed
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            let config =
                read_config()?.ok_or_else(|| "running local Hub has no config".to_string())?;
            return serde_json::to_string(&running_result(
                managed,
                &config,
                existing_local_session()?,
            ))
            .map_err(|error| error.to_string());
        }
        *guard = None;
    }

    let root = local_root()?;
    let data_dir = root.join("data");
    let logs_dir = root.join("logs");
    super::ensure_private_dir(&data_dir)?;
    super::ensure_private_dir(&logs_dir)?;
    let database = data_dir.join("commhub.db");
    let database_existed = database.exists();
    let saved = read_config()?;
    let port = select_port(saved.as_ref().map(|config| config.port))?;
    let endpoint = endpoint(port);
    let lock_path = root.join("supervisor.lock");
    if lock_path.exists() {
        if let Ok(payload) = wait_ready(
            saved
                .as_ref()
                .map(|config| config.endpoint.as_str())
                .unwrap_or(&endpoint),
        ) {
            validate_health(&payload)?;
            let session = existing_local_session()?;
            let result = LocalHubResult {
                state: "running_external".into(),
                endpoint: saved
                    .as_ref()
                    .map(|config| config.endpoint.clone())
                    .unwrap_or(endpoint),
                port: saved.as_ref().map(|config| config.port).unwrap_or(port),
                hub_version: EXPECTED_HUB_VERSION.into(),
                pid: None,
                session,
                error: None,
                logs_path: logs_dir.display().to_string(),
            };
            return serde_json::to_string(&result).map_err(|error| error.to_string());
        }
        fs::remove_file(&lock_path)
            .map_err(|error| format!("cannot recover stale local Hub lock: {error}"))?;
    }
    let mut lock = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("cannot acquire local Hub ownership: {error}"))?;

    let executable = sidecar_path()?;
    if !executable.is_file() {
        let _ = fs::remove_file(&lock_path);
        return Err(format!(
            "bundled local Hub is missing: {}",
            executable.display()
        ));
    }
    let log_path = logs_dir.join("commhub.log");
    let stdout = open_log(&log_path).map_err(|error| {
        let _ = fs::remove_file(&lock_path);
        error
    })?;
    let stderr = stdout.try_clone().map_err(|error| {
        let _ = fs::remove_file(&lock_path);
        error.to_string()
    })?;
    let mut child = Command::new(executable)
        .current_dir(&data_dir)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("COMMHUB_DB", &database)
        .env("COMMHUB_UPLOADS_DIR", data_dir.join("uploads"))
        .env_remove("COMMHUB_DEV_OPEN")
        .env_remove("COMMHUB_AUTH_TOKEN")
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| {
            let _ = fs::remove_file(&lock_path);
            format!("cannot start bundled local Hub: {error}")
        })?;
    if let Err(error) = writeln!(lock, "{}", child.id()) {
        terminate_child(&mut child, &lock_path);
        return Err(error.to_string());
    }

    let payload = match wait_ready(&endpoint).and_then(|payload| {
        validate_health(&payload)?;
        Ok(payload)
    }) {
        Ok(payload) => payload,
        Err(error) => {
            terminate_child(&mut child, &lock_path);
            return Err(error);
        }
    };
    let config = LocalHubConfig {
        schema_version: 1,
        enabled: true,
        host: "127.0.0.1".into(),
        port,
        endpoint: endpoint.clone(),
        hub_version: payload
            .version
            .unwrap_or_else(|| EXPECTED_HUB_VERSION.into()),
    };
    if let Err(error) = save_config(&config) {
        terminate_child(&mut child, &lock_path);
        return Err(error);
    }
    let session = match bootstrap(&endpoint, database_existed) {
        Ok(session) => session,
        Err(error) => {
            terminate_child(&mut child, &lock_path);
            return Err(error);
        }
    };
    let generation = uuid::Uuid::new_v4().to_string();
    let managed = ManagedHub {
        child,
        lock_path,
        generation: generation.clone(),
    };
    let result = running_result(&managed, &config, Some(session));
    *guard = Some(managed);
    drop(guard);
    monitor_local_hub(generation);
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_hub_status() -> Result<String, String> {
    let mut guard = LOCAL_HUB
        .lock()
        .map_err(|_| "local Hub supervisor lock poisoned")?;
    let config = read_config()?;
    let result = match (guard.as_mut(), config) {
        (Some(managed), Some(config)) => match managed
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
        {
            None => running_result(managed, &config, None),
            Some(status) => LocalHubResult {
                state: "error".into(),
                endpoint: config.endpoint,
                port: config.port,
                hub_version: config.hub_version,
                pid: None,
                session: None,
                    error: Some(format!("local Hub exited with {status}")),
                    logs_path: local_root()?.join("logs").display().to_string(),
            },
        },
        (_, Some(config)) => LocalHubResult {
            state: "stopped".into(),
            endpoint: config.endpoint,
            port: config.port,
            hub_version: config.hub_version,
            pid: None,
            session: None,
            error: None,
            logs_path: local_root()?.join("logs").display().to_string(),
        },
        _ => LocalHubResult {
            state: "not_provisioned".into(),
            endpoint: endpoint(PREFERRED_PORT),
            port: PREFERRED_PORT,
            hub_version: EXPECTED_HUB_VERSION.into(),
            pid: None,
            session: None,
            error: None,
            logs_path: local_root()?.join("logs").display().to_string(),
        },
    };
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

pub fn stop_local_hub_inner() -> Result<(), String> {
    let mut guard = LOCAL_HUB
        .lock()
        .map_err(|_| "local Hub supervisor lock poisoned")?;
    if let Some(mut managed) = guard.take() {
        if managed
            .child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()
        {
            managed.child.kill().map_err(|error| error.to_string())?;
            managed.child.wait().map_err(|error| error.to_string())?;
        }
        if managed.lock_path.exists() {
            fs::remove_file(managed.lock_path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn stop_local_hub() -> Result<(), String> {
    stop_local_hub_inner()
}

#[tauri::command]
pub fn restart_local_hub() -> Result<String, String> {
    stop_local_hub_inner()?;
    start_local_hub()
}

#[tauri::command]
pub fn open_local_hub_logs() -> Result<(), String> {
    let path = local_root()?.join("logs");
    super::ensure_private_dir(&path)?;
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer.exe");
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let mut command = Command::new("xdg-open");
    command.arg(path).spawn().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn is_local_profile(profile_id: &str) -> bool {
    profile_id == LOCAL_PROFILE_ID
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_is_always_loopback() {
        assert_eq!(endpoint(9200), "http://127.0.0.1:9200");
    }

    #[test]
    fn generated_password_is_strong_and_not_a_default() {
        let value = random_password();
        assert!(value.len() > 70);
        assert_ne!(value, "anethub");
        assert!(value.ends_with("-A9!"));
    }

    #[test]
    fn local_profile_identity_is_stable() {
        assert!(is_local_profile("local-workspace"));
        assert!(!is_local_profile("remote-profile"));
    }

    #[test]
    fn port_selection_skips_a_conflict() {
        let occupied = TcpListener::bind(("127.0.0.1", PREFERRED_PORT)).unwrap();
        let selected = select_port(Some(PREFERRED_PORT)).unwrap();
        assert_ne!(selected, PREFERRED_PORT);
        assert!((PREFERRED_PORT..=LAST_PORT).contains(&selected));
        drop(occupied);
    }

    #[test]
    fn oversized_log_is_rotated() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("commhub.log");
        fs::write(&log, vec![b'x'; MAX_LOG_BYTES as usize]).unwrap();
        rotate_log(&log).unwrap();
        assert!(!log.exists());
        assert_eq!(
            fs::metadata(dir.path().join("commhub.previous.log"))
                .unwrap()
                .len(),
            MAX_LOG_BYTES
        );
    }
}
