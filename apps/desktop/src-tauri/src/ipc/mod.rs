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
    args: Value,
) -> AppResult<Value> {
    if name == "register_display" {
        role(&window, &["display"])?;
        host.coordinator
            .register_display(text(&args, "instance")?.into())?;
    } else {
        role(&window, &["control"])?;
        match name.as_str() {
            "diagnostics" => {
                let messages = host
                    .plugins
                    .lock()
                    .map_err(|_| error("STATE_UNAVAILABLE", "插件锁错误"))?
                    .diagnostics()?;
                return Ok(json!(messages));
            }
            "submit" => {
                let r: SubmitRequest =
                    serde_json::from_value(args).map_err(|e| error("VALIDATION_FAILED", e))?;
                host.coordinator.submit(r)?;
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
