//! 本机 daemon 一键扫描与安装(Vincent 2026-09-06:「本地的也可以自动启动 local 的 daemon 吧」
//! →「不要自己启动的吧,有个一键扫描和安装按钮」)。
//!
//! 「选服务器」空状态里那句「先在那台机器上跑 anet daemon up」在 Local workspace 场景下说的
//! 就是这台机器。这里把它做成按钮:扫描本机有没有 Node / npm / anet CLI / 已注册的 daemon,
//! 缺 anet 就 `npm install -g`,然后用本地 Hub 的凭据执行 `anet daemon init` + `anet daemon start`,
//! 最后向 Hub 确认 host_supervisor 已注册。**不自己偷偷起**:每一步都由用户点按钮触发。
//!
//! 凭据隔离:`anet daemon init` 从 `$HOME/.anet/config.json` 读 hub/token/network_id 并往
//! `$cwd/.anet/nodes/<name>/config.json` 写 daemon 配置。用户自己的 `~/.anet/config.json`
//! 可能指向别的 Hub,所以 init 这一步用一个私有 HOME(`~/.anet/app/local-daemon/home`),
//! 写好的 daemon 配置里已经带了 hub/token/network_id;`daemon start` 用用户真实 HOME 跑,
//! 它派生出来的节点才看得到用户的 claude/codex 等工具。
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;

use super::{app_root, ensure_private_dir, write_private_atomic};

pub const LOCAL_DAEMON_NAME: &str = "local-daemon";
const ANET_PACKAGE: &str = "@sleep2agi/agent-network@latest";
const NPM_MIRROR: &str = "https://registry.npmmirror.com";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolInfo {
    pub path: String,
    pub version: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonScan {
    pub supported: bool,
    pub reason: Option<String>,
    pub shell: String,
    pub node: Option<ToolInfo>,
    pub npm: Option<ToolInfo>,
    pub anet: Option<ToolInfo>,
    pub daemon_dir: String,
    pub daemon_name: String,
    pub profile_exists: bool,
    pub node_id: Option<String>,
    pub hub_endpoint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepReport {
    pub name: String,
    pub ok: bool,
    pub output: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DaemonInstallReport {
    pub ok: bool,
    pub node_id: Option<String>,
    pub steps: Vec<StepReport>,
    pub error: Option<String>,
}

/// 本地 Hub 的会话(endpoint / utok / network_id),由 local_hub 提供。
pub struct LocalHubSession {
    pub endpoint: String,
    pub token: String,
    pub network_id: Option<String>,
}

fn daemon_root() -> Result<PathBuf, String> {
    Ok(app_root()?.join("local-daemon"))
}

fn isolated_home() -> Result<PathBuf, String> {
    Ok(daemon_root()?.join("home"))
}

fn daemon_profile_path(name: &str) -> Result<PathBuf, String> {
    Ok(daemon_root()?.join(".anet").join("nodes").join(name).join("config.json"))
}

/// GUI 进程拿不到用户 shell 的 PATH(nvm / homebrew / npm prefix 都在 rc 文件里),
/// 所以一律经登录 shell 跑命令。
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .filter(|shell| !shell.trim().is_empty() && Path::new(shell).is_file())
        .unwrap_or_else(|| if cfg!(target_os = "macos") { "/bin/zsh".into() } else { "/bin/sh".into() })
}

struct CommandOutcome {
    code: Option<i32>,
    output: String,
    timed_out: bool,
}

/// 经登录 shell 跑一条命令,stdout/stderr 合并,带超时(超时后 kill 这条 shell;
/// 它 detached 派生出去的子进程不受影响)。
fn run_shell(
    command: &str,
    cwd: Option<&Path>,
    env: &[(&str, String)],
    timeout: Duration,
) -> Result<CommandOutcome, String> {
    let shell = login_shell();
    let mut cmd = Command::new(&shell);
    cmd.args(["-l", "-c", &format!("{command} 2>&1")])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("cannot start {shell}: {error}"))?;
    let mut stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let reader = thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stdout.read_to_string(&mut buffer);
        buffer
    });
    let started = Instant::now();
    let code = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break Some(status.code().unwrap_or(-1)),
            None if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
            None => thread::sleep(Duration::from_millis(100)),
        }
    };
    let output = reader.join().unwrap_or_default();
    Ok(CommandOutcome {
        code,
        output,
        timed_out: code.is_none(),
    })
}

