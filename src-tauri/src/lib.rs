use std::{env, fs, path::{Component, Path, PathBuf}};

fn app_data_root() -> Result<PathBuf, String> {
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .ok_or_else(|| "home directory is unavailable".to_string())?;
    Ok(PathBuf::from(home).join(".anet").join("app"))
}

fn checked_app_path(relative: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty() || path.is_absolute() || path.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("invalid app-data relative path".into());
    }
    Ok(app_data_root()?.join(path))
}

#[tauri::command]
fn read_app_data(relative: String) -> Result<Option<String>, String> {
    let path = checked_app_path(&relative)?;
    match fs::read_to_string(path) {
        Ok(value) => Ok(Some(value)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_app_data(relative: String, contents: String) -> Result<(), String> {
    let path = checked_app_path(&relative)?;
    let parent = path.parent().ok_or_else(|| "invalid app-data path".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    fs::write(&temp, contents).map_err(|e| e.to_string())?;
    if path.exists() {
        fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    fs::rename(temp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_app_data(relative: String) -> Result<(), String> {
    let path = checked_app_path(&relative)?;
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

// Tauri 2 shell (Vincent tg 824: 用 Tauri，替换 Electron).
// The http plugin backs the JS-side fetch patch — WKWebView enforces
// CORS and the hub sets no CORS headers, so requests go through Rust.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![read_app_data, write_app_data, delete_app_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
