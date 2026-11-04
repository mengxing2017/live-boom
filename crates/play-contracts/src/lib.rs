use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub const API_VERSION: &str = "1";
pub const HOST_VERSION: &str = "0.2.0";

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(rename = "sdkApi")]
    pub sdk_api: String,
    #[serde(rename = "hostVersion")]
    pub host_version: String,
    pub entry: String,
    #[serde(rename = "configSchema")]
    pub config_schema: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: String,
    #[serde(rename = "stateSchemaVersion")]
    pub state_schema_version: u32,
    pub permissions: Vec<String>,
    pub publisher: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct PluginInfo {
    pub manifest: PluginManifest,
    pub digest: String,
    #[ts(type = "Record<string, unknown>")]
    pub input_schema: Value,
    #[ts(type = "Record<string, unknown>")]
    pub config_schema: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct Task {
    pub id: String,
    pub plugin: PluginInfo,
    #[ts(type = "Record<string, unknown>")]
    pub input: Value,
    #[ts(type = "Record<string, unknown>")]
    pub config: Value,
    pub epoch: String,
    pub instance: String,
    pub status: TaskStatus,
    pub prepared: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct Snapshot {
    #[ts(type = "number")]
    pub version: u64,
    pub session_id: String,
    pub paused: bool,
    pub display_ready: bool,
    pub active: Option<PluginInfo>,
    #[ts(type = "Record<string, unknown>")]
    pub config: Value,
    pub current: Option<Task>,
    pub queue: Vec<Task>,
    pub history: Vec<Task>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct SubmitRequest {
    pub command_id: String,
    #[ts(type = "Record<string, unknown>")]
    pub input: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct ResultRequest {
    pub task_id: String,
    pub epoch: String,
    pub instance: String,
    pub status: TaskStatus,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}
impl std::error::Error for AppError {}
pub type AppResult<T> = Result<T, AppError>;
