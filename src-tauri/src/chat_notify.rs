// 点系统通知要打开那条对话。
// tauri-plugin-notification 2.4 在桌面端把点击丢掉(desktop.rs 只 show(),不回事件)。
// 窗口焦点推断也不可靠:人正开着别的会话时窗口本来就有焦点,点通知不会再触发 focus。
// 这里自己发通知,点正文(default)就聚焦主窗口并走托盘那条 tray-open-chat。

use tauri::{AppHandle, Emitter, Runtime};

pub(crate) fn opens_chat(response: &notify_rust::NotificationResponse) -> bool {
    match response {
        notify_rust::NotificationResponse::Default => true,
        notify_rust::NotificationResponse::Action(key) => key == "default",
        _ => false,
    }
}

#[tauri::command]
pub fn show_chat_notification<R: Runtime>(app: AppHandle<R>, alias: String, title: String, body: String) {
    let alias = alias.trim().to_string();
    if alias.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let mut notification = notify_rust::Notification::new();
        notification.summary(&title).body(&body).appname("Agent Network");
        // Linux: 不登记 default,点正文不会回报。Windows 点正文是 Default,这个按钮也是同一条路。
        notification.action("default", "打开");
        #[cfg(windows)]
        set_windows_app_id(&mut notification);
        let Ok(handle) = notification.show() else {
            return;
        };
        let _ = handle.wait_for_response(move |response| {
            if !opens_chat(response) {
                return;
            }
            crate::tray::focus_main(&app);
            let _ = app.emit("tray-open-chat", alias);
        });
    });
}

#[cfg(windows)]
fn set_windows_app_id(notification: &mut notify_rust::Notification) {
    use std::path::MAIN_SEPARATOR as SEP;
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let Some(dir) = exe.parent() else {
        return;
    };
    let curr = dir.display().to_string();
    if curr.ends_with(&format!("{SEP}target{SEP}debug")) || curr.ends_with(&format!("{SEP}target{SEP}release")) {
        return;
    }
    notification.app_id("top.vansin.agentnetwork.desktop");
}

#[cfg(test)]
mod tests {
    use super::opens_chat;
    use notify_rust::{CloseReason, NotificationResponse};

    #[test]
    fn body_click_opens_the_chat() {
        assert!(opens_chat(&NotificationResponse::Default));
        assert!(opens_chat(&NotificationResponse::Action("default".into())));
        assert!(!opens_chat(&NotificationResponse::Action("other".into())));
        assert!(!opens_chat(&NotificationResponse::Closed(CloseReason::Dismissed)));
    }
}
