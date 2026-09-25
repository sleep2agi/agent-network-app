//! 0.2.76 系统栏(菜单栏/托盘)常驻项 —— Vincent 2026-09-17:「把 Agent Network 做到系统栏吧,
//! 有新消息做个提示 类似飞书这样」。
//!
//! 形态照飞书:图标旁显示未读总数(macOS 用 tray title;Windows 用 tooltip),下拉菜单每行
//! 「N  <alias>」,点一行 = 聚焦主窗口 + 通知前端打开那个会话(事件 `tray-open-chat`)。
//! 菜单由前端在未读快照变化时通过 `tray_update` 命令整体重建 —— 托盘不自己算数,
//! 数的来源只有一个(unread-store),避免两处算出不同的角标。
//!
//! 图标:macOS 用单色 template PNG(系统按明暗菜单栏自动着色),其它平台用彩色 32px。

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime,
};
// 只有非 Linux 才画面板(Linux 收不到 TrayIconEvent),这两个类型也就只在那里用得上。
#[cfg(not(target_os = "linux"))]
use tauri::{LogicalSize, PhysicalPosition};

pub const TRAY_ID: &str = "main-tray";
const MENU_OPEN: &str = "tray-open";
const MENU_QUIT: &str = "tray-quit";
const MENU_CHAT_PREFIX: &str = "tray-chat:";
/// 下拉里最多列多少个 agent(飞书也不会把上百个联系人全铺出来)。
pub const MAX_ITEMS: usize = 20;

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TrayItem {
    pub alias: String,
    pub count: u32,
}

/// 菜单行文本:「N  alias」,两个空格与飞书一致。
pub fn item_label(item: &TrayItem) -> String {
    format!("{}  {}", item.count, item.alias)
}

/// 标题/工具提示文本。0 未读时 macOS 标题留空(只剩图标),tooltip 仍写应用名。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))] // 只有 macOS 托盘有 title
pub fn title_for(total: u32) -> String {
    if total == 0 { String::new() } else { total.to_string() }
}

/// 交给 `set_title` 的参数。
///
/// 🔴 0.2.92 永远是 `Some(..)`,0 未读时是 `Some("")`。tray-icon 0.24.2 的 macOS 实现
///    (`platform_impl/macos/mod.rs` `set_title_inner`)收到 `None` 时**什么也不做**,
///    按钮上的旧标题原样留着 —— 于是未读从 1 清到 0 以后,菜单栏一直挂着「1」,
///    而面板(读的是同一份模型)正确地显示「没有未读消息」。只有 `Some("")` 才会真的清掉。
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn title_arg(total: u32) -> Option<String> {
    Some(title_for(total))
}

pub fn tooltip_for(total: u32) -> String {
    if total == 0 { "Agent Network".to_string() } else { format!("Agent Network · {total} 条未读") }
}

/// 按未读数降序、忽略 0。前端已经排好序,这里再守一次。
///
/// 🔴 0.2.92 **不再截断**:面板从这里取模型,截断会让角标数里包含面板列不出来的会话。
///    行数上限只作用于原生菜单(见 `menu_rows`)。
pub fn normalize_items(mut items: Vec<TrayItem>) -> Vec<TrayItem> {
    items.retain(|i| i.count > 0 && !i.alias.trim().is_empty());
    items.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.alias.cmp(&b.alias)));
    items
}

/// 原生菜单里画哪些行,以及塞不下的还有几个会话(末尾画「还有 N 个会话…」,点了打开主窗口)。
pub fn menu_rows(items: &[TrayItem]) -> (&[TrayItem], usize) {
    let shown = items.len().min(MAX_ITEMS);
    (&items[..shown], items.len() - shown)
}

/// 面板窗口标签。必须同时出现在 `capabilities/default.json` 的 `windows` 里,
/// 否则新窗口拿不到任何 core 权限(0.2.56 workspace-* 漏登记的原样复发)。
pub const PANEL_LABEL: &str = "tray-panel";
#[cfg_attr(target_os = "linux", allow(dead_code))] // Linux 不画面板
const PANEL_W: f64 = 300.0;
#[cfg_attr(target_os = "linux", allow(dead_code))]
const PANEL_H: f64 = 420.0;
/// 面板与托盘图标之间留的缝,以及贴边时与屏幕边缘的最小距离。
#[cfg_attr(target_os = "linux", allow(dead_code))]
const PANEL_GAP: i32 = 8;

