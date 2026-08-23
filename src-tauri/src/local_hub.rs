use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{LazyLock, Mutex},
    thread,
    time::Duration,
};

use super::{
    app_root, mark_desktop_profile_requires_reauth, output_for, profile_data_path, profile_entry,
    read_profile_index, remove_desktop_profile_unlocked, save_desktop_profile_unlocked,
    switch_desktop_profile, write_private_atomic, ProfileSessionInput, ProfileSessionOutput,
    SESSION_SERVICE,
};

pub(super) const LOCAL_PROFILE_ID: &str = "local-workspace";
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

#[derive(Deserialize, Serialize)]
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
    requires_migration: bool,
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalHubBackupResult {
    path: String,
    restarted: bool,
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

fn process_is_alive(pid: u32) -> bool {
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(pid as i32, 0) };
        return result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM);
    }
    #[cfg(windows)]
    {
        let filter = format!("PID eq {pid}");
        return Command::new("tasklist")
            .args(["/FI", filter.as_str(), "/FO", "CSV", "/NH"])
            .output()
            .map(|output| String::from_utf8_lossy(&output.stdout).contains(&format!("\"{pid}\"")))
            .unwrap_or(false);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = pid;
        false
    }
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

fn copy_dir_recursive(source: &Path, destination: &Path) -> Result<(), String> {
    super::ensure_private_dir(destination)?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let kind = entry.file_type().map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if kind.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else if kind.is_file() {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn backup_local_hub_stopped() -> Result<PathBuf, String> {
    let source = local_root()?;
    if !source.exists() {
        return Err("local Hub has no data to back up".into());
    }
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let destination = app_root()?
        .join("backups")
        .join(format!("local-hub-{timestamp}"));
    if destination.exists() {
        return Err("local Hub backup destination already exists; retry in one second".into());
    }
    copy_dir_recursive(&source, &destination)?;
    Ok(destination)
}

fn safe_version_fragment(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '.' | '-') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

fn snapshot_data_for_migration(
    data_dir: &Path,
    backups_dir: &Path,
    from_version: &str,
    to_version: &str,
) -> Result<PathBuf, String> {
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let snapshot = backups_dir.join(format!(
        "local-hub-migration-{}-to-{}-{timestamp}",
        safe_version_fragment(from_version),
        safe_version_fragment(to_version)
    ));
    if snapshot.exists() {
        return Err("local Hub migration snapshot already exists; retry in one second".into());
    }
    copy_dir_recursive(data_dir, &snapshot.join("data"))?;
    Ok(snapshot)
}

fn restore_migration_snapshot(snapshot: &Path, data_dir: &Path) -> Result<(), String> {
    let saved_data = snapshot.join("data");
    if !saved_data.is_dir() {
        return Err("local Hub migration snapshot is incomplete".into());
    }
    if data_dir.exists() {
        fs::remove_dir_all(data_dir).map_err(|error| error.to_string())?;
    }
    copy_dir_recursive(&saved_data, data_dir)
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
    if database_existed {
        if let Some(session) = existing_local_session()? {
            if session.server_url == endpoint {
                return Ok(session);
            }
            // A saved port can become occupied between launches. Preserve the
            // immutable profile and native token, but route it to the actual
            // loopback endpoint selected for this process.
            let input = ProfileSessionInput {
                profile_id: Some(session.profile_id),
                server_url: endpoint.into(),
                token: session.token,
                network_id: session.network_id,
                username: Some(session.username),
                display_name: session.display_name,
            };
            let raw = save_desktop_profile_unlocked(
                serde_json::to_string(&input).map_err(|error| error.to_string())?,
            )?;
            return serde_json::from_str(&raw).map_err(|error| error.to_string());
        }
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
        logs_path: local_root()
            .map(|root| root.join("logs").display().to_string())
            .unwrap_or_default(),
        requires_migration: false,
    }
}

fn terminate_child(child: &mut Child, lock_path: &Path) {
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(lock_path);
}

fn stop_child_gracefully(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let result = unsafe { libc::kill(child.id() as i32, libc::SIGTERM) };
        if result == 0 {
            for _ in 0..40 {
                if child
                    .try_wait()
                    .map_err(|error| error.to_string())?
                    .is_some()
                {
                    return Ok(());
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    }
    child.kill().map_err(|error| error.to_string())?;
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
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
                let Some(managed) = guard.as_mut() else {
                    return;
                };
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
    let backups_dir = root
        .parent()
        .ok_or_else(|| "local Hub app root is unavailable".to_string())?
        .join("backups");
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
                requires_migration: false,
            };
            return serde_json::to_string(&result).map_err(|error| error.to_string());
        }
        let owner_pid = fs::read_to_string(&lock_path)
            .ok()
            .and_then(|value| value.trim().parse::<u32>().ok());
        if owner_pid.is_some_and(process_is_alive) {
            return Err("an existing local Hub process owns the data but is not healthy; refusing to start a duplicate. Open local Hub logs or restart the owning app".into());
        }
        if owner_pid.is_none() {
            return Err("local Hub ownership lock is invalid; refusing unsafe automatic recovery. Use diagnostics to inspect ~/.anet/app/local-hub/supervisor.lock".into());
        }
        fs::remove_file(&lock_path)
            .map_err(|error| format!("cannot recover stale local Hub lock: {error}"))?;
    }
    let mut lock = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("cannot acquire local Hub ownership: {error}"))?;
    // Write a live owner immediately. If the desktop crashes before the
    // sidecar is spawned, the next launch can safely identify this as a stale
    // lock instead of getting stuck behind an empty/invalid file.
    writeln!(lock, "{}", std::process::id()).map_err(|error| {
        let _ = fs::remove_file(&lock_path);
        error.to_string()
    })?;
    lock.flush().map_err(|error| {
        let _ = fs::remove_file(&lock_path);
        error.to_string()
    })?;

    let executable = sidecar_path()?;
    if !executable.is_file() {
        let _ = fs::remove_file(&lock_path);
        return Err(format!(
            "bundled local Hub is missing: {}",
            executable.display()
        ));
    }
    let migration_snapshot = match saved
        .as_ref()
        .filter(|config| database_existed && config.hub_version != EXPECTED_HUB_VERSION)
    {
        Some(config) => match snapshot_data_for_migration(
            &data_dir,
            &backups_dir,
            &config.hub_version,
            EXPECTED_HUB_VERSION,
        ) {
            Ok(snapshot) => Some(snapshot),
            Err(error) => {
                let _ = fs::remove_file(&lock_path);
                return Err(error);
            }
        },
        None => None,
    };
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
    if let Err(error) = lock
        .set_len(0)
        .and_then(|_| lock.seek(SeekFrom::Start(0)).map(|_| ()))
        .and_then(|_| writeln!(lock, "{}", child.id()))
        .and_then(|_| lock.flush())
    {
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
            if let Some(snapshot) = migration_snapshot.as_deref() {
                restore_migration_snapshot(snapshot, &data_dir)?;
                if let Some(previous) = saved.as_ref() {
                    save_config(previous)?;
                }
            }
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
        if let Some(snapshot) = migration_snapshot.as_deref() {
            restore_migration_snapshot(snapshot, &data_dir)?;
        }
        return Err(error);
    }
    let session = match bootstrap(&endpoint, database_existed) {
        Ok(session) => session,
        Err(error) => {
            terminate_child(&mut child, &lock_path);
            if let Some(snapshot) = migration_snapshot.as_deref() {
                restore_migration_snapshot(snapshot, &data_dir)?;
                if let Some(previous) = saved.as_ref() {
                    save_config(previous)?;
                }
            }
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
                hub_version: config.hub_version.clone(),
                pid: None,
                session: None,
                error: Some(format!("local Hub exited with {status}")),
                logs_path: local_root()?.join("logs").display().to_string(),
                requires_migration: config.hub_version != EXPECTED_HUB_VERSION,
            },
        },
        (_, Some(config)) => LocalHubResult {
            state: "stopped".into(),
            endpoint: config.endpoint,
            port: config.port,
            hub_version: config.hub_version.clone(),
            pid: None,
            session: None,
            error: None,
            logs_path: local_root()?.join("logs").display().to_string(),
            requires_migration: config.hub_version != EXPECTED_HUB_VERSION,
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
            requires_migration: false,
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
            stop_child_gracefully(&mut managed.child)?;
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

/// Headless acceptance path for the exact packaged desktop executable.
/// It is intentionally gated by both a private flag (handled in main.rs) and
/// an environment marker so an ordinary user cannot trigger it accidentally.
/// Tokens/passwords are compared in memory and never printed.
pub fn packaged_smoke() -> Result<(), String> {
    if std::env::var("ANET_PACKAGED_SMOKE").as_deref() != Ok("1") {
        return Err("packaged smoke requires ANET_PACKAGED_SMOKE=1".into());
    }
    let run = || -> Result<(), String> {
        let preferred_port_guard = TcpListener::bind(("127.0.0.1", PREFERRED_PORT))
            .map_err(|error| format!("cannot reserve preferred smoke port: {error}"))?;
        let first_raw = start_local_hub()?;
        let first: serde_json::Value =
            serde_json::from_str(&first_raw).map_err(|error| error.to_string())?;
        let endpoint = first["endpoint"]
            .as_str()
            .ok_or_else(|| "first start omitted endpoint".to_string())?;
        let first_session = first["session"]
            .as_object()
            .ok_or_else(|| "first start omitted session".to_string())?;
        let token = first_session
            .get("token")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "first start omitted token".to_string())?;
        let profile_id = first_session
            .get("profileId")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "first start omitted profile id".to_string())?;
        if profile_id != LOCAL_PROFILE_ID
            || !endpoint.starts_with("http://127.0.0.1:")
            || first["port"].as_u64() == Some(PREFERRED_PORT.into())
        {
            return Err("local identity or loopback endpoint contract mismatch".into());
        }
        drop(preferred_port_guard);
        let client = reqwest::blocking::Client::new();
        for route in ["/api/auth/me", "/api/status"] {
            let response = client
                .get(format!("{endpoint}{route}"))
                .bearer_auth(token)
                .send()
                .map_err(|error| error.to_string())?;
            if !response.status().is_success() {
                return Err(format!(
                    "public API smoke {route} returned {}",
                    response.status()
                ));
            }
        }
        let network_id = first_session
            .get("networkId")
            .and_then(|value| value.as_str())
            .ok_or_else(|| "first start omitted network id".to_string())?;
        let node_token_response = client
            .post(format!("{endpoint}/api/auth/node-token"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "node_name": "packaged-smoke-node",
                "network_id": network_id,
            }))
            .send()
            .map_err(|error| error.to_string())?;
        if !node_token_response.status().is_success() {
            return Err(format!(
                "public token creation returned {}",
                node_token_response.status()
            ));
        }
        let node_token_payload: serde_json::Value = node_token_response
            .json()
            .map_err(|error| error.to_string())?;
        let node_token = node_token_payload["token"]
            .as_str()
            .ok_or_else(|| "public token creation omitted token".to_string())?;
        let report = client
            .post(format!("{endpoint}/mcp"))
            .bearer_auth(node_token)
            .header("Accept", "application/json, text/event-stream")
            .header("MCP-Protocol-Version", "2025-03-26")
            .json(&serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "report_status",
                    "arguments": {
                        "resume_id": "packaged-smoke-resume",
                        "alias": "packaged-smoke-node",
                        "status": "idle",
                        "agent": "desktop-packaged-smoke",
                        "network_id": network_id,
                    }
                }
            }))
            .send()
            .map_err(|error| error.to_string())?;
        let report_status = report.status();
        let report_body = report.text().map_err(|error| error.to_string())?;
        if !report_status.is_success()
            || report_body.contains("network_token_required")
            || report_body.contains("\"isError\":true")
        {
            return Err(format!("public report_status returned {report_status}"));
        }
        let status: serde_json::Value = client
            .get(format!("{endpoint}/api/status"))
            .bearer_auth(token)
            .send()
            .map_err(|error| error.to_string())?
            .json()
            .map_err(|error| error.to_string())?;
        let node_visible = status["sessions"].as_array().is_some_and(|sessions| {
            sessions
                .iter()
                .any(|item| item["alias"] == "packaged-smoke-node")
        });
        if !node_visible {
            return Err("reported node is missing from public status API".into());
        }
        let dispatched = client
            .post(format!("{endpoint}/api/task"))
            .bearer_auth(token)
            .json(&serde_json::json!({
                "alias": "packaged-smoke-node",
                "task": "packaged local workspace task",
                "priority": "normal",
                "network_id": network_id,
                "from": "local-admin",
            }))
            .send()
            .map_err(|error| error.to_string())?;
        if !dispatched.status().is_success() {
            return Err(format!(
                "public task dispatch returned {}",
                dispatched.status()
            ));
        }
        let tasks: serde_json::Value = client
            .get(format!("{endpoint}/api/tasks?network_id={network_id}"))
            .bearer_auth(token)
            .send()
            .map_err(|error| error.to_string())?
            .json()
            .map_err(|error| error.to_string())?;
        let task_visible = tasks["tasks"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["to_name"] == "packaged-smoke-node"
                    && item["content"] == "packaged local workspace task"
            })
        });
        if !task_visible {
            return Err("dispatched task is missing from public tasks API".into());
        }
        stop_local_hub_inner()?;

        let second_raw = start_local_hub()?;
        let second: serde_json::Value =
            serde_json::from_str(&second_raw).map_err(|error| error.to_string())?;
        let second_session = second["session"]
            .as_object()
            .ok_or_else(|| "restart omitted session".to_string())?;
        if second["endpoint"].as_str() != Some(endpoint)
            || second_session
                .get("profileId")
                .and_then(|value| value.as_str())
                != Some(profile_id)
            || second_session.get("token").and_then(|value| value.as_str()) != Some(token)
        {
            return Err("restart did not preserve endpoint/profile/credential".into());
        }
        if !local_root()?.join("data").join("commhub.db").is_file() {
            return Err("restart persistence database is missing".into());
        }
        Ok(())
    };
    let result = run();
    let stopped = stop_local_hub_inner();
    result.and(stopped)
}

