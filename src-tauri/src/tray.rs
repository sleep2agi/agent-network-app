//! 0.2.76 系统栏(菜单栏/托盘)常驻项 —— Vincent 2026-09-17:「把 Agent Network 做到系统栏吧,
//! 有新消息做个提示 类似飞书这样」。
//!
//! 形态照飞书:图标旁显示未读总数(macOS 用 tray title;Windows 用 tooltip),下拉菜单每行
//! 「N  <alias>」,点一行 = 聚焦主窗口 + 通知前端打开那个会话(事件 `tray-open-chat`)。
//! 菜单由前端在未读快照变化时通过 `tray_update` 命令整体重建 —— 托盘不自己算数,
//! 数的来源只有一个(unread-store),避免两处算出不同的角标。
//!
//! 图标:macOS 用单色 template PNG(系统按明暗菜单栏自动着色),其它平台用彩色 32px。

use serde::Deserialize;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Runtime,
};

pub const TRAY_ID: &str = "main-tray";
const MENU_OPEN: &str = "tray-open";
const MENU_QUIT: &str = "tray-quit";
const MENU_CHAT_PREFIX: &str = "tray-chat:";
/// 下拉里最多列多少个 agent(飞书也不会把上百个联系人全铺出来)。
pub const MAX_ITEMS: usize = 20;

#[derive(Debug, Clone, Deserialize)]
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

pub fn tooltip_for(total: u32) -> String {
    if total == 0 { "Agent Network".to_string() } else { format!("Agent Network · {total} 条未读") }
}

/// 只取前 MAX_ITEMS 个、按未读数降序、忽略 0。前端已经排好序,这里再守一次。
pub fn normalize_items(mut items: Vec<TrayItem>) -> Vec<TrayItem> {
    items.retain(|i| i.count > 0 && !i.alias.trim().is_empty());
    items.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.alias.cmp(&b.alias)));
    items.truncate(MAX_ITEMS);
    items
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, items: &[TrayItem]) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    if items.is_empty() {
        let none = MenuItem::with_id(app, "tray-none", "没有未读消息", false, None::<&str>)?;
        menu.append(&none)?;
    } else {
        for item in items {
            let id = format!("{MENU_CHAT_PREFIX}{}", item.alias);
            let row = MenuItem::with_id(app, id, item_label(item), true, None::<&str>)?;
            menu.append(&row)?;
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

pub fn init<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    let icon = tauri::include_image!("./tray/trayTemplate.png");
    #[cfg(not(target_os = "macos"))]
    let icon = tauri::include_image!("./tray/tray.png");

    let builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(tooltip_for(0))
        .menu(&build_menu(app, &[])?)
        .show_menu_on_left_click(true)
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
    let menu = build_menu(&app, &items).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip_for(total))).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        let title = title_for(total);
        tray.set_title(if title.is_empty() { None } else { Some(title) }).map_err(|e| e.to_string())?;
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
    fn normalize_drops_zero_sorts_desc_and_caps() {
        let mut items: Vec<TrayItem> = (0..30).map(|i| TrayItem { alias: format!("a{i}"), count: i }).collect();
        items.push(TrayItem { alias: "  ".into(), count: 9 });
        let out = normalize_items(items);
        assert_eq!(out.len(), MAX_ITEMS);
        assert_eq!(out[0].count, 29);
        assert!(out.iter().all(|i| i.count > 0));
        assert!(out.windows(2).all(|w| w[0].count >= w[1].count));
    }
}
