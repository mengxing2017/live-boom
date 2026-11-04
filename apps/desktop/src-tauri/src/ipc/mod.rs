use crate::Host;
use play_contracts::*;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, WebviewWindow};
fn error(code: &str, message: impl ToString) -> AppError {
    AppError::new(code, message)
}
fn role(window: &WebviewWindow, allowed: &[&str]) -> AppResult<()> {
    if !allowed.contains(&window.label()) {
        return Err(error("FORBIDDEN_WINDOW", "窗口无权限"));
    }
    Ok(())
}
fn text<'a>(v: &'a Value, key: &str) -> AppResult<&'a str> {
    v[key]
        .as_str()
        .ok_or_else(|| error("VALIDATION_FAILED", format!("缺少 {key}")))
}
pub fn emit_snapshot(app: &AppHandle, host: &Host) {
    for (label, full) in [("control", true), ("display", false)] {
        if let Ok(s) = host.coordinator.snapshot(full) {
            let _ = app.emit_to(label, "snapshot", s);
        }
    }
}
#[tauri::command]
pub fn snapshot(window: WebviewWindow, host: tauri::State<'_, Host>) -> AppResult<Snapshot> {
    role(&window, &["control", "display"])?;
    host.coordinator.snapshot(window.label() == "control")
}
#[tauri::command]
pub fn plugins(window: WebviewWindow, host: tauri::State<'_, Host>) -> AppResult<Vec<PluginInfo>> {
    role(&window, &["control"])?;
    host.plugins
        .lock()
        .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
        .list()
}
#[tauri::command]
pub fn host_command(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    name: String,
    mut args: Value,
) -> AppResult<Value> {
    if let Some(expected) = args.get("__controlDigest") {
        let current = host.coordinator.snapshot(false)?.active;
        if expected.as_str() != current.as_ref().map(|p| p.digest.as_str()) {
            return Err(error("STALE_CONTROL", "操作台对应的玩法已切换"));
        }
        if let Some(object) = args.as_object_mut() {
            object.remove("__controlDigest");
        }
    }
    if name == "register_display" || name == "interrupt_display" {
        role(&window, &["display"])?;
        if name == "register_display" {
            host.coordinator
                .register_display(text(&args, "instance")?.into())?;
        } else {
            host.coordinator.display_lost()?;
        }
    } else {
        role(&window, &["control"])?;
        match name.as_str() {
            "read_preferences" => return host.coordinator.read_preferences(text(&args, "key")?),
            "runtime_info" => {
                return Ok(
                    json!({"platform":std::env::consts::OS,"version":HOST_VERSION,"captureCompatibility":crate::windows::capture_mode(&app)}),
                );
            }
            "capture_mode" => crate::windows::set_capture_mode(
                &app,
                args["enabled"]
                    .as_bool()
                    .ok_or_else(|| error("VALIDATION_FAILED", "缺少 enabled"))?,
            )
            .map_err(|e| error("CAPTURE_MODE_ERROR", e))?,
            "restart" => {
                host.coordinator.display_lost()?;
                emit_snapshot(&app, &host);
                app.restart();
            }
            "diagnostics" => {
                let messages = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .diagnostics()?;
                return Ok(json!(messages));
            }
            "submit" | "submit_demo" => {
                let priority = args["priority"].as_u64().unwrap_or(0).min(1) as u8;
                let r: SubmitRequest =
                    serde_json::from_value(args).map_err(|e| error("VALIDATION_FAILED", e))?;
                host.coordinator.submit_local(
                    r,
                    if name == "submit_demo" {
                        InputSource::Demo
                    } else {
                        InputSource::Manual
                    },
                    priority,
                )?;
            }
            "media_list" | "delete_media" | "media_resolve" => {
                let p = host
                    .coordinator
                    .snapshot(false)?
                    .active
                    .ok_or_else(|| error("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
                if !p.manifest.capabilities.iter().any(|c| c == "media.own.v1") {
                    return Err(error("FORBIDDEN", "无媒体能力"));
                }
                if name == "media_list" {
                    return Ok(json!(host.media.list(&p.digest)?));
                }
                let reference = text(&args, "reference")?;
                if name == "media_resolve" {
                    return Ok(json!(host.media.resolve(&p.digest, reference)?));
                }
                if host.coordinator.media_referenced(reference)? {
                    return Err(error(
                        "MEDIA_IN_USE",
                        "图片被任务、回执或插件状态引用；先清理相关记录",
                    ));
                }
                host.media.remove(&p.digest, reference)?;
            }
            "configure" => host.coordinator.configure(args)?,
            "reset_demo" => host.coordinator.reset_demo()?,
            "licenses" => {
                let active = host
                    .coordinator
                    .snapshot(false)?
                    .active
                    .ok_or_else(|| error("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
                let package = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .load(&active.digest)?;
                let text = package
                    .files
                    .get("THIRD_PARTY_NOTICES")
                    .map(|b| String::from_utf8_lossy(b).to_string())
                    .unwrap_or_default();
                return Ok(json!(text));
            }
            "demo_policy" => host.coordinator.configure_demo(
                args["enabled"].as_bool().unwrap_or(false),
                args["interval"].as_u64().unwrap_or(30) as u32,
                args["input"].clone(),
            )?,
            "presentation" => host.coordinator.set_presentation(args)?,
            "preempt" => host.coordinator.preempt()?,
            "preview_control" => {
                if serde_json::to_vec(&args)
                    .map_err(|e| error("VALIDATION_FAILED", e))?
                    .len()
                    > 4096
                {
                    return Err(error("MESSAGE_LIMIT", "控制消息过大"));
                }
                let _ = app.emit_to("display", "preview-control", args);
            }
            "resize_display" => {
                let w = args["width"].as_u64().unwrap_or(0);
                let h = args["height"].as_u64().unwrap_or(0);
                if ![(1280, 720), (1920, 1080), (720, 1280), (1080, 1920)].contains(&(w, h)) {
                    return Err(error("INVALID_SIZE", "不支持的输出尺寸"));
                }
                if let Some(display) = tauri::Manager::get_webview_window(&app, "display") {
                    display
                        .set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                            w as u32, h as u32,
                        )))
                        .map_err(|e| error("WINDOW_ERROR", e))?;
                }
            }
            "open_display" => {
                crate::windows::open_display(&app).map_err(|e| error("DISPLAY_OPEN_FAILED", e))?;
            }
            "activate" => {
                let digest = text(&args, "digest")?;
                let plugin = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .load(digest)?
                    .info;
                host.coordinator
                    .activate(Some(plugin), args["config"].clone())?;
            }
            "disable" => {
                host.coordinator.activate(None, json!({}))?;
            }
            "pause" => host.coordinator.pause(true)?,
            "resume" => host.coordinator.pause(false)?,
            "cancel" => host.coordinator.cancel(text(&args, "id")?)?,
            "clear_pending" => host.coordinator.clear_pending()?,
            "retry" => host.coordinator.retry(text(&args, "id")?)?,
            "clear_history" => host.coordinator.clear_history()?,
            "install" => {
                host.plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .import_file(std::path::Path::new(text(&args, "path")?))?;
            }
            "trust_publisher" => {
                let fingerprint = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .trust(
                        text(&args, "publisher")?.into(),
                        text(&args, "publicKey")?.into(),
                    )?;
                return Ok(json!({"fingerprint":fingerprint}));
            }
            "migrate_state" => {
                let manager = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?;
                let source = manager.load(text(&args, "sourceDigest")?)?.info;
                let target = manager.load(text(&args, "targetDigest")?)?.info;
                let mapping = serde_json::from_value(args["mapping"].clone())
                    .map_err(|e| error("VALIDATION_FAILED", e))?;
                let defaults = serde_json::from_value(args["defaults"].clone())
                    .map_err(|e| error("VALIDATION_FAILED", e))?;
                host.coordinator
                    .migrate_state(&source, &target, mapping, defaults)?;
            }
            "copy_state" => {
                let manager = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?;
                let source = manager.load(text(&args, "sourceDigest")?)?.info;
                let target = manager.load(text(&args, "targetDigest")?)?.info;
                host.coordinator.copy_compatible_state(&source, &target)?;
            }
            "uninstall" => {
                let digest = text(&args, "digest")?;
                if host.coordinator.references(digest)? {
                    return Err(error(
                        "PLUGIN_IN_USE",
                        "插件被启用或被任务引用，请先停用并清理相关记录",
                    ));
                }
                host.plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .remove(digest)?;
            }
            _ => return Err(error("UNKNOWN_COMMAND", "未知公共命令")),
        }
    }
    emit_snapshot(&app, &host);
    Ok(Value::Null)
}
#[tauri::command]
pub fn report_result(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    request: ResultRequest,
) -> AppResult<()> {
    role(&window, &["display"])?;
    host.coordinator.result(request)?;
    emit_snapshot(&app, &host);
    Ok(())
}
#[tauri::command]
pub fn prepare_task(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    request: ResultRequest,
    input: Value,
) -> AppResult<()> {
    role(&window, &["display"])?;
    host.coordinator.prepare(request, input)?;
    emit_snapshot(&app, &host);
    Ok(())
}
#[tauri::command]
pub fn plugin_service(
    window: WebviewWindow,
    host: tauri::State<'_, Host>,
    request: ResultRequest,
    method: String,
    params: Value,
) -> AppResult<Value> {
    role(&window, &["display"])?;
    if serde_json::to_vec(&params)
        .map_err(|e| error("VALIDATION_FAILED", e))?
        .len()
        > 65536
    {
        return Err(error("MESSAGE_LIMIT", "消息过大"));
    }
    match method.as_str() {
        "units.complete" => {
            host.coordinator.unit_done(
                &request,
                params["index"]
                    .as_u64()
                    .filter(|n| *n < 100)
                    .ok_or_else(|| error("INVALID_UNIT", "份数索引错误"))? as u32,
            )?;
            Ok(Value::Null)
        }
        "storage.get" => host
            .coordinator
            .storage(&request, text(&params, "key")?, None),
        "storage.set" => host.coordinator.storage(
            &request,
            text(&params, "key")?,
            Some(params["value"].clone()),
        ),
        "assets.resolve" => {
            let s = host.coordinator.snapshot(false)?;
            let t = s.current.ok_or_else(|| error("STALE_TASK", "无当前任务"))?;
            if t.id != request.task_id || t.epoch != request.epoch || t.instance != request.instance
            {
                return Err(error("STALE_TASK", "过期任务"));
            }
            if !t
                .plugin
                .manifest
                .permissions
                .iter()
                .any(|p| p == "assets.own")
            {
                return Err(error("FORBIDDEN", "无资源权限"));
            }
            Ok(json!(
                host.plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .asset(&t.plugin.digest, text(&params, "path")?)?
            ))
        }
        _ => Err(error("FORBIDDEN_SERVICE", "服务未授权")),
    }
}

/// Session services remain instance/capability bound, even when no task is running.
#[tauri::command]
pub fn session_service(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    instance: String,
    method: String,
    params: Value,
) -> AppResult<Value> {
    role(&window, &["display"])?;
    if serde_json::to_vec(&params)
        .map_err(|e| error("VALIDATION_FAILED", e))?
        .len()
        > 65536
    {
        return Err(error("MESSAGE_LIMIT", "消息过大"));
    }
    match method.as_str() {
        "diagnostics.report" => {
            host.coordinator
                .session_plugin(&instance, "preview.frames.v1")?;
            if serde_json::to_vec(&params)
                .map_err(|e| error("VALIDATION_FAILED", e))?
                .len()
                > 4096
            {
                return Err(error("MESSAGE_LIMIT", "诊断数据超限"));
            }
            let mut at = host
                .metrics_at
                .lock()
                .map_err(|_| error("STATE_UNAVAILABLE", "诊断锁错误"))?;
            if at.elapsed().as_millis() >= 1000 {
                *at = std::time::Instant::now();
                app.emit_to("control", "render-metrics", params["metrics"].clone())
                    .map_err(|e| error("METRICS_ERROR", e))?;
            }
            Ok(Value::Null)
        }
        "session.interrupt" => {
            host.coordinator.session_plugin(&instance, "session.v1")?;
            host.coordinator.display_lost()?;
            emit_snapshot(&app, &host);
            Ok(Value::Null)
        }
        "preferences.get" => host
            .coordinator
            .preferences(&instance, text(&params, "key")?, None),
        "preferences.set" => host.coordinator.preferences(
            &instance,
            text(&params, "key")?,
            Some(params["value"].clone()),
        ),
        "media.resolve" => {
            let p = host.coordinator.session_plugin(&instance, "media.own.v1")?;
            Ok(json!(
                host.media.resolve(&p.digest, text(&params, "reference")?)?
            ))
        }
        "assets.resolve" => {
            let p = host.coordinator.session_plugin(&instance, "session.v1")?;
            if !p.manifest.permissions.iter().any(|p| p == "assets.own") {
                return Err(error("FORBIDDEN", "无资源权限"));
            }
            Ok(json!(
                host.plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .asset(&p.digest, text(&params, "path")?)?
            ))
        }
        _ => Err(error("FORBIDDEN_SERVICE", "服务未授权")),
    }
}
#[tauri::command]
pub fn preview_frame(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    instance: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    role(&window, &["display"])?;
    host.coordinator
        .session_plugin(&instance, "preview.frames.v1")?;
    if bytes.len() > 262144 || !bytes.starts_with(&[255, 216, 255]) {
        return Err(error("FRAME_LIMIT", "预览帧错误"));
    }
    play_runtime::media::validate_preview(&bytes)?;
    let mut last = host
        .preview_at
        .lock()
        .map_err(|_| error("STATE_UNAVAILABLE", "预览锁错误"))?;
    if last.elapsed().as_millis() < 200 {
        return Ok(());
    }
    *last = std::time::Instant::now();
    app.emit_to("control", "preview-frame", bytes)
        .map_err(|e| error("PREVIEW_ERROR", e))?;
    Ok(())
}

#[tauri::command]
pub fn import_media(
    window: WebviewWindow,
    host: tauri::State<'_, Host>,
    bytes: Vec<u8>,
    expected_digest: Option<String>,
) -> AppResult<String> {
    role(&window, &["control"])?;
    let s = host.coordinator.snapshot(false)?;
    let p = s
        .active
        .ok_or_else(|| error("PLUGIN_NOT_SELECTED", "先启用玩法"))?;
    if expected_digest.is_some_and(|expected| expected != p.digest) {
        return Err(error("STALE_CONTROL", "操作台对应的玩法已切换"));
    }
    if !p.manifest.capabilities.iter().any(|c| c == "media.own.v1") {
        return Err(error("FORBIDDEN", "无媒体能力"));
    }
    host.media.import(&p.digest, &bytes)
}
/// Called by the trusted control surface only after explicit user review of the PNG.
#[tauri::command]
pub async fn export_png(window: WebviewWindow, app: AppHandle, bytes: Vec<u8>) -> AppResult<()> {
    role(&window, &["control"])?;
    if bytes.len() > 2097152 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(error("EXPORT_LIMIT", "无效的 PNG"));
    }
    play_runtime::media::validate_export(&bytes)?;
    tauri::async_runtime::spawn_blocking(move || -> AppResult<()> {
        use tauri_plugin_dialog::DialogExt;
        if let Some(file) = app
            .dialog()
            .file()
            .add_filter("PNG", &["png"])
            .set_file_name("rules.png")
            .blocking_save_file()
        {
            let path = file.into_path().map_err(|e| error("EXPORT_ERROR", e))?;
            std::fs::write(path, bytes).map_err(|e| error("EXPORT_ERROR", e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| error("EXPORT_ERROR", e))?
}

#[tauri::command]
pub fn export_preview(
    window: WebviewWindow,
    app: AppHandle,
    host: tauri::State<'_, Host>,
    instance: String,
    bytes: Vec<u8>,
) -> AppResult<()> {
    role(&window, &["display"])?;
    host.coordinator
        .session_plugin(&instance, "export.png.v1")?;
    if bytes.len() > 2097152 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(error("EXPORT_LIMIT", "无效的 PNG"));
    }
    play_runtime::media::validate_export(&bytes)?;
    app.emit_to("control", "export-png", bytes)
        .map_err(|e| error("EXPORT_ERROR", e))?;
    Ok(())
}

#[tauri::command]
pub fn snapshot_changes(
    window: WebviewWindow,
    host: tauri::State<'_, Host>,
    version: u64,
    session: String,
) -> AppResult<Option<Snapshot>> {
    role(&window, &["control", "display"])?;
    if !host.coordinator.changed(version, &session)? {
        return Ok(None);
    }
    Ok(Some(
        host.coordinator.snapshot(window.label() == "control")?,
    ))
}