/// Upgrade acceptance using a database produced by the previous published
/// CommHub. The workflow seeds that database with public APIs, while this exact
/// packaged executable owns the native credential and migration/backup path.
pub fn packaged_migration_smoke() -> Result<(), String> {
    if std::env::var("ANET_PACKAGED_SMOKE").as_deref() != Ok("1") {
        return Err("packaged migration smoke requires ANET_PACKAGED_SMOKE=1".into());
    }
    let password_file = PathBuf::from(
        std::env::var("ANET_PREVIOUS_HUB_PASSWORD_FILE")
            .map_err(|_| "previous Hub password file is missing".to_string())?,
    );
    let password = fs::read_to_string(&password_file)
        .map_err(|error| format!("cannot read previous Hub credential: {error}"))?;
    fs::remove_file(&password_file)
        .map_err(|error| format!("cannot remove previous Hub credential file: {error}"))?;
    let password_entry = keyring::Entry::new(SESSION_SERVICE, LOCAL_PASSWORD_ACCOUNT)
        .map_err(|error| error.to_string())?;
    password_entry
        .set_password(password.trim())
        .map_err(|error| error.to_string())?;

    let run = || -> Result<(), String> {
        let started: LocalHubResult =
            serde_json::from_str(&start_local_hub()?).map_err(|error| error.to_string())?;
        if started.hub_version != EXPECTED_HUB_VERSION
            || started
                .session
                .as_ref()
                .map(|session| session.username.as_str())
                != Some(LOCAL_USERNAME)
        {
            return Err("previous Hub identity/version did not survive migration".into());
        }
        let session = started
            .session
            .ok_or_else(|| "migration start omitted session".to_string())?;
        let client = reqwest::blocking::Client::new();
        let status: serde_json::Value = client
            .get(format!("{}/api/status", session.server_url))
            .bearer_auth(&session.token)
            .send()
            .map_err(|error| error.to_string())?
            .json()
            .map_err(|error| error.to_string())?;
        if !status["sessions"].as_array().is_some_and(|sessions| {
            sessions
                .iter()
                .any(|item| item["alias"] == "previous-version-node")
        }) {
            return Err("previous-version node is missing after migration".into());
        }
        let tasks: serde_json::Value = client
            .get(format!(
                "{}/api/tasks?network_id={}",
                session.server_url,
                session.network_id.as_deref().unwrap_or_default()
            ))
            .bearer_auth(&session.token)
            .send()
            .map_err(|error| error.to_string())?
            .json()
            .map_err(|error| error.to_string())?;
        if !tasks["tasks"].as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item["to_name"] == "previous-version-node"
                    && item["content"] == "previous-version-task"
            })
        }) {
            return Err("previous-version task is missing after migration".into());
        }
        let config = read_config()?.ok_or_else(|| "migration omitted config".to_string())?;
        if config.hub_version != EXPECTED_HUB_VERSION {
            return Err("migration did not persist the current Hub version".into());
        }
        let prefix = format!(
            "local-hub-migration-{}-to-{}-",
            safe_version_fragment("0.9.0-preview.28"),
            safe_version_fragment(EXPECTED_HUB_VERSION)
        );
        let backups = app_root()?.join("backups");
        let snapshot_found = fs::read_dir(&backups)
            .map_err(|error| error.to_string())?
            .filter_map(Result::ok)
            .any(|entry| {
                entry.file_name().to_string_lossy().starts_with(&prefix)
                    && entry.path().join("data").join("commhub.db").is_file()
            });
        if !snapshot_found {
            return Err("migration backup snapshot is missing".into());
        }
        Ok(())
    };
    let result = run();
    let stopped = stop_local_hub_inner();
    let credential_removed = password_entry
        .delete_credential()
        .or_else(|error| match error {
            keyring::Error::NoEntry => Ok(()),
            other => Err(other),
        })
        .map_err(|error| error.to_string());
    result.and(stopped).and(credential_removed)
}

