use play_contracts::{AppError, AppResult};

/// Tauri's convertFileSrc can percent-encode the structural control separator.
/// Accept only the two exact document routes; never interpret arbitrary file paths.
pub fn document_route(path: &str) -> AppResult<(&str, bool)> {
    let path = path.strip_prefix('/').unwrap_or(path);
    let control_digest = path
        .strip_suffix("/control")
        .or_else(|| path.strip_suffix("%2Fcontrol"))
        .or_else(|| path.strip_suffix("%2fcontrol"));
    let digest = control_digest.unwrap_or(path);
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::new("INVALID_PLUGIN_ROUTE", "无效的玩法文档路径"));
    }
    Ok((digest, control_digest.is_some()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_tauri_encoded_and_structural_control_routes() {
        let digest = "a".repeat(64);
        assert_eq!(
            document_route(&format!("/{digest}")).unwrap(),
            (digest.as_str(), false)
        );
        for suffix in ["/control", "%2Fcontrol", "%2fcontrol"] {
            assert_eq!(
                document_route(&format!("/{digest}{suffix}")).unwrap(),
                (digest.as_str(), true)
            );
        }
    }

    #[test]
    fn rejects_non_document_paths() {
        let digest = "a".repeat(64);
        for path in [
            String::new(),
            "../control".into(),
            format!("/{digest}/other"),
            format!("/{digest}%252Fcontrol"),
            format!("/{digest}/control/extra"),
            format!("/{digest}%2F..%2Fcontrol"),
        ] {
            assert!(document_route(&path).is_err(), "accepted {path}");
        }
    }
}
