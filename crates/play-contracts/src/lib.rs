use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

pub const API_VERSION: &str = "1";
pub const HOST_VERSION: &str = "0.2.3";

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
    #[serde(default, rename = "controlEntry")]
    pub control_entry: Option<String>,
    #[serde(rename = "configSchema")]
    pub config_schema: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: String,
    #[serde(rename = "stateSchemaVersion")]
    pub state_schema_version: u32,
    pub permissions: Vec<String>,
    pub publisher: String,
    #[serde(default)]
    pub examples: Option<String>,
    #[serde(default, rename = "capabilities")]
    pub capabilities: Vec<String>,
    #[serde(default, rename = "planSchema")]
    pub plan_schema: Option<String>,
    #[serde(default, rename = "presentationSchema")]
    pub presentation_schema: Option<String>,
    #[serde(default, rename = "workUnitsField")]
    pub work_units_field: Option<String>,
    #[serde(default, rename = "workUnitsSelectorField")]
    pub work_units_selector_field: Option<String>,
    #[serde(default, rename = "workUnitsRulesField")]
    pub work_units_rules_field: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct PluginExample {
    pub name: String,
    #[ts(type = "Record<string, unknown>")]
    pub input: Value,
}
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct PluginInfo {
    #[serde(default)]
    pub examples: Vec<PluginExample>,
    pub manifest: PluginManifest,
    pub digest: String,
    #[ts(type = "Record<string, unknown>")]
    pub input_schema: Value,
    #[ts(type = "Record<string, unknown>")]
    pub config_schema: Value,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null")]
    pub plan_schema: Option<Value>,
    #[serde(default)]
    #[ts(type = "Record<string, unknown> | null")]
    pub presentation_schema: Option<Value>,
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
    #[ts(type = "Record<string, unknown> | null")]
    pub plan: Option<Value>,
    pub work_units: u32,
    pub completed_units: u32,
    pub source: InputSource,
    pub priority: u8,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number | null")]
    pub finished_at: Option<u64>,
    #[ts(type = "number[]")]
    pub unit_completed_at: Vec<u64>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
#[serde(rename_all = "snake_case")]
pub enum InputSource {
    Manual,
    Demo,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../packages/plugin-sdk/src/generated/")]
pub struct Snapshot {
    #[ts(type = "number")]
    pub version: u64,
    pub session_id: String,
    pub paused: bool,
    pub display_ready: bool,
    pub demo_enabled: bool,
    pub demo_interval: u32,
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub presentation: Value,
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