fn start_isolated_smoke_hub(root: &Path, port: u16) -> Result<Child, String> {
    super::ensure_private_dir(root)?;
    let log = open_log(&root.join("commhub.log"))?;
    let stderr = log.try_clone().map_err(|error| error.to_string())?;
    let mut child = Command::new(sidecar_path()?)
        .current_dir(root)
        .env("HOST", "127.0.0.1")
        .env("PORT", port.to_string())
        .env("COMMHUB_DB", root.join("commhub.db"))
        .env("COMMHUB_UPLOADS_DIR", root.join("uploads"))
        .env_remove("COMMHUB_DEV_OPEN")
        .env_remove("COMMHUB_AUTH_TOKEN")
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(stderr))
        .spawn()
        .map_err(|error| format!("cannot start isolated smoke Hub: {error}"))?;
    if let Err(error) = wait_ready(&endpoint(port)).and_then(|payload| validate_health(&payload)) {
        let _ = child.kill();
        let _ = child.wait();
        return Err(error);
    }
    Ok(child)
}

fn register_smoke_profile(
    endpoint: &str,
    profile_id: &str,
    display_name: &str,
) -> Result<ProfileSessionOutput, String> {
    let response = reqwest::blocking::Client::new()
        .post(format!("{endpoint}/api/auth/register"))
        .json(&serde_json::json!({
            "username": "operator",
            "password": random_password(),
            "display_name": display_name,
        }))
        .send()
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let payload: BootstrapPayload = response.json().map_err(|error| error.to_string())?;
    if !status.is_success() || !payload.ok {
        return Err(payload
            .error
            .unwrap_or_else(|| format!("Hub B registration returned {status}")));
    }
    let input = ProfileSessionInput {
        profile_id: Some(profile_id.into()),
        server_url: endpoint.into(),
        token: payload
            .token
            .ok_or_else(|| "Hub B registration omitted token".to_string())?,
        network_id: payload.network_id,
        username: Some("operator".into()),
        display_name: Some(display_name.into()),
    };
    let raw = save_desktop_profile_unlocked(
        serde_json::to_string(&input).map_err(|error| error.to_string())?,
    )?;
    serde_json::from_str(&raw).map_err(|error| error.to_string())
}