/// `command -v X` + `X --version` 的输出:第一行是路径,第二行(可选)是版本。
pub fn parse_tool_probe(output: &str) -> Option<ToolInfo> {
    let mut lines = output.lines().map(str::trim).filter(|line| !line.is_empty());
    let path = lines.next()?;
    if !path.starts_with('/') {
        return None;
    }
    let version = lines
        .next()
        .map(|line| line.trim_start_matches('v').to_string())
        .filter(|line| !line.is_empty() && line.len() < 40);
    Some(ToolInfo {
        path: path.to_string(),
        version,
    })
}

fn probe_tool(tool: &str, version_flag: &str) -> Option<ToolInfo> {
    let command = format!("command -v {tool} && {tool} {version_flag} 2>/dev/null | head -1");
    let outcome = run_shell(&command, None, &[], Duration::from_secs(20)).ok()?;
    if outcome.code != Some(0) {
        return None;
    }
    parse_tool_probe(&outcome.output)
}

/// `anet daemon init` 的输出里有一行 `node_id:    node_daemon_xxxx`。
pub fn parse_daemon_node_id(output: &str) -> Option<String> {
    output
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            let rest = trimmed.strip_prefix("node_id:")?;
            let id = rest.trim();
            (!id.is_empty() && !id.contains(char::is_whitespace)).then(|| id.to_string())
        })
}

fn node_id_from_profile(name: &str) -> Option<String> {
    let raw = fs::read_to_string(daemon_profile_path(name).ok()?).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("node_id")?.as_str().map(str::to_string)
}

