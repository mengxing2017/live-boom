use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const DISPLAY_WINDOW_LABEL: &str = "display";

/// 已有展示窗则聚焦复用，不重复开窗。
pub fn open_display(app: &AppHandle) -> tauri::Result<()> {
    if let Some(existing) = app.get_webview_window(DISPLAY_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }
    let builder = WebviewWindowBuilder::new(
        app,
        DISPLAY_WINDOW_LABEL,
        WebviewUrl::App("index.html".into()),
    )
    .title("LikeBoom 展示窗")
    .inner_size(1280.0, 720.0);
    #[cfg(target_os = "windows")]
    let builder = if capture_mode(app) {
        builder.additional_browser_args("--disable-gpu --enable-unsafe-swiftshader")
    } else {
        builder
    };
    builder.build()?;
    Ok(())
}

pub fn capture_mode(app: &AppHandle) -> bool {
    app.path()
        .app_data_dir()
        .ok()
        .and_then(|d| std::fs::read(d.join("host-settings.json")).ok())
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .is_some_and(|v| v["captureCompatibility"] == true)
}
pub fn set_capture_mode(app: &AppHandle, enabled: bool) -> Result<(), String> {
    if enabled && !cfg!(target_os = "windows") {
        return Err("当前仅提供 Windows 软件渲染采集兼容选项".into());
    }
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::write(
        data.join("host-settings.json"),
        serde_json::to_vec(&serde_json::json!({"captureCompatibility":enabled}))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