fn assert_authenticated(endpoint: &str, token: &str) -> Result<(), String> {
    let response = reqwest::blocking::Client::new()
        .get(format!("{endpoint}/api/auth/me"))
        .bearer_auth(token)
        .send()
        .map_err(|error| error.to_string())?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "profile authentication returned {}",
            response.status()
        ))
    }
}

pub fn packaged_multihub_cold_start_verify() -> Result<(), String> {
    if std::env::var("ANET_PACKAGED_SMOKE").as_deref() != Ok("1") {
        return Err(
            "packaged multi-Hub cold-start verification requires ANET_PACKAGED_SMOKE=1".into(),
        );
    }
    let index = read_profile_index()?;
    let profile_a = index
        .profiles
        .iter()
        .find(|profile| profile.profile_id == LOCAL_PROFILE_ID)
        .ok_or_else(|| "cold-start child omitted Hub A".to_string())?;
    let profile_b = index
        .profiles
        .iter()
        .find(|profile| profile.profile_id == "smoke-remote-b")
        .ok_or_else(|| "cold-start child omitted Hub B".to_string())?;
    let profile_c = index
        .profiles
        .iter()
        .find(|profile| profile.profile_id == "smoke-remote-c")
        .ok_or_else(|| "cold-start child omitted Hub C".to_string())?;
    for profile in [profile_a, profile_b, profile_c] {
        let session = output_for(profile)?;
        assert_authenticated(&session.server_url, &session.token)?;
        let windows = fs::read_to_string(profile_data_path(&profile.profile_id, "windows.json")?)
            .map_err(|error| error.to_string())?;
        if !windows.contains("worker") {
            return Err("cold-start child lost detached worker window".into());
        }
    }
    if !profile_data_path(LOCAL_PROFILE_ID, "outbox.json")?.is_file()
        || profile_data_path("smoke-remote-b", "outbox.json")?.exists()
        || profile_data_path("smoke-remote-c", "outbox.json")?.exists()
    {
        return Err("cold-start child crossed profile outboxes".into());
    }
    Ok(())
}