/// npm 报错里像注册表/网络问题的信号(与 docs-site/public/install.sh 同一份清单)。
pub fn looks_like_registry_failure(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    [
        "etimedout",
        "enotfound",
        "econnreset",
        "econnrefused",
        "eai_again",
        "network",
        "registry",
        "fetch failed",
        "socket hang up",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

pub fn scan(session: Option<&LocalHubSession>) -> Result<DaemonScan, String> {
    let daemon_dir = daemon_root()?;
    let supported = cfg!(unix);
    let reason = if supported {
        None
    } else {
        Some("anet 的 host_supervisor daemon 目前只支持 macOS / Linux(Windows 请用 WSL)".to_string())
    };
    let (node, npm, anet) = if supported {
        (
            probe_tool("node", "-v"),
            probe_tool("npm", "-v"),
            probe_tool("anet", "--version"),
        )
    } else {
        (None, None, None)
    };
    let profile_exists = daemon_profile_path(LOCAL_DAEMON_NAME)?.is_file();
    Ok(DaemonScan {
        supported,
        reason,
        shell: login_shell(),
        node,
        npm,
        anet,
        daemon_dir: daemon_dir.display().to_string(),
        daemon_name: LOCAL_DAEMON_NAME.into(),
        profile_exists,
        node_id: if profile_exists { node_id_from_profile(LOCAL_DAEMON_NAME) } else { None },
        hub_endpoint: session.map(|s| s.endpoint.clone()),
    })
}

fn tail(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let skip = trimmed.chars().count() - max_chars;
    format!("…{}", trimmed.chars().skip(skip).collect::<String>())
}

fn daemon_registered(session: &LocalHubSession, node_id: &str) -> Result<bool, String> {
    let mut url = format!("{}/api/host-supervisors", session.endpoint);
    if let Some(network) = &session.network_id {
        url.push_str(&format!("?network_id={network}"));
    }
    let body: serde_json::Value = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(&session.token)
        .timeout(Duration::from_secs(10))
        .send()
        .map_err(|error| error.to_string())?
        .json()
        .map_err(|error| error.to_string())?;
    Ok(body["daemons"]
        .as_array()
        .is_some_and(|daemons| daemons.iter().any(|d| d["daemon_node_id"] == node_id)))
}

pub fn install(session: &LocalHubSession) -> Result<DaemonInstallReport, String> {
    let mut steps: Vec<StepReport> = Vec::new();
    let fail = |steps: Vec<StepReport>, error: String| {
        Ok(DaemonInstallReport {
            ok: false,
            node_id: None,
            steps,
            error: Some(error),
        })
    };
    if !cfg!(unix) {
        return fail(steps, "anet 的 host_supervisor daemon 只支持 macOS / Linux".into());
    }
    let first = scan(Some(session))?;
    steps.push(StepReport {
        name: "扫描本机".into(),
        ok: true,
        output: format!(
            "shell: {}\nnode: {}\nnpm: {}\nanet: {}",
            first.shell,
            describe(&first.node),
            describe(&first.npm),
            describe(&first.anet)
        ),
    });
    let Some(node) = &first.node else {
        return fail(steps, "本机没有 Node.js(需要 ≥ 22.13)。请先从 https://nodejs.org 安装,再回来点这个按钮。".into());
    };
    if !node_version_ok(node.version.as_deref()) {
        return fail(steps, format!("本机 Node.js 是 {},anet 需要 ≥ 22.13。升级后再回来点这个按钮。", node.version.as_deref().unwrap_or("未知版本")));
    }
    if first.npm.is_none() {
        return fail(steps, "本机有 Node.js 但没有 npm,请重新安装 Node.js(自带 npm)。".into());
    }
    let daemon_dir = daemon_root()?;
    ensure_private_dir(&daemon_dir)?;

    // 1. anet CLI
    let anet = match first.anet.clone() {
        Some(anet) => {
            steps.push(StepReport { name: "anet CLI".into(), ok: true, output: format!("已安装 {} ({})", anet.version.as_deref().unwrap_or("?"), anet.path) });
            anet
        }
        None => {
            let primary = run_shell(&format!("npm install -g {ANET_PACKAGE}"), Some(&daemon_dir), &[], Duration::from_secs(600))?;
            let mut output = primary.output.clone();
            let mut ok = primary.code == Some(0);
            if !ok && !primary.timed_out && looks_like_registry_failure(&primary.output) {
                let mirror = run_shell(&format!("npm install -g {ANET_PACKAGE} --registry {NPM_MIRROR}"), Some(&daemon_dir), &[], Duration::from_secs(600))?;
                output.push_str("\n--- retry via npmmirror ---\n");
                output.push_str(&mirror.output);
                ok = mirror.code == Some(0);
            }
            steps.push(StepReport { name: "npm install -g @sleep2agi/agent-network".into(), ok, output: tail(&output, 1500) });
            if !ok {
                let hint = if primary.timed_out { "npm 安装超时(10 分钟)。" } else if output.contains("EACCES") { "npm 全局目录没有写权限。在终端里跑一次:sudo npm install -g @sleep2agi/agent-network" } else { "npm 安装失败,见上面的输出。" };
                return fail(steps, hint.into());
            }
            match probe_tool("anet", "--version") {
                Some(anet) => anet,
                None => return fail(steps, "npm 装完了但登录 shell 里找不到 anet。检查 `npm config get prefix` 对应的 bin 目录是否在 PATH 里。".into()),
            }
        }
    };

    // 2. 私有 HOME 里写 anet 全局配置(只给 daemon init 用)
    let home = isolated_home()?;
    let anet_dir = home.join(".anet");
    ensure_private_dir(&home)?;
    ensure_private_dir(&anet_dir)?;
    let config = serde_json::json!({
        "hub": session.endpoint,
        "token": session.token,
        "network_id": session.network_id,
    });
    write_private_atomic(&anet_dir.join("config.json"), serde_json::to_vec_pretty(&config).map_err(|e| e.to_string())?.as_slice())?;
    steps.push(StepReport { name: "写入本地 Hub 凭据(私有 HOME)".into(), ok: true, output: format!("{}  hub={}", anet_dir.join("config.json").display(), session.endpoint) });

    // 3. anet daemon init(HOME=私有)
    let init_env = [("HOME", home.display().to_string())];
    let init = run_shell(
        &format!("{} daemon init {} --force", shell_quote(&anet.path), LOCAL_DAEMON_NAME),
        Some(&daemon_dir),
        &init_env,
        Duration::from_secs(90),
    )?;
    let init_ok = init.code == Some(0);
    steps.push(StepReport { name: format!("anet daemon init {LOCAL_DAEMON_NAME}"), ok: init_ok, output: tail(&init.output, 1500) });
    if !init_ok {
        return fail(steps, if init.timed_out { "anet daemon init 超时".into() } else { "anet daemon init 失败,见上面的输出。".into() });
    }
    let node_id = parse_daemon_node_id(&init.output).or_else(|| node_id_from_profile(LOCAL_DAEMON_NAME));
    let Some(node_id) = node_id else {
        return fail(steps, "daemon 初始化成功但没拿到 node_id".into());
    };

    // 4. anet daemon start(用户真实 HOME;它 detached 派生 daemon 进程)
    let start = run_shell(
        &format!("{} daemon start {}", shell_quote(&anet.path), LOCAL_DAEMON_NAME),
        Some(&daemon_dir),
        &[],
        Duration::from_secs(60),
    )?;
    steps.push(StepReport {
        name: format!("anet daemon start {LOCAL_DAEMON_NAME}"),
        ok: start.code == Some(0) || start.timed_out,
        output: tail(&start.output, 1500),
    });
    if start.code.is_some() && start.code != Some(0) {
        return fail(steps, "anet daemon start 失败,见上面的输出。".into());
    }

    // 5. 向 Hub 确认注册(最多 45s)
    let deadline = Instant::now() + Duration::from_secs(45);
    let mut registered = false;
    let mut last_error = String::new();
    while Instant::now() < deadline {
        match daemon_registered(session, &node_id) {
            Ok(true) => { registered = true; break; }
            Ok(false) => {}
            Err(error) => last_error = error,
        }
        thread::sleep(Duration::from_secs(2));
    }
    steps.push(StepReport {
        name: "Hub 确认 host_supervisor 已注册".into(),
        ok: registered,
        output: if registered { format!("daemon_node_id={node_id}") } else if last_error.is_empty() { "45 秒内 Hub 的 /api/host-supervisors 里没有出现这台 daemon".into() } else { last_error.clone() },
    });
    Ok(DaemonInstallReport {
        ok: registered,
        node_id: Some(node_id),
        steps,
        error: if registered { None } else { Some("daemon 已启动但 Hub 还没看到它;等 10 秒刷新列表,仍没有就点「打开日志」看 daemon 输出。".into()) },
    })
}

/// 只给打包 smoke 用:停掉刚起的 daemon(`anet node stop <name>`),失败不算错。
pub fn stop_for_smoke() -> Result<(), String> {
    let daemon_dir = daemon_root()?;
    let _ = run_shell(&format!("anet node stop {LOCAL_DAEMON_NAME}"), Some(&daemon_dir), &[], Duration::from_secs(30))?;
    Ok(())
}

fn describe(tool: &Option<ToolInfo>) -> String {
    match tool {
        Some(info) => format!("{} ({})", info.version.as_deref().unwrap_or("?"), info.path),
        None => "缺".into(),
    }
}

pub fn node_version_ok(version: Option<&str>) -> bool {
    let Some(version) = version else { return false };
    let mut parts = version.trim_start_matches('v').split('.').map(|part| part.parse::<u32>().unwrap_or(0));
    let major = parts.next().unwrap_or(0);
    let minor = parts.next().unwrap_or(0);
    major > 22 || (major == 22 && minor >= 13)
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tool_probe_path_and_version() {
        let info = parse_tool_probe("/opt/homebrew/bin/node\nv22.14.0\n").unwrap();
        assert_eq!(info.path, "/opt/homebrew/bin/node");
        assert_eq!(info.version.as_deref(), Some("22.14.0"));
        let bare = parse_tool_probe("/usr/local/bin/anet\n").unwrap();
        assert_eq!(bare.version, None);
        assert!(parse_tool_probe("zsh: command not found: anet\n").is_none());
        assert!(parse_tool_probe("").is_none());
    }

    #[test]
    fn parses_daemon_node_id_from_init_output() {
        let output = "[anet daemon] ✓ created host_supervisor daemon \"local-daemon\"\n              config:     .anet/nodes/local-daemon/config.json\n              node_id:    node_daemon_0a1b2c3d4e5f\n";
        assert_eq!(parse_daemon_node_id(output).as_deref(), Some("node_daemon_0a1b2c3d4e5f"));
        assert_eq!(parse_daemon_node_id("nothing here"), None);
    }

    #[test]
    fn node_version_gate_matches_install_sh() {
        assert!(node_version_ok(Some("v22.13.0")));
        assert!(node_version_ok(Some("24.1.0")));
        assert!(!node_version_ok(Some("v22.12.9")));
        assert!(!node_version_ok(Some("v20.20.0")));
        assert!(!node_version_ok(None));
    }

    #[test]
    fn registry_failure_signals_match_install_sh() {
        assert!(looks_like_registry_failure("npm ERR! code ETIMEDOUT\nnpm ERR! network request to https://registry.npmjs.org failed"));
        assert!(!looks_like_registry_failure("npm ERR! code EACCES\nnpm ERR! syscall mkdir"));
    }

    #[test]
    fn shell_quote_escapes_single_quotes() {
        assert_eq!(shell_quote("/a/b c"), "'/a/b c'");
        assert_eq!(shell_quote("it's"), "'it'\\''s'");
    }
}
