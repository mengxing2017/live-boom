//! SQLite checkpoint and transactional query projections.
use play_contracts::{AppError, AppResult};
use rusqlite::Connection;
use serde_json::Value;
use std::collections::BTreeMap;
fn err(code: &str, message: impl ToString) -> AppError {
    AppError::new(code, message)
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
pub struct SqliteStore(Connection, Option<Value>);
impl SqliteStore {
    pub fn open(path: &std::path::Path) -> AppResult<Self> {
        let connection = Connection::open(path).map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS runtime_state (id INTEGER PRIMARY KEY CHECK(id=1), schema_version INTEGER NOT NULL, body TEXT NOT NULL);").map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        let state_schema: u32 = connection
            .query_row(
                "SELECT coalesce(max(schema_version),2) FROM runtime_state",
                [],
                |r| r.get(0),
            )
            .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        if state_schema != 2 {
            return Err(err("SCHEMA_MISMATCH", "不支持的检查点版本"));
        }
        let version: u32 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        if version != 2 {
            let existing: u32 = connection
                .query_row("SELECT count(*) FROM runtime_state", [], |r| r.get(0))
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            if version != 0 || existing != 0 {
                return Err(err(
                    "SCHEMA_MISMATCH",
                    "数据库版本不支持；开发数据请使用独立数据目录重新初始化",
                ));
            }
            connection.execute_batch("BEGIN IMMEDIATE;
                CREATE TABLE IF NOT EXISTS runtime_tasks(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS runtime_work_items(task_id TEXT NOT NULL, unit_index INTEGER NOT NULL, completed INTEGER NOT NULL, body TEXT, PRIMARY KEY(task_id,unit_index));
                CREATE TABLE IF NOT EXISTS runtime_receipts(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS plugin_preferences(id TEXT PRIMARY KEY, body TEXT NOT NULL);
                PRAGMA user_version=2; COMMIT;").map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        }
        Ok(Self(connection, None))
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
            Some((2, body)) => Ok(Some(body)),
            None => Ok(None),
            _ => Err(err("SCHEMA_MISMATCH", "数据库版本不支持")),
        }
    }
    fn save(&mut self, json: &str) -> AppResult<()> {
        let next: Value = serde_json::from_str(json).map_err(|e| err("SERIALIZATION_FAILED", e))?;
        let previous = self.1.as_ref();
        let tx = self
            .0
            .transaction()
            .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        if previous.is_none() {
            tx.execute_batch("DELETE FROM runtime_tasks; DELETE FROM runtime_work_items; DELETE FROM runtime_receipts; DELETE FROM plugin_preferences;").map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        }
        tx.execute("INSERT INTO runtime_state(id,schema_version,body) VALUES(1,2,?1) ON CONFLICT(id) DO UPDATE SET body=excluded.body,schema_version=2",[json]).map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
        // Query projections are updated in the same transaction as the authoritative checkpoint.
        // Media bytes live outside the checkpoint; unchanged rows are never rewritten.
        let tasks = |v: &Value| -> BTreeMap<String, Value> {
            v["current"]
                .as_object()
                .map(|_| &v["current"])
                .into_iter()
                .chain(v["queue"].as_array().into_iter().flatten())
                .chain(v["history"].as_array().into_iter().flatten())
                .filter_map(|t| t["id"].as_str().map(|id| (id.to_string(), t.clone())))
                .collect()
        };
        let new_tasks = tasks(&next);
        let old_tasks = previous.map(tasks).unwrap_or_default();
        for (id, task) in &new_tasks {
            if old_tasks.get(id) == Some(task) {
                continue;
            }
            tx.execute("INSERT INTO runtime_tasks VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body",rusqlite::params![id,task.to_string()]).map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
            tx.execute("DELETE FROM runtime_work_items WHERE task_id=?1", [id])
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            let count = task["work_units"].as_u64().unwrap_or(1);
            for i in 0..count {
                let unit = task["plan"]["units"].get(i as usize).map(Value::to_string);
                tx.execute(
                    "INSERT INTO runtime_work_items VALUES(?1,?2,?3,?4)",
                    rusqlite::params![
                        id,
                        i,
                        i < task["completed_units"].as_u64().unwrap_or(0),
                        unit
                    ],
                )
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            }
        }
        for id in old_tasks.keys().filter(|id| !new_tasks.contains_key(*id)) {
            tx.execute("DELETE FROM runtime_tasks WHERE id=?1", [id])
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            tx.execute("DELETE FROM runtime_work_items WHERE task_id=?1", [id])
                .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        }
        for (field, table) in [
            ("receipts", "runtime_receipts"),
            ("namespaces", "plugin_preferences"),
        ] {
            let empty = serde_json::Map::new();
            let new = next[field].as_object().unwrap_or(&empty);
            let old = previous
                .and_then(|v| v[field].as_object())
                .unwrap_or(&empty);
            for (key, value) in new {
                if old.get(key) != Some(value) {
                    tx.execute(&format!("INSERT INTO {table} VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET body=excluded.body"),rusqlite::params![key,value.to_string()]).map_err(|e|err("STORAGE_UNAVAILABLE",e))?;
                }
            }
            for key in old.keys().filter(|key| !new.contains_key(*key)) {
                tx.execute(&format!("DELETE FROM {table} WHERE id=?1"), [key])
                    .map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
            }
        }
        tx.commit().map_err(|e| err("STORAGE_UNAVAILABLE", e))?;
        self.1 = Some(next);
        Ok(())
    }
}