/// 最近一次由主窗口推上来的托盘模型。面板窗口是独立 webview、读不到 unread-store,
/// 所以由这里转一手 —— 数仍然只由 unread-store 产生。
#[derive(Default)]
pub struct TrayModelState(pub Mutex<Vec<TrayItem>>);

/// 面板放哪:横向以托盘图标为中心,纵向看图标在屏幕上半还是下半
/// (macOS 菜单栏在顶 → 往下放;Windows 任务栏通常在底 → 往上放),最后夹回工作区内。
///
/// 纯函数,单位都是物理像素。`icon` = 托盘图标的矩形(x, y, w, h);
/// `area` = 当前显示器工作区(x, y, w, h);`panel` = 面板尺寸(w, h)。
#[cfg_attr(target_os = "linux", allow(dead_code))]
pub fn panel_position(
    icon: (i32, i32, i32, i32),
    area: (i32, i32, i32, i32),
    panel: (i32, i32),
) -> (i32, i32) {
    let (ix, iy, iw, ih) = icon;
    let (ax, ay, aw, ah) = area;
    let (pw, ph) = panel;

    let mut x = ix + iw / 2 - pw / 2;
    let max_x = ax + aw - pw - PANEL_GAP;
    let min_x = ax + PANEL_GAP;
    // 🔴 先夹上界再夹下界:工作区比面板还窄时,必须留在左边缘而不是被推出屏幕右侧。
    if x > max_x {
        x = max_x;
    }
    if x < min_x {
        x = min_x;
    }

    let icon_center_y = iy + ih / 2;
    let below = icon_center_y < ay + ah / 2;
    let mut y = if below { iy + ih + PANEL_GAP } else { iy - ph - PANEL_GAP };
    let max_y = ay + ah - ph - PANEL_GAP;
    let min_y = ay + PANEL_GAP;
    if y > max_y {
        y = max_y;
    }
    if y < min_y {
        y = min_y;
    }

    (x, y)
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, items: &[TrayItem]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    if items.is_empty() {
        let none = MenuItem::with_id(app, "tray-none", "没有未读消息", false, None::<&str>)?;
        menu.append(&none)?;
    } else {
        let (shown, hidden) = menu_rows(items);
        for item in shown {
            let id = format!("{MENU_CHAT_PREFIX}{}", item.alias);
            let row = MenuItem::with_id(app, id, item_label(item), true, None::<&str>)?;
            menu.append(&row)?;
        }
        if hidden > 0 {
            let more = MenuItem::with_id(app, MENU_OPEN, format!("还有 {hidden} 个会话有未读…"), true, None::<&str>)?;
            menu.append(&more)?;
        }
    }
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, MENU_OPEN, "打开 Agent Network", true, None::<&str>)?)?;
    menu.append(&MenuItem::with_id(app, MENU_QUIT, "退出", true, None::<&str>)?)?;
    Ok(menu)
}

fn focus_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// 取已有面板窗口;没有就按 `?tray=1` 建一个(隐藏、无边框、置顶、不进任务栏)。
#[cfg(not(target_os = "linux"))]
fn panel_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::WebviewWindow<R>> {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        return Ok(window);
    }
    tauri::WebviewWindowBuilder::new(
        app,
        PANEL_LABEL,
        tauri::WebviewUrl::App("index.html?tray=1".into()),
    )
    .title("Agent Network")
    .inner_size(PANEL_W, PANEL_H)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .inspect(|window| {
        // 失焦即收起(点别处、切应用)。这是窗口事件,前端看不到,所以在这里挂。
        let handle = window.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(false) = event {
                let _ = handle.hide();
            }
        });
    })
}

/// 点托盘图标:已显示就收起,否则按图标位置摆好再显示。
#[cfg(not(target_os = "linux"))]
fn toggle_panel<R: Runtime>(app: &AppHandle<R>, icon_rect: tauri::Rect) {
    let window = match panel_window(app) {
        Ok(w) => w,
        Err(error) => {
            eprintln!("[tray] panel create failed: {error}");
            return;
        }
    };
    if window.is_visible().unwrap_or(false) {
        let _ = window.hide();
        return;
    }
    let _ = window.set_size(LogicalSize::new(PANEL_W, PANEL_H));
    let size = window.outer_size().unwrap_or(tauri::PhysicalSize { width: PANEL_W as u32, height: PANEL_H as u32 });
    let icon_pos = icon_rect.position.to_physical::<f64>(1.0);
    let icon_size = icon_rect.size.to_physical::<u32>(1.0);
    let icon = (
        icon_pos.x as i32,
        icon_pos.y as i32,
        icon_size.width as i32,
        icon_size.height as i32,
    );
    let area = window
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| {
            let p = m.position();
            let s = m.size();
            (p.x, p.y, s.width as i32, s.height as i32)
        })
        .unwrap_or((0, 0, 1920, 1080));
    let (x, y) = panel_position(icon, area, (size.width as i32, size.height as i32));
    let _ = window.set_position(PhysicalPosition::new(x, y));
    let _ = window.show();
    let _ = window.set_focus();
}

