//! Host-owned media. Only explicit PNG/JPEG imports; plugins see content references, never paths.
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{ImageFormat, ImageReader, Limits};
use play_contracts::{AppError, AppResult};
use std::{io::Cursor, path::PathBuf};

pub struct MediaStore(pub PathBuf);
fn fail(e: impl ToString) -> AppError {
    AppError::new("MEDIA_ERROR", e)
}
fn safe_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|c| c.is_ascii_hexdigit())
}
impl MediaStore {
    fn directory(&self, owner: &str) -> AppResult<PathBuf> {
        if !safe_hex(owner) {
            return Err(fail("无效的插件摘要"));
        }
        Ok(self.0.join(owner))
    }
    pub fn import(&self, owner: &str, bytes: &[u8]) -> AppResult<String> {
        if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
            return Err(fail("图片最大 8 MiB"));
        }
        let mut reader = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(fail)?;
        if !matches!(reader.format(), Some(ImageFormat::Png | ImageFormat::Jpeg)) {
            return Err(fail("只支持 PNG/JPEG"));
        }
        let mut limits = Limits::default();
        limits.max_image_width = Some(4096);
        limits.max_image_height = Some(4096);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let image = reader.decode().map_err(fail)?.thumbnail(512, 512);
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, ImageFormat::Png).map_err(fail)?;
        let data = out.into_inner();
        let key = crate::plugins::hash(&data);
        let dir = self.directory(owner)?;
        std::fs::create_dir_all(&dir).map_err(fail)?;
        let target = dir.join(format!("{key}.png"));
        if target.exists() {
            return Ok(format!("media:{key}"));
        }
        let count = std::fs::read_dir(&dir)
            .map_err(fail)?
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|s| s == "png"))
            .count();
        if count >= 200 {
            return Err(fail("该插件最多保留 200 张导入图片，请清理无引用图片"));
        }
        let used: u64 = std::fs::read_dir(&dir)
            .map_err(fail)?
            .filter_map(Result::ok)
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum();
        if used + data.len() as u64 > 200 * 1024 * 1024 {
            return Err(fail("该插件媒体超过 200 MiB，请清理无引用图片"));
        }
        let target = dir.join(format!("{key}.png"));
        if !target.exists() {
            let tmp = dir.join(format!("{key}.tmp"));
            std::fs::write(&tmp, &data).map_err(fail)?;
            std::fs::rename(tmp, target).map_err(fail)?;
        }
        Ok(format!("media:{key}"))
    }
    pub fn resolve(&self, owner: &str, reference: &str) -> AppResult<String> {
        let key = reference
            .strip_prefix("media:")
            .filter(|s| safe_hex(s))
            .ok_or_else(|| fail("无效的媒体引用"))?;
        let path = self.directory(owner)?.join(format!("{key}.png"));
        if std::fs::metadata(&path).map_err(fail)?.len() > 8 * 1024 * 1024 {
            return Err(fail("媒体超限"));
        }
        let bytes = std::fs::read(path).map_err(fail)?;
        if crate::plugins::hash(&bytes) != key {
            return Err(fail("媒体摘要不匹配"));
        }
        Ok(format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    }
    pub fn list(&self, owner: &str) -> AppResult<Vec<(String, u64)>> {
        let dir = self.directory(owner)?;
        if !dir.exists() {
            return Ok(vec![]);
        }
        let mut out = vec![];
        for entry in std::fs::read_dir(dir).map_err(fail)? {
            let entry = entry.map_err(fail)?;
            let path = entry.path();
            if path.extension().is_some_and(|s| s == "png") {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                if safe_hex(stem) {
                    out.push((
                        format!("media:{stem}"),
                        entry.metadata().map_err(fail)?.len(),
                    ));
                }
            }
        }
        out.sort();
        Ok(out)
    }
    pub fn remove(&self, owner: &str, reference: &str) -> AppResult<()> {
        let key = reference
            .strip_prefix("media:")
            .filter(|s| safe_hex(s))
            .ok_or_else(|| fail("无效媒体引用"))?;
        std::fs::remove_file(self.directory(owner)?.join(format!("{key}.png"))).map_err(fail)
    }
}

/// Frames/exports have their own quotas; never relax the normal 64 KiB service limit.
pub fn validate_image(
    bytes: &[u8],
    format: ImageFormat,
    width: u32,
    height: u32,
    max_bytes: usize,
) -> AppResult<()> {
    if bytes.len() > max_bytes {
        return Err(fail("图像消息超限"));
    }
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = Limits::default();
    limits.max_image_width = Some(width);
    limits.max_image_height = Some(height);
    limits.max_alloc = Some(32 * 1024 * 1024);
    reader.limits(limits);
    reader.decode().map_err(fail)?;
    Ok(())
}
pub fn validate_preview(bytes: &[u8]) -> AppResult<()> {
    validate_image(bytes, ImageFormat::Jpeg, 640, 360, 262144)
}
pub fn validate_export(bytes: &[u8]) -> AppResult<()> {
    validate_image(bytes, ImageFormat::Png, 2048, 2048, 2097152)
}
