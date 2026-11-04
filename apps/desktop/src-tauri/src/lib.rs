mod ipc;
mod windows;
use play_contracts::*;
use play_runtime::{
    Coordinator,
    coordinator::SqliteStore,
    plugins::{PluginManager, hash},
};
use std::sync::Mutex;
use tauri::{Manager, WindowEvent};

pub struct Host {
    pub coordinator: Coordinator,
    pub plugins: Mutex<PluginManager>,
    _instance_lock: std::fs::File,
}
pub const REGISTRY: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../plugins/registry/dist/plugin.lbplug"
));
pub const WORKSHOP: &[u8] = include_bytes!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../plugins/workshop-2d/dist/plugin.lbplug"
));
pub fn run() {
    // Tauri can inject its bridge into subframes. Window labels alone are insufficient.
    let host_token = play_runtime::coordinator::new_id();
    let initialization = format!(
        "if (window === window.top && ['tauri://localhost','http://tauri.localhost','https://tauri.localhost','http://127.0.0.1:5173'].includes(location.protocol + '//' + location.host)) {{ Object.defineProperty(window, '__LIKEBOOM_HOST_TOKEN__', {{value: {host_token:?}, writable: false, configurable: false}}); }}"
    );
    let commands: Box<dyn Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync> =
        Box::new(tauri::generate_handler![
            ipc::snapshot,
            ipc::plugins,
            ipc::host_command,
            ipc::report_result,
            ipc::prepare_task,
            ipc::plugin_service
        ]);
    tauri::Builder::default()
        .append_invoke_initialization_script(initialization)
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let instance_lock = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(data.join("instance.lock"))?;
            instance_lock
                .try_lock()
                .map_err(|_| std::io::Error::other("LikeBoom 已在运行"))?;
            let plugins = PluginManager::new(
                data.join("plugins"),
                cfg!(debug_assertions)
                    && std::env::var("LIKEBOOM_ALLOW_UNSIGNED").as_deref() == Ok("1"),
                vec![hash(REGISTRY), hash(WORKSHOP)],
            )?;
            let first = plugins.install(REGISTRY)?;
            plugins.install(WORKSHOP)?;
            let first_run = !data.join("likeboom.sqlite").exists();
            let coordinator =
                Coordinator::new(Box::new(SqliteStore::open(&data.join("likeboom.sqlite"))?))?;
            if first_run {
                coordinator.activate(Some(first), serde_json::json!({"duration":4}))?;
            }
            app.manage(Host {
                coordinator,
                plugins: Mutex::new(plugins),
                _instance_lock: instance_lock,
            });
            Ok(())
        })
        .register_uri_scheme_protocol("lbplugin", |context, request| {
            // This scheme serves only verified, installed HTML documents to the display WebView.
            let result = (|| -> AppResult<String> {
                if context.webview_label() != "display" {
                    return Err(AppError::new("FORBIDDEN", "只允许展示窗口"));
                }
                let digest = request.uri().path().trim_start_matches('/');
                let host = context.app_handle().state::<Host>();
                let snapshot = host.coordinator.snapshot(false)?;
                if snapshot.active.as_ref().is_none_or(|p| p.digest != digest) {
                    return Err(AppError::new("FORBIDDEN", "非当前插件"));
                }
                host.plugins
                    .lock()
                    .map_err(|_| AppError::new("STATE_UNAVAILABLE", "插件锁错误"))?
                    .document(digest)
            })();
            let (status, body) = match result {
                Ok(html) => (200, html),
                Err(_) => (403, "Plugin unavailable".into()),
            };
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "text/html; charset=utf-8")
                .header("Cache-Control", "no-store")
                .header("X-Content-Type-Options", "nosniff")
                .body(body.into_bytes())
                .expect("static HTTP response")
        })
        .on_window_event(|window, event| {
            if window.label() == "control" && matches!(event, WindowEvent::CloseRequested { .. }) {
                let app = window.app_handle();
                if let Some(host) = app.try_state::<Host>() {
                    let _ = host.coordinator.display_lost();
                }
                app.exit(0);
            }
            if window.label() == "display" && matches!(event, WindowEvent::Destroyed) {
                let app = window.app_handle();
                if let Some(host) = app.try_state::<Host>() {
                    let _ = host.coordinator.display_lost();
                    ipc::emit_snapshot(app, &host);
                }
            }
        })
        .invoke_handler(move |invoke| {
            if invoke
                .message
                .headers()
                .get("x-likeboom-host")
                .and_then(|v| v.to_str().ok())
                != Some(host_token.as_str())
            {
                invoke
                    .resolver
                    .reject(AppError::new("FORBIDDEN", "仅允许可信顶层宿主调用"));
                return true;
            }
            commands(invoke)
        })
        .run(tauri::generate_context!())
        .expect("LikeBoom 启动失败");
}