fn hide_panel<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        let _ = window.hide();
    }
}

/// 面板开着时,把最新模型推给它(否则它只在打开那一刻取过一次)。
fn push_model_to_panel<R: Runtime>(app: &AppHandle<R>, items: &[TrayItem]) {
    if let Some(window) = app.get_webview_window(PANEL_LABEL) {
        let _ = window.emit("tray-model", items.to_vec());
    }
}

/// 面板取当前模型(它读不到 unread-store,只能问这里)。
#[tauri::command]
pub fn tray_panel_model<R: Runtime>(app: AppHandle<R>) -> Vec<TrayItem> {
    app.state::<TrayModelState>()
        .0
        .lock()
        .map(|items| items.clone())
        .unwrap_or_default()
}

/// 面板点了一行。复用 0.2.76 那条 `tray-open-chat` —— 前端监听没变。
#[tauri::command]
pub fn tray_open_chat<R: Runtime>(app: AppHandle<R>, alias: String) {
    hide_panel(&app);
    focus_main(&app);
    let _ = app.emit("tray-open-chat", alias);
}

/// 面板点了「忽略全部」。清未读要用主窗口的 hub 配置,所以只转发事件,不在这里做。
#[tauri::command]
pub fn tray_dismiss_all<R: Runtime>(app: AppHandle<R>) {
    hide_panel(&app);
    let _ = app.emit("tray-dismiss-all", ());
}

#[tauri::command]
pub fn tray_panel_hide<R: Runtime>(app: AppHandle<R>) {
    hide_panel(&app);
}

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    // 🔴 嵌入 @2x(50×44)而不是 1x:tray-icon 0.24 不管给它多大的像素,都把状态栏图像
    //    强制成 `NSSize { height: 18.0, width: 18.0 * aspect }`
    //    (tray-icon/src/platform_impl/macos/mod.rs)。所以 22px 那份在 Retina 上是**放大**后
    //    再显示 = 糊;44px 那份是轻微缩小 = 清楚。两份都留着:1x 是人读/对照用的基准尺寸。
    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("./tray/trayTemplate@2x.png");
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::include_image!("./tray/tray.png");

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(tooltip_for(0))
        .menu(&build_menu(app, &[])?)
        // 🔴 Linux 上 TrayIconEvent **根本不会发出**(tauri 2.11.5 tray/mod.rs:66
        //    「Linux: Unsupported. The event is not emitted」),而且菜单一旦设上就
        //    换不掉 —— 所以 Linux 只能继续用原生菜单,自绘面板在那里做不出来。
        //    macOS/Windows:左键交给我们自己处理(出面板),右键仍出原生菜单,
        //    「打开 Agent Network / 退出」因此还在原处可达。
        .show_menu_on_left_click(cfg!(target_os = "linux"))
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if id == MENU_QUIT {
                app.exit(0);
            } else if id == MENU_OPEN {
                focus_main(app);
            } else if let Some(alias) = id.strip_prefix(MENU_CHAT_PREFIX) {
                focus_main(app);
                let _ = app.emit("tray-open-chat", alias.to_string());
            }
        });
    #[cfg(not(target_os = "linux"))]
    let builder = builder.on_tray_icon_event(|tray, event| {
        use tauri::tray::{MouseButton, MouseButtonState, TrayIconEvent};
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
            toggle_panel(tray.app_handle(), rect);
        }
    });

    #[cfg(target_os = "macos")]
    let builder = builder.icon_as_template(true);
    builder.build(app)?;
    Ok(())
}

