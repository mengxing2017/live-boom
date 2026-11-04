use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const DISPLAY_WINDOW_LABEL: &str = "display";

/// 已有展示窗则聚焦复用，不重复开窗。
pub fn open_display(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(
        app,
        DISPLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("LikeBoom 展示窗")
    .inner_size(1280.0, 720.0)
    .build()?;
    Ok(())
}