/// Exact packaged-executable acceptance for #66/#67. This uses three secured
/// bundled CommHub processes and the platform credential backend. It never
/// prints passwords or tokens and is gated by the same private CI marker as
/// the local-Hub smoke.
pub fn packaged_multihub_smoke() -> Result<(), String> {
    if std::env::var("ANET_PACKAGED_SMOKE").as_deref() != Ok("1") {
        return Err("packaged multi-Hub smoke requires ANET_PACKAGED_SMOKE=1".into());
    }
    const PROFILE_B: &str = "smoke-remote-b";
    const PROFILE_C: &str = "smoke-remote-c";
    let second_root = app_root()?.join("smoke-hub-b");
    let third_root = app_root()?.join("smoke-hub-c");
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let second_port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    drop(listener);
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|error| error.to_string())?;
    let third_port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    drop(listener);

    let mut second: Option<Child> = None;
    let mut third: Option<Child> = None;
    let mut run = || -> Result<(), String> {
        let first_raw = start_local_hub()?;
        let first: LocalHubResult =
            serde_json::from_str(&first_raw).map_err(|error| error.to_string())?;
        let profile_a = first
            .session
            .ok_or_else(|| "Hub A omitted session".to_string())?;
        let endpoint_a = first.endpoint;

        let child = start_isolated_smoke_hub(&second_root, second_port)?;
        second = Some(child);
        let endpoint_b = endpoint(second_port);
        let profile_b = register_smoke_profile(&endpoint_b, PROFILE_B, "Smoke Hub B")?;
        third = Some(start_isolated_smoke_hub(&third_root, third_port)?);
        let endpoint_c = endpoint(third_port);
        let profile_c = register_smoke_profile(&endpoint_c, PROFILE_C, "Smoke Hub C")?;

        let index = read_profile_index()?;
        if index.profiles.len() != 3
            || !index
                .profiles
                .iter()
                .any(|p| p.profile_id == LOCAL_PROFILE_ID)
            || !index.profiles.iter().any(|p| p.profile_id == PROFILE_B)
            || !index.profiles.iter().any(|p| p.profile_id == PROFILE_C)
        {
            return Err("cold-start registry did not retain all three profiles".into());
        }
        for expected in [&profile_a, &profile_b, &profile_c, &profile_a] {
            let actual_raw = switch_desktop_profile(expected.profile_id.clone())?;
            let actual: ProfileSessionOutput =
                serde_json::from_str(&actual_raw).map_err(|error| error.to_string())?;
            if actual.server_url != expected.server_url || actual.token != expected.token {
                return Err("A -> B -> C -> A switch crossed profile credentials".into());
            }
            assert_authenticated(&actual.server_url, &actual.token)?;
        }

        write_private_atomic(
            &profile_data_path(LOCAL_PROFILE_ID, "outbox.json")?,
            br#"[{"id":"offline-a","alias":"worker","content":"A only","createdAt":1,"state":"failed"}]"#,
        )?;
        for profile_id in [LOCAL_PROFILE_ID, PROFILE_B, PROFILE_C] {
            write_private_atomic(
                &profile_data_path(profile_id, "windows.json")?,
                br#"[{"alias":"worker"}]"#,
            )?;
        }
        if profile_data_path(PROFILE_B, "outbox.json")?.exists()
            || profile_data_path(PROFILE_C, "outbox.json")?.exists()
            || !profile_data_path(LOCAL_PROFILE_ID, "outbox.json")?.is_file()
            || !profile_data_path(LOCAL_PROFILE_ID, "windows.json")?.is_file()
            || !profile_data_path(PROFILE_B, "windows.json")?.is_file()
            || !profile_data_path(PROFILE_C, "windows.json")?.is_file()
        {
            return Err("profile-scoped outbox/window isolation failed".into());
        }

        let cold_start = Command::new(std::env::current_exe().map_err(|error| error.to_string())?)
            .arg("--smoke-multihub-verify")
            .status()
            .map_err(|error| format!("cannot launch cold-start verifier: {error}"))?;
        if !cold_start.success() {
            return Err("fresh packaged process failed the three-Hub cold-start matrix".into());
        }

        stop_local_hub_inner()?;
        if let Some(child) = second.as_mut() {
            stop_child_gracefully(child)?;
        }
        if let Some(child) = third.as_mut() {
            stop_child_gracefully(child)?;
        }
        second = Some(start_isolated_smoke_hub(&second_root, second_port)?);
        third = Some(start_isolated_smoke_hub(&third_root, third_port)?);
        let restarted_a: serde_json::Value =
            serde_json::from_str(&start_local_hub()?).map_err(|error| error.to_string())?;
        if restarted_a["session"]["token"].as_str() != Some(profile_a.token.as_str()) {
            return Err("Hub A credential did not survive cold start".into());
        }
        assert_authenticated(&endpoint_a, &profile_a.token)?;
        assert_authenticated(&endpoint_b, &profile_b.token)?;
        assert_authenticated(&endpoint_c, &profile_c.token)?;

        let client = reqwest::blocking::Client::new();
        let tokens: serde_json::Value = client
            .get(format!("{endpoint_b}/api/auth/tokens"))
            .bearer_auth(&profile_b.token)
            .send()
            .map_err(|error| error.to_string())?
            .json()
            .map_err(|error| error.to_string())?;
        let token_id = tokens["tokens"]
            .as_array()
            .and_then(|items| {
                items
                    .iter()
                    .find(|item| item["name"].as_str() == Some("user-login"))
            })
            .and_then(|item| item["token_id"].as_str())
            .ok_or_else(|| "Hub B user token id missing".to_string())?;
        let revoked = client
            .delete(format!("{endpoint_b}/api/auth/tokens/{token_id}"))
            .bearer_auth(&profile_b.token)
            .send()
            .map_err(|error| error.to_string())?;
        if !revoked.status().is_success() {
            return Err(format!("Hub B token revoke returned {}", revoked.status()));
        }
        let rejected = client
            .get(format!("{endpoint_b}/api/auth/me"))
            .bearer_auth(&profile_b.token)
            .send()
            .map_err(|error| error.to_string())?;
        if rejected.status().as_u16() != 401 {
            return Err("revoked Hub B token was not rejected".into());
        }
        mark_desktop_profile_requires_reauth(PROFILE_B.into(), true)?;
        assert_authenticated(&endpoint_a, &profile_a.token)?;
        assert_authenticated(&endpoint_c, &profile_c.token)?;

        remove_desktop_profile_unlocked(PROFILE_B)?;
        let final_index = read_profile_index()?;
        let b_credential_removed = matches!(
            profile_entry(PROFILE_B)?.get_password(),
            Err(keyring::Error::NoEntry)
        );
        let remaining_a = final_index
            .profiles
            .iter()
            .find(|profile| profile.profile_id == LOCAL_PROFILE_ID)
            .ok_or_else(|| "Hub A missing after Hub B removal".to_string())?;
        if final_index.profiles.len() != 2
            || !final_index
                .profiles
                .iter()
                .any(|p| p.profile_id == PROFILE_C)
            || profile_data_path(PROFILE_B, "windows.json")?.exists()
            || !b_credential_removed
            || output_for(remaining_a)?.token != profile_a.token
        {
            return Err("removing Hub B changed or removed Hub A/C".into());
        }
        Ok(())
    };
    let result = run();
    let stopped_a = stop_local_hub_inner();
    if let Some(child) = second.as_mut() {
        let _ = stop_child_gracefully(child);
    }
    if let Some(child) = third.as_mut() {
        let _ = stop_child_gracefully(child);
    }
    result.and(stopped_a)
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
    command
        .arg(path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn backup_local_hub_data() -> Result<String, String> {
    let was_running = LOCAL_HUB
        .lock()
        .map_err(|_| "local Hub supervisor lock poisoned")?
        .is_some();
    if was_running {
        stop_local_hub_inner()?;
    }
    let backup = backup_local_hub_stopped();
    let restart = if was_running {
        start_local_hub().map(|_| true)
    } else {
        Ok(false)
    };
    let path = backup?;
    let restarted = restart?;
    serde_json::to_string(&LocalHubBackupResult {
        path: path.display().to_string(),
        restarted,
    })
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn delete_local_hub_data(confirmation: String) -> Result<String, String> {
    if confirmation != "DELETE LOCAL WORKSPACE" {
        return Err("exact local-data deletion confirmation is required".into());
    }
    stop_local_hub_inner()?;
    let backup = backup_local_hub_stopped()?;
    super::remove_local_profile_data()?;
    let password_entry = keyring::Entry::new(SESSION_SERVICE, LOCAL_PASSWORD_ACCOUNT)
        .map_err(|error| error.to_string())?;
    match password_entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(error) => return Err(error.to_string()),
    }
    let root = local_root()?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|error| error.to_string())?;
    }
    Ok(backup.display().to_string())
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
    fn current_process_is_reported_alive() {
        assert!(process_is_alive(std::process::id()));
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

    #[test]
    fn recursive_backup_preserves_nested_data() {
        let source = tempfile::tempdir().unwrap();
        let destination_root = tempfile::tempdir().unwrap();
        fs::create_dir(source.path().join("uploads")).unwrap();
        fs::write(source.path().join("commhub.db"), b"sqlite-fixture").unwrap();
        fs::write(
            source.path().join("uploads").join("fixture.txt"),
            b"attachment",
        )
        .unwrap();
        let destination = destination_root.path().join("backup");
        copy_dir_recursive(source.path(), &destination).unwrap();
        assert_eq!(
            fs::read(destination.join("commhub.db")).unwrap(),
            b"sqlite-fixture"
        );
        assert_eq!(
            fs::read(destination.join("uploads").join("fixture.txt")).unwrap(),
            b"attachment"
        );
    }

    #[test]
    fn migration_snapshot_restores_previous_data() {
        let source_root = tempfile::tempdir().unwrap();
        let backup_root = tempfile::tempdir().unwrap();
        let data = source_root.path().join("data");
        fs::create_dir(&data).unwrap();
        fs::write(data.join("commhub.db"), b"before-migration").unwrap();
        let snapshot = snapshot_data_for_migration(
            &data,
            backup_root.path(),
            "0.8.0-preview.1",
            EXPECTED_HUB_VERSION,
        )
        .unwrap();
        fs::write(data.join("commhub.db"), b"mutated-by-failed-migration").unwrap();
        fs::write(data.join("new-file"), b"must-disappear").unwrap();
        restore_migration_snapshot(&snapshot, &data).unwrap();
        assert_eq!(
            fs::read(data.join("commhub.db")).unwrap(),
            b"before-migration"
        );
        assert!(!data.join("new-file").exists());
        assert!(snapshot.join("data").join("commhub.db").exists());
    }
}
