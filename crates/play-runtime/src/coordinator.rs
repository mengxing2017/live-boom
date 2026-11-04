use crate::schema;
use play_contracts::*;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::Mutex,
};
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
pub trait StateStore: Send {
    fn load(&self) -> AppResult<Option<String>>;
    fn save(&mut self, json: &str) -> AppResult<()>;
}
#[derive(Default)]
pub struct MemoryStore(Option<String>);
impl StateStore for MemoryStore {
    fn load(&self) -> AppResult<Option<String>> {
        Ok(self.0.clone())
    }
    fn save(&mut self, json: &str) -> AppResult<()> {
        self.0 = Some(json.into());
        Ok(())
    }
}
pub struct SqliteStore(Connection);
impl SqliteStore {
    pub fn open(path: &std::path::Path) -> AppResult<Self> {
        let connection = Connection::open(path).map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, body TEXT NOT NULL);").map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        Ok(Self(connection))
    }
}
impl StateStore for SqliteStore {
    fn load(&self) -> AppResult<Option<String>> {
        use rusqlite::OptionalExtension;
        let row: Option<(i64, String)> = self
            .0
            .query_row(
                "SELECT schema_version,body FROM runtime_state WHERE id=1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()
            .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        match row {
            Some((1, body)) => Ok(Some(body)),
            None => Ok(None),
            _ => Err(err("SCHEMA_MISMATCH", "数据库版本不支持")),
        }
    }
    fn save(&mut self, json: &str) -> AppResult<()> {
        let tx = self
            .0
            .transaction()
            .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        tx.execute("INSERT INTO runtime_state(id,schema_version,body) VALUES(1,1,?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body",[json]).map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        tx.commit().map_err(|e| err("STORAGE_UNAVAILABLE", e))
    }
}
#[derive(Clone, Serialize, Deserialize)]
struct Receipt {
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
    current: Option<Task>,
    queue: VecDeque<Task>,
    history: Vec<Task>,
    receipts: BTreeMap<String, Receipt>,
    namespaces: BTreeMap<String, Value>,
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
            current: None,
            queue: VecDeque::new(),
            history: vec![],
            receipts: BTreeMap::new(),
            namespaces: BTreeMap::new(),
        }
    }
}
struct Inner {
    state: State,
    store: Box<dyn StateStore>,
}
pub struct Coordinator(Mutex<Inner>);
impl Coordinator {
    pub fn new(mut store: Box<dyn StateStore>) -> AppResult<Self> {
        let mut state: State = match store.load()? {
            Some(s) => serde_json::from_str(&s).map_err(|e| err("STORAGE_CORRUPT", e))?,
            None => State::default(),
        };
        if let Some(mut task) = state.current.take() {
            task.status = TaskStatus::Interrupted;
            state.history.push(task);
            state.paused = true;
        }
        if !state.queue.is_empty() {
            state.paused = true;
        }
        state.display_instance = None;
        state.version += 1;
        store.save(&serde_json::to_string(&state).map_err(|e| err("SERIALIZATION_FAILED", e))?)?;
        Ok(Self(Mutex::new(Inner { state, store })))
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
            && let Some(mut task) = next.queue.pop_front()
        {
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
            s.active = plugin;
            s.config = config;
            s.display_instance = None;
            s.paused = false;
            Ok(())
        })
    }
    pub fn submit(&self, request: SubmitRequest) -> AppResult<String> {
        self.change(|s| {
            if request.command_id.is_empty() || request.command_id.len() > 128 {
                return Err(err("VALIDATION_FAILED", "命令 ID 错误"));
            }
            if let Some(receipt) = s.receipts.get(&request.command_id) {
                return if receipt.input == request.input {
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
            play_core::rules::can_accept(s.queue.len()).map_err(|e| err("QUEUE_FULL", e))?;
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
            };
            s.receipts.insert(
                request.command_id,
                Receipt {
                    input: request.input,
                    task_id: id.clone(),
                },
            );
            s.queue.push_back(task);
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
                return if task.input == input {
                    Ok(())
                } else {
                    Err(err("PREPARE_CONFLICT", "计划已冻结"))
                };
            }
            schema::validate(&task.plugin.input_schema, &input)?;
            task.input = input;
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
            let mut task = s
                .current
                .take()
                .ok_or_else(|| err("STALE_TASK", "任务已结束"))?;
            task.status = request.status;
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
                s.history.push(t);
            } else if let Some(i) = s.queue.iter().position(|t| t.id == id) {
                if let Some(mut t) = s.queue.remove(i) {
                    t.status = TaskStatus::Cancelled;
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
}
