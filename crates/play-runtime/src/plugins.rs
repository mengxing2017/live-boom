use crate::schema;
use base64::{Engine, engine::general_purpose::STANDARD};
use play_contracts::{
    API_VERSION, AppError, AppResult, HOST_VERSION, PluginExample, PluginInfo, PluginManifest,
};
use ring::{digest, signature};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

const MAX_PACKAGE: usize = 200 * 1024 * 1024;
const MAX_FILES: usize = 2000;
fn unique_map<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<String, String>, D::Error> {
    struct Unique;
    impl<'de> serde::de::Visitor<'de> for Unique {
        type Value = BTreeMap<String, String>;
        fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
            f.write_str("a map without duplicate paths")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut result = BTreeMap::new();
            while let Some((key, value)) = map.next_entry::<String, String>()? {
                if result.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("duplicate package path"));
                }
            }
            Ok(result)
        }
    }
    deserializer.deserialize_map(Unique)
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bundle {
    pub format: String,
    #[serde(deserialize_with = "unique_map")]
    pub files: BTreeMap<String, String>,
    #[serde(deserialize_with = "unique_map")]
    pub integrity: BTreeMap<String, String>,
    pub signature: Option<Signature>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signature {
    pub publisher: String,
    pub value: String,
}
#[derive(Clone)]
pub struct Verified {
    pub info: PluginInfo,
    pub files: BTreeMap<String, Vec<u8>>,
}
pub struct PluginManager {
    root: PathBuf,
    trusted: BTreeMap<String, String>,
    builtins: Vec<String>,
    allow_unsigned: bool,
}
fn error(code: &str, message: impl ToString) -> AppError {
    AppError::new(code, message)
}
pub fn hash(bytes: &[u8]) -> String {
    digest::digest(&digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn io(e: impl ToString) -> AppError {
    error("PLUGIN_STORAGE", e)
}
fn safe_path(path: &str) -> bool {
    !path.is_empty()
        && path.len() <= 240
        && path.split('/').all(|p| {
            !p.is_empty()
                && p != "."
                && p != ".."
                && p.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
}
impl PluginManager {
    pub fn new(root: PathBuf, allow_unsigned: bool, builtins: Vec<String>) -> AppResult<Self> {
        fs::create_dir_all(&root).map_err(io)?;
        if !root.join("trusted.json").exists() && root.join("trusted.json.old").exists() {
            fs::rename(root.join("trusted.json.old"), root.join("trusted.json")).map_err(io)?;
        }
        let trusted = if root.join("trusted.json").exists() {
            serde_json::from_slice(&fs::read(root.join("trusted.json")).map_err(io)?).map_err(io)?
        } else {
            BTreeMap::new()
        };
        Ok(Self {
            root,
            trusted,
            builtins,
            allow_unsigned,
        })
    }
    pub fn trust(&mut self, publisher: String, public_key: String) -> AppResult<String> {
        let bytes = STANDARD.decode(&public_key).map_err(io)?;
        if bytes.len() != 32 || publisher.is_empty() || publisher.len() > 100 {
            return Err(error("INVALID_KEY", "发布者或 Ed25519 公钥错误"));
        }
        let mut next = self.trusted.clone();
        next.insert(publisher, public_key);
        fs::write(
            self.root.join("trusted.json.tmp"),
            serde_json::to_vec(&next).map_err(io)?,
        )
        .map_err(io)?;
        // Windows rename cannot replace an existing target; retain a recoverable previous file.
        let target = self.root.join("trusted.json");
        let backup = self.root.join("trusted.json.old");
        if backup.exists() {
            fs::remove_file(&backup).map_err(io)?;
        }
        if target.exists() {
            fs::rename(&target, &backup).map_err(io)?;
        }
        if let Err(e) = fs::rename(self.root.join("trusted.json.tmp"), &target) {
            if backup.exists() {
                let _ = fs::rename(&backup, &target);
            }
            return Err(io(e));
        }
        self.trusted = next;
        Ok(hash(&bytes))
    }
    pub fn verify(&self, bytes: &[u8]) -> AppResult<Verified> {
        if bytes.len() > MAX_PACKAGE {
            return Err(error("PACKAGE_LIMIT", "插件包超过 200 MiB"));
        }
        let bundle: Bundle =
            serde_json::from_slice(bytes).map_err(|e| error("INVALID_PACKAGE", e))?;
        if bundle.format != "liveboom.plugin.v1"
            || bundle.files.len() > MAX_FILES
            || bundle.files.len() != bundle.integrity.len()
        {
            return Err(error("INVALID_PACKAGE", "包格式或文件清单错误"));
        }
        let mut files = BTreeMap::new();
        let mut total = 0;
        for (path, value) in &bundle.files {
            if !safe_path(path) {
                return Err(error("UNSAFE_PATH", path));
            }
            let content = STANDARD
                .decode(value)
                .map_err(|_| error("INVALID_PACKAGE", "base64 错误"))?;
            total += content.len();
            if total > 500 * 1024 * 1024 {
                return Err(error("PACKAGE_LIMIT", "解码资源超过限制"));
            }
            if bundle.integrity.get(path) != Some(&hash(&content)) {
                return Err(error("INTEGRITY_FAILED", path));
            }
            files.insert(path.clone(), content);
        }
        let manifest: PluginManifest = serde_json::from_slice(
            files
                .get("manifest.json")
                .ok_or_else(|| error("INVALID_PACKAGE", "缺少 manifest"))?,
        )
        .map_err(io)?;
        if manifest.id.len() > 100
            || !manifest.id.contains('.')
            || !manifest
                .id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b".-_".contains(&c))
            || manifest.name.is_empty()
            || manifest.name.len() > 200
            || manifest.publisher.is_empty()
            || manifest.publisher.len() > 100
            || manifest.state_schema_version == 0
        {
            return Err(error("INVALID_MANIFEST", "id/name 错误"));
        }
        if manifest.sdk_api != API_VERSION
            || !semver::VersionReq::parse(&if manifest.host_version.contains(',') {
                manifest.host_version.clone()
            } else {
                manifest
                    .host_version
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(", ")
            })
            .map_err(io)?
            .matches(&semver::Version::parse(HOST_VERSION).map_err(io)?)
        {
            return Err(error("INCOMPATIBLE_API", "宿主或 SDK 版本不兼容"));
        }
        semver::Version::parse(&manifest.version).map_err(io)?;
        const CAPABILITIES: &[&str] = &[
            "plan.v1",
            "session.v1",
            "presentation.v1",
            "preferences.own.v1",
            "media.own.v1",
            "audio.own.v1",
            "preview.frames.v1",
            "export.png.v1",
            "control.v1",
            "control.viewport.v1",
        ];
        if manifest
            .capabilities
            .iter()
            .any(|c| !CAPABILITIES.contains(&c.as_str()))
        {
            return Err(error("INCOMPATIBLE_CAPABILITY", "未知能力"));
        }
        for path in [
            &manifest.plan_schema,
            &manifest.presentation_schema,
            &manifest.examples,
            &manifest.control_entry,
        ]
        .into_iter()
        .flatten()
        {
            if !safe_path(path) || !files.contains_key(path) {
                return Err(error("INVALID_MANIFEST", "扩展 schema 不存在"));
            }
        }
        if manifest.capabilities.iter().any(|c| c == "plan.v1") != manifest.plan_schema.is_some()
            || manifest.capabilities.iter().any(|c| c == "presentation.v1")
                != manifest.presentation_schema.is_some()
            || manifest.capabilities.iter().any(|c| c == "control.v1")
                != manifest.control_entry.is_some()
        {
            return Err(error("INVALID_MANIFEST", "能力与 schema 不匹配"));
        }
        if manifest
            .capabilities
            .iter()
            .any(|c| c == "control.viewport.v1")
            != manifest.capabilities.iter().any(|c| c == "control.v1")
        {
            return Err(error(
                "INVALID_MANIFEST",
                "操作台必须同时声明 control.v1 和 control.viewport.v1",
            ));
        }
        if manifest.work_units_selector_field.is_some() != manifest.work_units_rules_field.is_some()
            || (manifest.work_units_selector_field.is_some() && manifest.work_units_field.is_none())
        {
            return Err(error("INVALID_MANIFEST", "规则工作量声明不完整"));
        }
        let permissions = [
            "task.current.read",
            "task.result.report",
            "storage.own",
            "assets.own",
        ];
        if manifest
            .permissions
            .iter()
            .any(|p| !permissions.contains(&p.as_str()))
            || !["task.current.read", "task.result.report"]
                .iter()
                .all(|required| manifest.permissions.iter().any(|p| p == required))
        {
            return Err(error(
                "INVALID_PERMISSION",
                "未知权限或缺少任务读取/结果回报权限",
            ));
        }
        for path in [
            &manifest.entry,
            &manifest.input_schema,
            &manifest.config_schema,
        ] {
            if !safe_path(path) || !files.contains_key(path) {
                return Err(error("INVALID_MANIFEST", "入口/schema 不存在"));
            }
        }
        if !self.builtins.contains(&hash(bytes)) {
            match &bundle.signature {
                Some(s) => {
                    if s.publisher != manifest.publisher {
                        return Err(error("INVALID_SIGNATURE", "发布者不匹配"));
                    }
                    let key = self
                        .trusted
                        .get(&s.publisher)
                        .ok_or_else(|| error("UNTRUSTED_PUBLISHER", &s.publisher))?;
                    signature::UnparsedPublicKey::new(
                        &signature::ED25519,
                        STANDARD.decode(key).map_err(io)?,
                    )
                    .verify(
                        &serde_json::to_vec(&bundle.integrity).map_err(io)?,
                        &STANDARD.decode(&s.value).map_err(io)?,
                    )
                    .map_err(|_| error("INVALID_SIGNATURE", "签名验证失败"))?;
                }
                None if self.allow_unsigned => {}
                None => return Err(error("UNSIGNED_PLUGIN", "正式模式拒绝未签名插件")),
            }
        }
        let input_schema: serde_json::Value =
            serde_json::from_slice(&files[&manifest.input_schema]).map_err(io)?;
        let config_schema: serde_json::Value =
            serde_json::from_slice(&files[&manifest.config_schema]).map_err(io)?;
        if input_schema["type"] != "object" || config_schema["type"] != "object" {
            return Err(error(
                "INVALID_SCHEMA",
                "输入和配置的根 schema 必须是 object",
            ));
        }
        schema::check_schema(&input_schema)?;
        schema::check_schema(&config_schema)?;
        let read_schema = |path: &Option<String>| -> AppResult<Option<serde_json::Value>> {
            path.as_ref()
                .map(|p| {
                    let s = serde_json::from_slice(&files[p]).map_err(io)?;
                    schema::check_schema(&s)?;
                    Ok(s)
                })
                .transpose()
        };
        let examples: Vec<PluginExample> = manifest
            .examples
            .as_ref()
            .map(|p| serde_json::from_slice(&files[p]).map_err(io))
            .transpose()?
            .unwrap_or_default();
        if examples.len() > 12 {
            return Err(error("INVALID_MANIFEST", "最多 12 个输入模板"));
        }
        for example in &examples {
            if example.name.is_empty() || example.name.chars().count() > 32 {
                return Err(error("INVALID_MANIFEST", "输入模板名称错误"));
            }
            schema::validate(&input_schema, &example.input)?;
        }
        let plan_schema = read_schema(&manifest.plan_schema)?;
        let presentation_schema = read_schema(&manifest.presentation_schema)?;
        if let Some(field) = &manifest.work_units_field {
            let definition = &input_schema["properties"][field];
            if definition["type"] != "integer"
                || definition["minimum"].as_u64().is_none_or(|n| n < 1)
                || definition["maximum"].as_u64().is_none_or(|n| n > 100)
            {
                return Err(error(
                    "INVALID_MANIFEST",
                    "工作量字段必须是 1–100 的有界整数",
                ));
            }
        }
        Ok(Verified {
            info: PluginInfo {
                manifest,
                examples,
                digest: hash(bytes),
                input_schema,
                config_schema,
                plan_schema,
                presentation_schema,
            },
            files,
        })
    }
    pub fn install(&self, bytes: &[u8]) -> AppResult<PluginInfo> {
        let verified = self.verify(bytes)?;
        let path = self.root.join(format!("{}.lbplug", verified.info.digest));
        for existing in self.list()? {
            if existing.manifest.id == verified.info.manifest.id
                && existing.manifest.version == verified.info.manifest.version
                && existing.digest != verified.info.digest
            {
                return Err(error("VERSION_CONFLICT", "相同 ID/版本的内容不同"));
            }
        }
        if !path.exists() {
            let temporary = path.with_extension("tmp");
            fs::write(&temporary, bytes).map_err(io)?;
            fs::rename(&temporary, &path).map_err(io)?;
        }
        Ok(verified.info)
    }
    pub fn diagnostics(&self) -> AppResult<Vec<String>> {
        let mut messages = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(io)? {
            let path = entry.map_err(io)?.path();
            if path.extension().and_then(|x| x.to_str()) == Some("lbplug") {
                let digest = path
                    .file_stem()
                    .and_then(|x| x.to_str())
                    .unwrap_or_default();
                if let Err(e) = self.load(digest) {
                    messages.push(format!("{digest}: {} - {}", e.code, e.message));
                }
            }
        }
        Ok(messages)
    }
    pub fn list(&self) -> AppResult<Vec<PluginInfo>> {
        let mut result = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(io)? {
            let path = entry.map_err(io)?.path();
            if path.extension().and_then(|x| x.to_str()) == Some("lbplug")
                && let Ok(plugin) = self.load(
                    path.file_stem()
                        .and_then(|x| x.to_str())
                        .unwrap_or_default(),
                )
            {
                result.push(plugin.info);
            }
        }
        result.sort_by(|a, b| {
            (&a.manifest.id, &a.manifest.version).cmp(&(&b.manifest.id, &b.manifest.version))
        });
        Ok(result)
    }
    pub fn load(&self, digest: &str) -> AppResult<Verified> {
        if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(error("INVALID_DIGEST", "摘要错误"));
        }
        let path = self.root.join(format!("{digest}.lbplug"));
        if fs::metadata(&path).map_err(io)?.len() > MAX_PACKAGE as u64 {
            return Err(error("PACKAGE_LIMIT", "插件过大"));
        }
        let bytes = fs::read(path).map_err(io)?;
        if hash(&bytes) != digest {
            return Err(error("INTEGRITY_FAILED", "已安装包被修改"));
        }
        self.verify(&bytes)
    }
    pub fn remove(&self, digest: &str) -> AppResult<()> {
        self.load(digest)?;
        fs::remove_file(self.root.join(format!("{digest}.lbplug"))).map_err(io)
    }
    pub fn import_file(&self, path: &Path) -> AppResult<PluginInfo> {
        if fs::metadata(path).map_err(io)?.len() > MAX_PACKAGE as u64 {
            return Err(error("PACKAGE_LIMIT", "插件过大"));
        }
        self.install(&fs::read(path).map_err(io)?)
    }
    pub fn document(&self, digest: &str) -> AppResult<String> {
        self.document_for(digest, false)
    }
    pub fn document_for(&self, digest: &str, control: bool) -> AppResult<String> {
        let plugin = self.load(digest)?;
        let entry = if control {
            plugin
                .info
                .manifest
                .control_entry
                .as_ref()
                .ok_or_else(|| error("FORBIDDEN_RESOURCE", "插件没有操作台入口"))?
        } else {
            &plugin.info.manifest.entry
        };
        let html = String::from_utf8(plugin.files[entry].clone()).map_err(io)?;
        // Opaque sandbox, scripts only, no network/subframes/host APIs. No eval.
        Ok(format!(
            "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">{html}"
        ))
    }
    pub fn asset(&self, digest: &str, path: &str) -> AppResult<String> {
        if !safe_path(path) || !path.starts_with("assets/") {
            return Err(error("FORBIDDEN_RESOURCE", "仅允许包内 assets"));
        }
        let plugin = self.load(digest)?;
        let bytes = plugin
            .files
            .get(path)
            .ok_or_else(|| error("RESOURCE_MISSING", path))?;
        if bytes.len() > 10 * 1024 * 1024 {
            return Err(error("RESOURCE_LIMIT", "资源过大"));
        }
        let mime = match Path::new(path).extension().and_then(|x| x.to_str()) {
            Some("png") => "image/png",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("mp3") => "audio/mpeg",
            Some("wav") => "audio/wav",
            _ => "application/octet-stream",
        };
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
    }
}
