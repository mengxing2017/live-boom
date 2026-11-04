use crate::schema;
use play_contracts::*;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::Mutex,
};
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn err(code: &str, message: impl ToString) -> AppError {
    AppError::new(code, message)
}
pub fn new_id() -> String {
    use ring::rand::{SecureRandom, SystemRandom};
    let mut bytes = [0u8; 16];
    SystemRandom::new()
        .fill(&mut bytes)
        .expect("operating system randomness unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub use crate::persistence::{MemoryStore, SqliteStore, StateStore};
#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
    #[serde(default)]
    source: InputSource,
    #[serde(default)]
    priority: u8,
    input: Value,
    task_id: String,
}
#[derive(Clone, Serialize, Deserialize)]
struct State {
    version: u64,
    session_id: String,
    paused: bool,
    display_instance: Option<String>,
    active: Option<PluginInfo>,
    config: Value,
    #[serde(default = "empty_object")]
    presentation: Value,
    current: Option<Task>,
    queue: VecDeque<Task>,
    history: Vec<Task>,
    receipts: BTreeMap<String, Receipt>,
    namespaces: BTreeMap<String, Value>,
    #[serde(default)]
    demo: DemoPolicy,
    #[serde(default)]
    migration_audit: Vec<Value>,
    #[serde(default)]
    priority_streak: u8,
}
#[derive(Clone, Default, Serialize, Deserialize)]
struct DemoPolicy {
    enabled: bool,
    interval: u32,
    input: Value,
}
fn empty_object() -> Value {
    json!({})
}
impl Default for State {
    fn default() -> Self {
        Self {
            version: 1,
            session_id: new_id(),
            paused: false,
            display_instance: None,
            active: None,
            config: json!({}),
            presentation: json!({}),
            current: None,
            queue: VecDeque::new(),
            history: vec![],
            receipts: BTreeMap::new(),
            namespaces: BTreeMap::new(),
            demo: DemoPolicy::default(),
            migration_audit: vec![],
            priority_streak: 0,
        }
    }
}
struct Inner {
    state: State,
    store: Box<dyn StateStore>,
}
pub struct Coordinator(Mutex<Inner>, Mutex<std::time::Instant>);
impl Coordinator {
    pub fn new(mut store: Box<dyn StateStore>) -> AppResult<Self> {
        let mut state: State = match store.load()? {
            Some(s) => serde_json::from_str(&s).map_err(|e| err("STORAGE_CORRUPT", e))?,
            None => State::default(),
        };
        for task in &mut state.history {
            if task.status == TaskStatus::Completed && task.plan.is_none() && task.work_units == 1 {
                task.completed_units = 1;
            }
        }
        if let Some(mut task) = state.current.take() {
            task.status = TaskStatus::Interrupted;
            task.finished_at = Some(now_ms());
            state.history.push(task);
            state.paused = true;
        }
        if !state.queue.is_empty() {
            state.paused = true;
        }
        state.demo.enabled = false;
        state.display_instance = None;
        state.version += 1;
        store.save(&serde_json::to_string(&state).map_err(|e| err("SERIALIZATION_FAILED", e))?)?;
        Ok(Self(
            Mutex::new(Inner { state, store }),
            Mutex::new(std::time::Instant::now()),
        ))
    }
    fn change<T>(&self, f: impl FnOnce(&mut State) -> AppResult<T>) -> AppResult<T> {
        let mut inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        let mut next = inner.state.clone();
        let result = f(&mut next)?;
        next.version += 1;
        if !next.paused
            && next.current.is_none()
            && let Some(instance) = next.display_instance.clone()
            && let Some(mut task) = {
                let index = if next.priority_streak >= 3 {
                    next.queue.iter().position(|t| t.priority == 0).unwrap_or(0)
                } else {
                    0
                };
                next.queue.remove(index)
            }
        {
            next.priority_streak = if task.priority > 0 {
                next.priority_streak.saturating_add(1).min(3)
            } else {
                0
            };
            task.status = TaskStatus::Running;
            task.instance = instance;
            task.epoch = new_id();
            next.current = Some(task);
        }
        if next.history.len() > 1000 {
            next.history.drain(..next.history.len() - 1000);
        }
        let encoded = serde_json::to_string(&next).map_err(|e| err("SERIALIZATION_FAILED", e))?;
        if encoded.len() > 64 * 1024 * 1024 {
            return Err(err(
                "STORAGE_LIMIT",
                "运行时总状态上限 64 MiB，请清理记录或停用多余版本",
            ));
        }
        inner.store.save(&encoded)?;
        inner.state = next;
        Ok(result)
    }
    pub fn snapshot(&self, full: bool) -> AppResult<Snapshot> {
        let inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        let s = &inner.state;
        Ok(Snapshot {
            version: s.version,
            session_id: s.session_id.clone(),
            paused: s.paused,
            display_ready: s.display_instance.is_some(),
            demo_enabled: s.demo.enabled,
            demo_interval: s.demo.interval,
            presentation: s.presentation.clone(),
            active: s.active.clone(),
            config: s.config.clone(),
            current: s.current.clone(),
            queue: if full {
                s.queue.iter().cloned().collect()
            } else {
                vec![]
            },
            history: if full { s.history.clone() } else { vec![] },
        })
    }
    pub fn activate(&self, plugin: Option<PluginInfo>, config: Value) -> AppResult<()> {
        if let Some(p) = &plugin {
            schema::validate(&p.config_schema, &config)?;
        }
        self.change(|s| {
            if s.current.is_some() || !s.queue.is_empty() {
                return Err(err("BUSY", "请先完成或取消当前队列"));
            }
            s.demo = DemoPolicy::default();
            s.priority_streak = 0;
            s.active = plugin;
            s.presentation = json!({});
            s.config = config;
            s.display_instance = None;
            s.paused = false;
            Ok(())
        })
    }
    pub fn submit(&self, request: SubmitRequest) -> AppResult<String> {
        self.submit_local(request, InputSource::Manual, 0)
    }
    /// Only the trusted control surface can select a local source. There is no official-data constructor.
    pub fn submit_local(
        &self,
        request: SubmitRequest,
        source: InputSource,
        priority: u8,
    ) -> AppResult<String> {
        if source == InputSource::LegacyLocal || priority > 1 {
            return Err(err("INVALID_SOURCE", "无效的本地来源或优先级"));
        }
        self.submit_expected(request, source, priority, None)
    }
    fn submit_expected(
        &self,
        request: SubmitRequest,
        source: InputSource,
        priority: u8,
        expected: Option<String>,
    ) -> AppResult<String> {
        self.change(|s| {
            if let Some(digest) = &expected
                && (!s.demo.enabled
                    || s.demo.input != request.input
                    || s.active.as_ref().is_none_or(|p| &p.digest != digest)
                    || s.current.is_some()
                    || !s.queue.is_empty()
                    || s.paused
                    || s.display_instance.is_none())
            {
                return Err(err("STALE_DEMO_POLICY", "演示策略已变更"));
            }
            if request.command_id.is_empty() || request.command_id.len() > 128 {
                return Err(err("VALIDATION_FAILED", "命令 ID 错误"));
            }
            if let Some(receipt) = s.receipts.get(&request.command_id) {
                return if receipt.input == request.input
                    && (receipt.source == source || receipt.source == InputSource::LegacyLocal)
                    && receipt.priority == priority
                {
                    Ok(receipt.task_id.clone())
                } else {
                    Err(err("COMMAND_CONFLICT", "相同命令 ID 内容不同"))
                };
            }
            if s.receipts.len() >= 10000 {
                return Err(err("SESSION_LIMIT", "请结束本场并清理记录"));
            }
            let plugin = s
                .active
                .clone()
                .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "请选择玩法"))?;
            schema::validate(&plugin.input_schema, &request.input)?;
            let mut work_units = match &plugin.manifest.work_units_field {
                Some(field) => request.input[field]
                    .as_u64()
                    .filter(|n| (1..=100).contains(n))
                    .ok_or_else(|| err("VALIDATION_FAILED", "工作量必须是 1–100"))?
                    as u32,
                None => 1,
            };
            if let (Some(selector), Some(rules)) = (
                &plugin.manifest.work_units_selector_field,
                &plugin.manifest.work_units_rules_field,
            ) {
                let key = request.input[selector]
                    .as_str()
                    .ok_or_else(|| err("VALIDATION_FAILED", "规则选择器无效"))?;
                let rule = &s.config[rules][key];
                if rule["enabled"] != true {
                    return Err(err("RULE_DISABLED", "当前事件规则已关闭"));
                }
                let multiplier = rule["units"]
                    .as_u64()
                    .filter(|n| (1..=10).contains(n))
                    .ok_or_else(|| err("INVALID_RULE", "规则倍数无效"))?
                    as u32;
                work_units = work_units
                    .checked_mul(multiplier)
                    .ok_or_else(|| err("QUEUE_FULL", "工作量溢出"))?;
            }
            let pending: u32 = s
                .queue
                .iter()
                .chain(s.current.iter())
                .map(|t| t.work_units - t.completed_units)
                .sum();
            if pending + work_units > 100 {
                return Err(err("QUEUE_FULL", "待制作工作量超过 100 份"));
            }
            let id = new_id();
            let task = Task {
                id: id.clone(),
                plugin,
                input: request.input.clone(),
                config: s.config.clone(),
                epoch: String::new(),
                instance: String::new(),
                status: TaskStatus::Queued,
                prepared: false,
                plan: None,
                work_units,
                completed_units: 0,
                source,
                priority,
                created_at: now_ms(),
                finished_at: None,
                unit_completed_at: vec![],
            };
            s.receipts.insert(
                request.command_id,
                Receipt {
                    source: task.source.clone(),
                    priority,
                    input: request.input,
                    task_id: id.clone(),
                },
            );
            let index = s
                .queue
                .iter()
                .position(|t| t.priority < task.priority)
                .unwrap_or(s.queue.len());
            s.queue.insert(index, task);
            Ok(id)
        })
    }
    pub fn register_display(&self, instance: String) -> AppResult<()> {
        if instance.is_empty() || instance.len() > 128 {
            return Err(err("INVALID_INSTANCE", "实例错误"));
        }
        self.change(|s| {
            if s.display_instance.as_ref() != Some(&instance) {
                if let Some(mut task) = s.current.take() {
                    task.status = TaskStatus::Interrupted;
                    task.finished_at = Some(now_ms());
                    s.history.push(task);
                    s.paused = true;
                }
                s.display_instance = Some(instance);
            }
            Ok(())
        })
    }
    pub fn display_lost(&self) -> AppResult<()> {
        self.change(|s| {
            s.display_instance = None;
            s.paused = true;
            if let Some(mut task) = s.current.take() {
                task.status = TaskStatus::Interrupted;
                task.finished_at = Some(now_ms());
                s.history.push(task);
            }
            Ok(())
        })
    }
    pub fn prepare(&self, request: ResultRequest, input: Value) -> AppResult<()> {
        self.change(|s| {
            let task = s
                .current
                .as_mut()
                .ok_or_else(|| err("STALE_TASK", "任务已结束"))?;
            Self::matches(task, &request)?;
            if task.prepared {
                return if task.plan.as_ref().unwrap_or(&task.input) == &input {
                    Ok(())
                } else {
                    Err(err("PREPARE_CONFLICT", "计划已冻结"))
                };
            }
            if let Some(schema) = &task.plugin.plan_schema {
                schema::validate(schema, &input)?;
                if input["units"]
                    .as_array()
                    .is_none_or(|a| a.len() != task.work_units as usize)
                {
                    return Err(err("INVALID_PLAN", "冻结计划份数与预留工作量不一致"));
                }
                task.plan = Some(input);
            } else {
                schema::validate(&task.plugin.input_schema, &input)?;
                task.input = input;
            }
            task.prepared = true;
            Ok(())
        })
    }
    fn matches(task: &Task, r: &ResultRequest) -> AppResult<()> {
        if task.id != r.task_id || task.epoch != r.epoch || task.instance != r.instance {
            return Err(err("STALE_TASK", "过期播放回执"));
        }
        Ok(())
    }
    pub fn result(&self, request: ResultRequest) -> AppResult<()> {
        self.change(|s| {
            if ![TaskStatus::Completed, TaskStatus::Failed].contains(&request.status) {
                return Err(err("INVALID_RESULT", "只接受完成或失败"));
            }
            if s.history.iter().any(|t| {
                t.id == request.task_id
                    && t.epoch == request.epoch
                    && t.instance == request.instance
                    && t.status == request.status
            }) {
                return Ok(());
            }
            let task = s
                .current
                .as_ref()
                .ok_or_else(|| err("STALE_TASK", "当前无任务"))?;
            Self::matches(task, &request)?;
            if request.status == TaskStatus::Completed && !task.prepared {
                return Err(err("NOT_PREPARED", "尚未冻结计划"));
            }
            if request.status == TaskStatus::Completed
                && task.plan.is_some()
                && task.completed_units != task.work_units
            {
                return Err(err("INCOMPLETE_UNITS", "工作单元尚未全部完成"));
            }
            let mut task = s
                .current
                .take()
                .ok_or_else(|| err("STALE_TASK", "任务已结束"))?;
            task.status = request.status;
            if task.status == TaskStatus::Completed && task.plan.is_none() {
                task.completed_units = 1;
                task.unit_completed_at = vec![now_ms()];
            }
            task.finished_at = Some(now_ms());
            s.history.push(task);
            if s.history.len() > 1000 {
                s.history.remove(0);
            }
            Ok(())
        })
    }
    pub fn pause(&self, paused: bool) -> AppResult<()> {
        self.change(|s| {
            s.paused = paused;
            Ok(())
        })
    }
    pub fn cancel(&self, id: &str) -> AppResult<()> {
        self.change(|s| {
            if s.current.as_ref().is_some_and(|t| t.id == id) {
                let mut t = s
                    .current
                    .take()
                    .ok_or_else(|| err("STALE_TASK", "任务不存在"))?;
                t.status = TaskStatus::Cancelled;
                t.finished_at = Some(now_ms());
                s.history.push(t);
            } else if let Some(i) = s.queue.iter().position(|t| t.id == id) {
                if let Some(mut t) = s.queue.remove(i) {
                    t.status = TaskStatus::Cancelled;
                    t.finished_at = Some(now_ms());
                    s.history.push(t);
                }
            } else {
                return Err(err("STALE_TASK", "任务不存在"));
            }
            Ok(())
        })
    }
    pub fn clear_pending(&self) -> AppResult<()> {
        self.change(|s| {
            for mut task in s.queue.drain(..) {
                task.status = TaskStatus::Cancelled;
                task.finished_at = Some(now_ms());
                s.history.push(task);
            }
            Ok(())
        })
    }
    pub fn retry(&self, id: &str) -> AppResult<()> {
        self.change(|s| {
            if s.current.is_some() || !s.queue.is_empty() {
                return Err(err("BUSY", "队列非空"));
            }
            let mut t = s
                .history
                .iter()
                .find(|t| {
                    t.id == id && [TaskStatus::Interrupted, TaskStatus::Failed].contains(&t.status)
                })
                .cloned()
                .ok_or_else(|| err("INVALID_TRANSITION", "只能重试失败/中断任务"))?;
            if s.active
                .as_ref()
                .is_none_or(|p| p.digest != t.plugin.digest)
            {
                return Err(err(
                    "PLUGIN_VERSION_MISMATCH",
                    "请启用任务使用的相同插件版本",
                ));
            }
            t.id = new_id();
            t.finished_at = None;
            t.epoch = String::new();
            t.instance = String::new();
            t.status = TaskStatus::Queued;
            s.queue.push_back(t);
            Ok(())
        })
    }
    pub fn clear_history(&self) -> AppResult<()> {
        self.change(|s| {
            if s.current.is_some() || !s.queue.is_empty() {
                return Err(err("BUSY", "请先停止任务"));
            }
            s.history.clear();
            s.receipts.clear();
            s.session_id = new_id();
            Ok(())
        })
    }
    pub fn references(&self, digest: &str) -> AppResult<bool> {
        let s = self.snapshot(true)?;
        Ok(s.active.as_ref().is_some_and(|p| p.digest == digest)
            || s.current
                .iter()
                .chain(s.queue.iter())
                .chain(s.history.iter())
                .any(|t| t.plugin.digest == digest))
    }
    pub fn copy_compatible_state(&self, source: &PluginInfo, target: &PluginInfo) -> AppResult<()> {
        if source.manifest.id != target.manifest.id
            || source.manifest.publisher != target.manifest.publisher
            || source.digest == target.digest
            || source.manifest.state_schema_version != target.manifest.state_schema_version
        {
            return Err(err(
                "STATE_SCHEMA_MISMATCH",
                "仅允许同一玩法且相同 stateSchemaVersion 的显式状态复制",
            ));
        }
        self.change(|s| {
            if s.current.is_some() || !s.queue.is_empty() {
                return Err(err("BUSY", "请先停止任务"));
            }
            let prefix = |p: &PluginInfo| {
                format!(
                    "{}:{}:{}:",
                    p.manifest.id, p.manifest.version, p.manifest.state_schema_version
                )
            };
            let from = prefix(source);
            let to = prefix(target);
            if s.namespaces.keys().any(|k| k.starts_with(&to)) {
                return Err(err("TARGET_NOT_EMPTY", "目标版本已有状态，拒绝覆盖"));
            }
            let changes = s
                .namespaces
                .iter()
                .filter(|(k, _)| k.starts_with(&from))
                .map(|(k, v)| (format!("{to}{}", &k[from.len()..]), v.clone()))
                .collect::<Vec<_>>();
            for (k, v) in changes {
                s.namespaces.insert(k, v);
            }
            Ok(())
        })
    }
    pub fn storage(
        &self,
        request: &ResultRequest,
        key: &str,
        value: Option<Value>,
    ) -> AppResult<Value> {
        if key.is_empty() || key.len() > 100 {
            return Err(err("INVALID_KEY", "存储 key 错误"));
        }
        self.change(|s| {
            let task = s
                .current
                .as_ref()
                .ok_or_else(|| err("STALE_TASK", "当前无任务"))?;
            Self::matches(task, request)?;
            if !task
                .plugin
                .manifest
                .permissions
                .iter()
                .any(|p| p == "storage.own")
            {
                return Err(err("FORBIDDEN", "插件无存储权限"));
            }
            // State version namespaces isolate upgrades/rollback without executing privileged migration code.
            let namespace = format!(
                "{}:{}:{}",
                task.plugin.manifest.id,
                task.plugin.manifest.version,
                task.plugin.manifest.state_schema_version
            );
            let full_key = format!("{namespace}:{key}");
            if let Some(v) = value {
                if serde_json::to_vec(&v)
                    .map_err(|e| err("SERIALIZATION_FAILED", e))?
                    .len()
                    > 65536
                {
                    return Err(err("STORAGE_LIMIT", "单项限制 64 KiB"));
                }
                s.namespaces.insert(full_key.clone(), v);
                if serde_json::to_vec(
                    &s.namespaces
                        .iter()
                        .filter(|(k, _)| k.starts_with(&format!("{namespace}:")))
                        .collect::<BTreeMap<_, _>>(),
                )
                .map_err(|e| err("SERIALIZATION_FAILED", e))?
                .len()
                    > 1024 * 1024
                {
                    return Err(err("STORAGE_LIMIT", "命名空间限制 1 MiB"));
                }
            }
            Ok(s.namespaces.get(&full_key).cloned().unwrap_or(Value::Null))
        })
    }
    pub fn unit_done(&self, r: &ResultRequest, index: u32) -> AppResult<()> {
        self.change(|s| {
            let t = s
                .current
                .as_mut()
                .ok_or_else(|| err("STALE_TASK", "任务不存在"))?;
            Self::matches(t, r)?;
            if !t.prepared || t.plan.is_none() || index >= t.work_units || index > t.completed_units
            {
                return Err(err("INVALID_UNIT", "工作单元顺序错误"));
            }
            if index == t.completed_units {
                t.completed_units += 1;
                t.unit_completed_at.push(now_ms());
            }
            Ok(())
        })
    }
    pub fn preempt(&self) -> AppResult<()> {
        self.change(|s| {
            if s.queue.is_empty() {
                return Err(err("INVALID_TRANSITION", "无等待任务"));
            }
            let mut t = s
                .current
                .take()
                .ok_or_else(|| err("STALE_TASK", "无当前任务"))?;
            t.status = TaskStatus::Queued;
            t.epoch = new_id();
            t.instance.clear();
            s.queue.push_back(t);
            Ok(())
        })
    }
    pub fn set_presentation(&self, value: Value) -> AppResult<()> {
        self.change(|s| {
            let p = s
                .active
                .as_ref()
                .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用插件"))?;
            schema::validate(
                p.presentation_schema
                    .as_ref()
                    .ok_or_else(|| err("FORBIDDEN", "插件没有显示配置"))?,
                &value,
            )?;
            s.presentation = value;
            Ok(())
        })
    }
    pub fn session_plugin(&self, instance: &str, capability: &str) -> AppResult<PluginInfo> {
        let inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        if inner.state.display_instance.as_deref() != Some(instance) {
            return Err(err("STALE_INSTANCE", "过期输出实例"));
        }
        let p = inner
            .state
            .active
            .as_ref()
            .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
        if !p.manifest.capabilities.iter().any(|c| c == capability) {
            return Err(err("FORBIDDEN", "无能力授权"));
        }
        Ok(p.clone())
    }
    pub fn preferences(&self, instance: &str, key: &str, value: Option<Value>) -> AppResult<Value> {
        self.session_plugin(instance, "preferences.own.v1")?;
        if key.is_empty() || key.len() > 100 {
            return Err(err("INVALID_KEY", "偏好 key 错误"));
        }
        self.change(|s| {
            if s.display_instance.as_deref() != Some(instance) {
                return Err(err("STALE_INSTANCE", "过期输出实例"));
            }
            let p = s
                .active
                .as_ref()
                .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
            let namespace = format!(
                "{}:{}:{}:preferences:",
                p.manifest.id, p.manifest.version, p.manifest.state_schema_version
            );
            let k = format!("{namespace}{key}");
            if let Some(value) = value {
                if serde_json::to_vec(&value)
                    .map_err(|e| err("SERIALIZATION_FAILED", e))?
                    .len()
                    > 65536
                {
                    return Err(err("STORAGE_LIMIT", "偏好超过 64 KiB"));
                }
                s.namespaces.insert(k.clone(), value);
                let total: usize = s
                    .namespaces
                    .iter()
                    .filter(|(k, _)| k.starts_with(&namespace))
                    .map(|(k, v)| k.len() + v.to_string().len())
                    .sum();
                if total > 1024 * 1024 {
                    return Err(err("STORAGE_LIMIT", "偏好命名空间超过 1 MiB"));
                }
            }
            Ok(s.namespaces.get(&k).cloned().unwrap_or(Value::Null))
        })
    }

    pub fn configure_demo(&self, enabled: bool, interval: u32, input: Value) -> AppResult<()> {
        if !(15..=120).contains(&interval) {
            return Err(err("INVALID_DEMO_POLICY", "演示间隔必须为 15–120 秒"));
        }
        self.change(|s| {
            let p = s
                .active
                .as_ref()
                .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
            if enabled {
                schema::validate(&p.input_schema, &input)?;
            }
            s.demo = DemoPolicy {
                enabled,
                interval,
                input,
            };
            Ok(())
        })?;
        *self
            .1
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "演示时钟锁错误"))? = std::time::Instant::now();
        Ok(())
    }
    /// Native owner calls this; no plugin or browser timer may enqueue autonomous tasks.
    pub fn tick_demo(&self) -> AppResult<bool> {
        let (policy, digest) = {
            let inner = self
                .0
                .lock()
                .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
            let s = &inner.state;
            if !s.demo.enabled
                || s.paused
                || s.current.is_some()
                || !s.queue.is_empty()
                || s.display_instance.is_none()
            {
                *self
                    .1
                    .lock()
                    .map_err(|_| err("STATE_UNAVAILABLE", "演示时钟锁错误"))? =
                    std::time::Instant::now();
                return Ok(false);
            }
            (
                s.demo.clone(),
                s.active
                    .as_ref()
                    .map(|p| p.digest.clone())
                    .unwrap_or_default(),
            )
        };
        let mut last = self
            .1
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "演示时钟锁错误"))?;
        if last.elapsed().as_secs() < policy.interval as u64 {
            return Ok(false);
        }
        *last = std::time::Instant::now();
        drop(last);
        self.submit_expected(
            SubmitRequest {
                command_id: new_id(),
                input: policy.input,
            },
            InputSource::Demo,
            0,
            Some(digest),
        )?;
        Ok(true)
    }

    pub fn read_preferences(&self, key: &str) -> AppResult<Value> {
        if key.len() > 100 {
            return Err(err("INVALID_KEY", "偏好 key 错误"));
        }
        let inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        let p = inner
            .state
            .active
            .as_ref()
            .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
        let key = format!(
            "{}:{}:{}:preferences:{key}",
            p.manifest.id, p.manifest.version, p.manifest.state_schema_version
        );
        Ok(inner
            .state
            .namespaces
            .get(&key)
            .cloned()
            .unwrap_or(Value::Null))
    }

    pub fn configure(&self, config: Value) -> AppResult<()> {
        self.change(|s| {
            let p = s
                .active
                .as_ref()
                .ok_or_else(|| err("PLUGIN_NOT_SELECTED", "未启用玩法"))?;
            schema::validate(&p.config_schema, &config)?;
            s.config = config;
            Ok(())
        })
    }
    pub fn reset_demo(&self) -> AppResult<()> {
        self.change(|s| {
            s.demo.enabled = false;
            if s.current
                .as_ref()
                .is_some_and(|t| t.source == InputSource::Demo)
            {
                s.current = None;
            }
            s.queue.retain(|t| t.source != InputSource::Demo);
            s.history.retain(|t| t.source != InputSource::Demo);
            s.receipts.retain(|_, r| r.source != InputSource::Demo);
            Ok(())
        })
    }
    /// Explicit, bounded data-only migration. No plugin code executes in the host.
    /// Keys absent from `mapping` are intentionally omitted; the entire source namespace is retained.
    pub fn migrate_state(
        &self,
        source: &PluginInfo,
        target: &PluginInfo,
        mapping: BTreeMap<String, String>,
        defaults: BTreeMap<String, Value>,
    ) -> AppResult<()> {
        if source.manifest.id != target.manifest.id
            || source.manifest.publisher != target.manifest.publisher
            || source.digest == target.digest
            || source.manifest.state_schema_version == target.manifest.state_schema_version
        {
            return Err(err(
                "STATE_SCHEMA_MISMATCH",
                "跨 schema 迁移必须是同一发布者和玩法的不同版本",
            ));
        }
        if mapping.len() + defaults.len() > 100 {
            return Err(err("STORAGE_LIMIT", "迁移最多 100 个键"));
        }
        self.change(|s| {
            if s.current.is_some() || !s.queue.is_empty() {return Err(err("BUSY","请先停止任务"));}
            let prefix=|p:&PluginInfo|format!("{}:{}:{}:",p.manifest.id,p.manifest.version,p.manifest.state_schema_version);
            let from=prefix(source);let to=prefix(target);
            if s.namespaces.keys().any(|k|k.starts_with(&to)) {return Err(err("TARGET_NOT_EMPTY","目标状态非空"));}
            let mut output=BTreeMap::new();
            for (old,new) in &mapping {
                if old.is_empty()||old.len()>100 {return Err(err("INVALID_KEY","迁移来源键错误"));}
                let value=s.namespaces.get(&format!("{from}{old}")).ok_or_else(||err("INVALID_KEY","迁移来源键不存在"))?;
                if output.insert(new.clone(),value.clone()).is_some() {return Err(err("MIGRATION_CONFLICT","迁移目标键冲突"));}
            }
            for (key,value) in &defaults {if output.insert(key.clone(),value.clone()).is_some(){return Err(err("MIGRATION_CONFLICT","默认值覆盖迁移键"));}}
            let mut total=0;
            for (key,value) in &output {
                let size=serde_json::to_vec(value).map_err(|e|err("SERIALIZATION_FAILED",e))?.len();
                if key.is_empty()||key.len()>100||size>65536 {return Err(err("STORAGE_LIMIT","迁移键或值超限"));}total+=key.len()+size;
            }
            if total>1024*1024 {return Err(err("STORAGE_LIMIT","迁移状态超过 1 MiB"));}
            for (key,value) in output {s.namespaces.insert(format!("{to}{key}"),value);}
            s.migration_audit.push(json!({"source":source.digest,"target":target.digest,"fromSchema":source.manifest.state_schema_version,"toSchema":target.manifest.state_schema_version,"at":now_ms(),"mapping":mapping}));
            if s.migration_audit.len()>1000 {s.migration_audit.remove(0);}Ok(())
        })
    }
    pub fn media_referenced(&self, reference: &str) -> AppResult<bool> {
        if !reference.starts_with("media:") || reference.len() != 70 {
            return Err(err("INVALID_MEDIA", "媒体引用错误"));
        }
        let inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        Ok(serde_json::to_string(&inner.state)
            .map_err(|e| err("SERIALIZATION_FAILED", e))?
            .contains(reference))
    }
    pub fn changed(&self, version: u64, session: &str) -> AppResult<bool> {
        let inner = self
            .0
            .lock()
            .map_err(|_| err("STATE_UNAVAILABLE", "状态锁错误"))?;
        Ok(inner.state.version != version || inner.state.session_id != session)
    }
}