/// 前端在未读快照变化时调用;整体重建菜单 + 标题/tooltip。
#[tauri::command]
pub fn tray_update<R: Runtime>(app: AppHandle<R>, total: u32, items: Vec<TrayItem>) -> Result<(), String> {
    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| "tray not initialized".to_string())?;
    let items = normalize_items(items);
    if let Ok(mut slot) = app.state::<TrayModelState>().0.lock() {
        *slot = items.clone();
    }
    push_model_to_panel(&app, &items);
    let menu = build_menu(&app, &items).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip_for(total))).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        tray.set_title(title_arg(total)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_follow_feishu_shape() {
        assert_eq!(item_label(&TrayItem { alias: "通信龙".into(), count: 3 }), "3  通信龙");
        assert_eq!(title_for(0), "");
        assert_eq!(title_for(40), "40");
        assert_eq!(tooltip_for(0), "Agent Network");
        assert_eq!(tooltip_for(2), "Agent Network · 2 条未读");
    }

    #[test]
    fn panel_sits_under_a_top_bar_icon_and_above_a_bottom_one() {
        let area = (0, 0, 1920, 1080);
        let panel = (300, 420);
        // macOS 菜单栏:图标在顶部 → 面板在图标下方
        let (_, y_top) = panel_position((900, 0, 24, 24), area, panel);
        assert_eq!(y_top, 24 + PANEL_GAP);
        // Windows 任务栏在底:图标在底部 → 面板在图标上方
        let (_, y_bottom) = panel_position((900, 1050, 24, 24), area, panel);
        assert_eq!(y_bottom, 1050 - 420 - PANEL_GAP);
    }

    #[test]
    fn panel_centers_on_the_icon_then_clamps_into_the_work_area() {
        let area = (0, 0, 1920, 1080);
        let panel = (300, 420);
        // 居中
        let (x, _) = panel_position((900, 0, 24, 24), area, panel);
        assert_eq!(x, 900 + 12 - 150);
        // 贴右边:不能被推出屏幕
        let (x_right, _) = panel_position((1910, 0, 24, 24), area, panel);
        assert_eq!(x_right, 1920 - 300 - PANEL_GAP);
        // 贴左边:不能是负数
        let (x_left, _) = panel_position((0, 0, 24, 24), area, panel);
        assert_eq!(x_left, PANEL_GAP);
        // 非零原点的显示器(副屏)也要落在它自己的工作区里
        let (x_second, y_second) = panel_position((2500, 0, 24, 24), (1920, 0, 1920, 1080), panel);
        assert!(x_second >= 1920 + PANEL_GAP && x_second + 300 <= 1920 + 1920);
        assert_eq!(y_second, 24 + PANEL_GAP);
    }

    #[test]
    fn panel_stays_on_screen_when_the_work_area_is_smaller_than_it() {
        // 工作区比面板还窄/还矮:宁可贴左上,也不能算出负坐标把窗口推出屏幕。
        let (x, y) = panel_position((10, 10, 24, 24), (0, 0, 200, 200), (300, 420));
        assert_eq!(x, PANEL_GAP);
        assert_eq!(y, PANEL_GAP);
    }

    #[test]
    fn normalize_drops_zero_sorts_desc_and_keeps_everything_countable() {
        let mut items: Vec<TrayItem> = (0..30).map(|i| TrayItem { alias: format!("a{i}"), count: i }).collect();
        items.push(TrayItem { alias: "  ".into(), count: 9 });
        let out = normalize_items(items);
        // 0 那个和空白别名被丢;其余 29 个全部保留 —— 面板要能列出每一个被计入角标的会话。
        assert_eq!(out.len(), 29);
        assert_eq!(out[0].count, 29);
        assert!(out.iter().all(|i| i.count > 0));
        assert!(out.windows(2).all(|w| w[0].count >= w[1].count));
    }

    #[test]
    fn native_menu_caps_rows_and_counts_the_rest() {
        let items: Vec<TrayItem> = (1..=25).rev().map(|i| TrayItem { alias: format!("a{i}"), count: i }).collect();
        let (shown, hidden) = menu_rows(&items);
        assert_eq!(shown.len(), MAX_ITEMS);
        assert_eq!(hidden, 5);
        let few = &items[..3];
        assert_eq!(menu_rows(few), (few, 0));
    }

    #[test]
    fn zero_unread_clears_the_macos_title_instead_of_leaving_the_old_one() {
        // tray-icon 0.24.2 macOS: set_title(None) 不动按钮,旧标题留着。必须传 Some("")。
        assert_eq!(title_arg(0), Some(String::new()));
        assert_eq!(title_arg(1), Some("1".to_string()));
    }
}
