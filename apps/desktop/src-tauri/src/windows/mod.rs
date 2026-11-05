use tauri::{AppHandle, Manager};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct ControlPlacement {
    x: i32,
    y: i32,
    width: f64,
    height: f64,
    maximized: bool,
}
pub struct ControlWindowState(pub std::sync::Mutex<ControlPlacement>);

/// Restore logical size on a currently connected display; never trust stale off-screen coordinates.
pub fn restore_control(app: &AppHandle) {
    let Some(window) = app.get_webview_window("control") else {
        return;
    };
    let saved = app
        .path()
        .app_data_dir()
        .ok()
        .and_then(|p| std::fs::read(p.join("control-window.json")).ok())
        .and_then(|b| serde_json::from_slice::<ControlPlacement>(&b).ok())
        .filter(|p| p.width.is_finite() && p.height.is_finite() && p.width > 0.0 && p.height > 0.0);
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = saved
        .as_ref()
        .and_then(|p| {
            monitors.iter().find(|m| {
                let a = m.work_area();
                p.x >= a.position.x
                    && p.y >= a.position.y
                    && i64::from(p.x) < i64::from(a.position.x) + i64::from(a.size.width)
                    && i64::from(p.y) < i64::from(a.position.y) + i64::from(a.size.height)
            })
        })
        .or_else(|| monitors.first());
    let mut placement = saved.clone().unwrap_or(ControlPlacement {
        x: 0,
        y: 0,
        width: 1280.0,
        height: 800.0,
        maximized: false,
    });
    if let Some(monitor) = monitor {
        let area = monitor.work_area();
        let scale = monitor.scale_factor();
        // Measure decorations in logical pixels, then apply the target monitor's DPI.
        let (frame_width, frame_height) = window
            .outer_size()
            .ok()
            .zip(window.inner_size().ok())
            .zip(window.scale_factor().ok())
            .map(|((outer, inner), current_scale)| {
                (
                    f64::from(outer.width.saturating_sub(inner.width)) / current_scale,
                    f64::from(outer.height.saturating_sub(inner.height)) / current_scale,
                )
            })
            .unwrap_or((16.0, 48.0));
        let max_width = (f64::from(area.size.width) / scale - frame_width).max(100.0);
        let max_height = (f64::from(area.size.height) / scale - frame_height).max(100.0);
        placement.width = placement.width.clamp(720.0_f64.min(max_width), max_width);
        placement.height = placement
            .height
            .clamp(560.0_f64.min(max_height), max_height);
        let right = area.position.x.saturating_add(
            area.size
                .width
                .saturating_sub(((placement.width + frame_width) * scale).ceil() as u32)
                as i32,
        );
        let bottom = area.position.y.saturating_add(
            area.size
                .height
                .saturating_sub(((placement.height + frame_height) * scale).ceil() as u32)
                as i32,
        );
        if saved.is_none() {
            placement.x = area.position.x + (right - area.position.x) / 2;
            placement.y = area.position.y + (bottom - area.position.y) / 2;
        } else {
            placement.x = placement
                .x
                .clamp(area.position.x, right.max(area.position.x));
            placement.y = placement
                .y
                .clamp(area.position.y, bottom.max(area.position.y));
        }
        let _ = window.set_size(tauri::LogicalSize::new(placement.width, placement.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(placement.x, placement.y));
    }
    if placement.maximized {
        let _ = window.maximize();
    }
    app.manage(ControlWindowState(std::sync::Mutex::new(placement)));
}

/// Keep geometry in memory during dragging, and only persist on application close.
pub fn track_control(window: &tauri::Window, save: bool) {
    let Some(state) = window.app_handle().try_state::<ControlWindowState>() else {
        return;
    };
    let Ok(mut placement) = state.0.lock() else {
        return;
    };
    placement.maximized = window.is_maximized().unwrap_or(false);
    if !placement.maximized
        && !window.is_minimized().unwrap_or(false)
        && let (Ok(size), Ok(position), Ok(scale)) = (
            window.inner_size(),
            window.outer_position(),
            window.scale_factor(),
        )
    {
        let logical = size.to_logical::<f64>(scale);
        if logical.width >= 100.0 && logical.height >= 100.0 {
            placement.width = logical.width;
            placement.height = logical.height;
            placement.x = position.x;
            placement.y = position.y;
        }
    }
    if save
        && let Ok(data) = window.app_handle().path().app_data_dir()
        && let Ok(bytes) = serde_json::to_vec(&*placement)
    {
        let _ = std::fs::write(data.join("control-window.json"), bytes);
    }
}
