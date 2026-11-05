use base64::{Engine, engine::general_purpose::STANDARD};
use play_contracts::*;
use play_runtime::{
    Coordinator,
    coordinator::{MemoryStore, SqliteStore, StateStore, new_id},
    plugins::{Bundle, PluginManager, Signature, hash},
};
use ring::{
    rand::SystemRandom,
    signature::{Ed25519KeyPair, KeyPair},
};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        let p = std::env::temp_dir().join(format!("liveboom-{}", new_id()));
        std::fs::create_dir_all(&p).unwrap();
        Self(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn sample() -> Vec<u8> {
    let manifest = json!({"id":"community.registry","name":"Example","version":"1.0.0","sdkApi":"1","hostVersion":">=0.2.0 <0.3.0","entry":"web/index.html","inputSchema":"schemas/input.json","configSchema":"schemas/config.json","stateSchemaVersion":1,"permissions":["task.current.read","task.result.report","storage.own"],"publisher":"examples"});
    let input = json!({"type":"object","additionalProperties":false,"properties":{"nickname":{"type":"string","minLength":1,"maxLength":32}},"required":["nickname"]});
    let config = json!({"type":"object","additionalProperties":false,"properties":{"duration":{"type":"integer","minimum":2,"maximum":15}},"required":["duration"]});
    let mut b = Bundle {
        format: "liveboom.plugin.v1".into(),
        files: Default::default(),
        integrity: Default::default(),
        signature: None,
    };
    for (path, value) in [
        ("manifest.json", manifest),
        ("schemas/input.json", input),
        ("schemas/config.json", config),
    ] {
        replace(&mut b, path, &serde_json::to_vec(&value).unwrap());
    }
    replace(&mut b, "web/index.html", b"<main>Example</main>");
    encode(&b)
}
fn plugin() -> PluginInfo {
    let t = Temp::new();
    PluginManager::new(t.0.clone(), true, vec![])
        .unwrap()
        .verify(&sample())
        .unwrap()
        .info
}
fn coordinator() -> Coordinator {
    let c = Coordinator::new(Box::new(MemoryStore::default())).unwrap();
    c.activate(Some(plugin()), json!({"duration":4})).unwrap();
    c
}
fn submit(c: &Coordinator, command: &str) -> String {
    c.submit(SubmitRequest {
        command_id: command.into(),
        input: json!({"nickname":"小明"}),
    })
    .unwrap()
}
fn request(c: &Coordinator, status: TaskStatus) -> ResultRequest {
    let t = c.snapshot(true).unwrap().current.unwrap();
    ResultRequest {
        task_id: t.id,
        epoch: t.epoch,
        instance: t.instance,
        status,
    }
}
fn prepared(c: &Coordinator) {
    let input = c.snapshot(true).unwrap().current.unwrap().input;
    c.prepare(request(c, TaskStatus::Completed), input).unwrap();
}
#[test]
fn repeated_command_is_idempotent_but_same_nickname_can_participate_twice() {
    let c = coordinator();
    let first = submit(&c, "one");
    assert_eq!(submit(&c, "one"), first);
    assert_ne!(submit(&c, "two"), first);
    assert_eq!(c.snapshot(true).unwrap().queue.len(), 2);
    let r = c.submit(SubmitRequest {
        command_id: "one".into(),
        input: json!({"nickname":"不同"}),
    });
    assert_eq!(r.unwrap_err().code, "COMMAND_CONFLICT");
}
#[test]
fn queue_capacity_and_schema_are_enforced() {
    let c = coordinator();
    for n in 0..100 {
        submit(&c, &n.to_string());
    }
    assert_eq!(
        c.submit(SubmitRequest {
            command_id: "overflow".into(),
            input: json!({"nickname":"正常"})
        })
        .unwrap_err()
        .code,
        "QUEUE_FULL"
    );
    assert!(
        c.submit(SubmitRequest {
            command_id: "invalid".into(),
            input: json!({"nickname":"a","official_gift":true})
        })
        .is_err()
    );
}
#[test]
fn failed_result_is_not_completed_and_duplicate_ack_does_not_consume_next() {
    let c = coordinator();
    submit(&c, "one");
    submit(&c, "two");
    c.register_display("display-a".into()).unwrap();
    let failed = request(&c, TaskStatus::Failed);
    c.result(failed.clone()).unwrap();
    c.result(failed).unwrap();
    let s = c.snapshot(true).unwrap();
    assert_eq!(s.history[0].status, TaskStatus::Failed);
    assert!(s.current.is_some());
    assert_ne!(s.history[0].id, s.current.unwrap().id);
}
#[test]
fn stale_epoch_cannot_finish_current_and_completion_requires_preparation() {
    let c = coordinator();
    submit(&c, "one");
    c.register_display("display-a".into()).unwrap();
    assert_eq!(
        c.result(request(&c, TaskStatus::Completed))
            .unwrap_err()
            .code,
        "NOT_PREPARED"
    );
    prepared(&c);
    let mut stale = request(&c, TaskStatus::Completed);
    stale.epoch = "old".into();
    assert_eq!(c.result(stale).unwrap_err().code, "STALE_TASK");
    c.result(request(&c, TaskStatus::Completed)).unwrap();
    assert_eq!(
        c.snapshot(true).unwrap().history[0].status,
        TaskStatus::Completed
    );
}
#[test]
fn display_loss_records_interruption_and_does_not_replay_on_reregister() {
    let c = coordinator();
    submit(&c, "one");
    c.register_display("display-a".into()).unwrap();
    let old = request(&c, TaskStatus::Completed);
    c.display_lost().unwrap();
    let s = c.snapshot(true).unwrap();
    assert!(s.paused);
    assert_eq!(s.history[0].status, TaskStatus::Interrupted);
    c.register_display("display-b".into()).unwrap();
    assert!(c.snapshot(true).unwrap().current.is_none());
    assert!(c.result(old).is_err());
    c.retry(&s.history[0].id).unwrap();
    assert!(c.snapshot(true).unwrap().current.is_none());
    c.pause(false).unwrap();
    assert!(c.snapshot(true).unwrap().current.is_some());
}
#[test]
fn readiness_change_increments_version_without_current_task() {
    let c = coordinator();
    c.register_display("x".into()).unwrap();
    let before = c.snapshot(true).unwrap().version;
    c.display_lost().unwrap();
    let s = c.snapshot(true).unwrap();
    assert!(s.version > before);
    assert!(!s.display_ready);
}
#[test]
fn pause_prevents_dispatch_and_switching_busy_plugin_is_rejected() {
    let c = coordinator();
    c.pause(true).unwrap();
    submit(&c, "one");
    c.register_display("x".into()).unwrap();
    assert!(c.snapshot(true).unwrap().current.is_none());
    assert_eq!(
        c.activate(Some(plugin()), json!({"duration":4}))
            .unwrap_err()
            .code,
        "BUSY"
    );
    c.pause(false).unwrap();
    assert!(c.snapshot(true).unwrap().current.is_some());
}
#[test]
fn sqlite_restart_keeps_receipts_and_marks_running_interrupted() {
    let t = Temp::new();
    let file = t.0.join("state.sqlite");
    let c = Coordinator::new(Box::new(SqliteStore::open(&file).unwrap())).unwrap();
    c.activate(Some(plugin()), json!({"duration":4})).unwrap();
    let id = submit(&c, "stable-command");
    c.register_display("x".into()).unwrap();
    drop(c);
    let restored = Coordinator::new(Box::new(SqliteStore::open(&file).unwrap())).unwrap();
    let s = restored.snapshot(true).unwrap();
    assert!(s.current.is_none());
    assert_eq!(s.history[0].status, TaskStatus::Interrupted);
    assert_eq!(submit(&restored, "stable-command"), id);
    assert!(restored.snapshot(true).unwrap().queue.is_empty());
}
struct FailingStore {
    failed: Arc<AtomicBool>,
}
impl StateStore for FailingStore {
    fn load(&self) -> AppResult<Option<String>> {
        Ok(None)
    }
    fn save(&mut self, _: &str) -> AppResult<()> {
        if self.failed.load(Ordering::SeqCst) {
            Err(AppError::new("STORAGE_UNAVAILABLE", "simulated full disk"))
        } else {
            Ok(())
        }
    }
}
#[test]
fn failed_transaction_does_not_publish_a_new_state() {
    let failed = Arc::new(AtomicBool::new(false));
    let c = Coordinator::new(Box::new(FailingStore {
        failed: failed.clone(),
    }))
    .unwrap();
    c.activate(Some(plugin()), json!({"duration":4})).unwrap();
    let before = c.snapshot(true).unwrap();
    failed.store(true, Ordering::SeqCst);
    assert!(
        c.submit(SubmitRequest {
            command_id: "one".into(),
            input: json!({"nickname":"hello"})
        })
        .is_err()
    );
    let after = c.snapshot(true).unwrap();
    assert_eq!(before.version, after.version);
    assert!(after.queue.is_empty());
}
#[test]
fn namespaces_are_isolated_by_plugin_and_version() {
    let c = coordinator();
    submit(&c, "one");
    c.register_display("a".into()).unwrap();
    let r = request(&c, TaskStatus::Completed);
    c.storage(&r, "score", Some(json!(42))).unwrap();
    assert_eq!(c.storage(&r, "score", None).unwrap(), json!(42));
    prepared(&c);
    c.result(r).unwrap();
    let mut other = plugin();
    other.manifest.id = "private.other".into();
    other.digest = "other".into();
    c.activate(Some(other), json!({"duration":4})).unwrap();
    submit(&c, "two");
    c.register_display("b".into()).unwrap();
    assert_eq!(
        c.storage(&request(&c, TaskStatus::Completed), "score", None)
            .unwrap(),
        Value::Null
    );
    assert!(
        c.storage(
            &request(&c, TaskStatus::Completed),
            "huge",
            Some(json!("x".repeat(65537)))
        )
        .is_err()
    );
}
fn bundle() -> Bundle {
    serde_json::from_slice(&sample()).unwrap()
}
fn encode(b: &Bundle) -> Vec<u8> {
    serde_json::to_vec(b).unwrap()
}
fn replace(b: &mut Bundle, path: &str, bytes: &[u8]) {
    b.files.insert(path.into(), STANDARD.encode(bytes));
    b.integrity.insert(path.into(), hash(bytes));
}
#[test]
fn package_tamper_and_traversal_are_rejected() {
    let t = Temp::new();
    let m = PluginManager::new(t.0.clone(), true, vec![]).unwrap();
    let mut b = bundle();
    b.files
        .insert("manifest.json".into(), STANDARD.encode(b"{}"));
    assert_eq!(
        m.verify(&encode(&b)).err().unwrap().code,
        "INTEGRITY_FAILED"
    );
    let mut b = bundle();
    replace(&mut b, "../secret", b"x");
    assert_eq!(m.verify(&encode(&b)).err().unwrap().code, "UNSAFE_PATH");
}
#[test]
fn signed_private_plugin_can_install_on_unchanged_public_manager() {
    let t = Temp::new();
    let mut m = PluginManager::new(t.0.clone(), false, vec![]).unwrap();
    assert_eq!(m.verify(&sample()).err().unwrap().code, "UNSIGNED_PLUGIN");
    let rng = SystemRandom::new();
    let key =
        Ed25519KeyPair::from_pkcs8(Ed25519KeyPair::generate_pkcs8(&rng).unwrap().as_ref()).unwrap();
    let mut b = bundle();
    let mut manifest: Value =
        serde_json::from_slice(&STANDARD.decode(&b.files["manifest.json"]).unwrap()).unwrap();
    manifest["id"] = json!("private.custom");
    manifest["publisher"] = json!("private-publisher");
    replace(
        &mut b,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    let signed = serde_json::to_vec(&b.integrity).unwrap();
    b.signature = Some(Signature {
        publisher: "private-publisher".into(),
        value: STANDARD.encode(key.sign(&signed).as_ref()),
    });
    assert_eq!(
        m.verify(&encode(&b)).err().unwrap().code,
        "UNTRUSTED_PUBLISHER"
    );
    m.trust(
        "private-publisher".into(),
        STANDARD.encode(key.public_key().as_ref()),
    )
    .unwrap();
    let p = m.install(&encode(&b)).unwrap();
    assert_eq!(p.manifest.id, "private.custom");
    assert_eq!(m.list().unwrap().len(), 1);
    assert!(
        m.document(&p.digest)
            .unwrap()
            .contains("connect-src 'none'")
    );
    manifest["name"] = json!("replaced");
    replace(
        &mut b,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert_eq!(
        m.verify(&encode(&b)).err().unwrap().code,
        "INVALID_SIGNATURE"
    );
}
#[test]
fn package_version_conflict_incompatible_api_and_unknown_schema_are_rejected() {
    let t = Temp::new();
    let m = PluginManager::new(t.0.clone(), true, vec![]).unwrap();
    m.install(&sample()).unwrap();
    let mut b = bundle();
    let mut manifest: Value =
        serde_json::from_slice(&STANDARD.decode(&b.files["manifest.json"]).unwrap()).unwrap();
    manifest["name"] = json!("different");
    replace(
        &mut b,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert_eq!(m.install(&encode(&b)).unwrap_err().code, "VERSION_CONFLICT");
    manifest["sdkApi"] = json!("99");
    replace(
        &mut b,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert_eq!(
        m.verify(&encode(&b)).err().unwrap().code,
        "INCOMPATIBLE_API"
    );
    let mut b = bundle();
    replace(&mut b,"schemas/input.json",br#"{"type":"object","properties":{},"additionalProperties":false,"$ref":"https://evil/schema"}"#);
    assert!(m.verify(&encode(&b)).is_err());
}
#[test]
fn builtin_trust_applies_only_to_exact_digest_and_files_remain_immutable() {
    let t = Temp::new();
    let m = PluginManager::new(t.0.clone(), false, vec![hash(&sample())]).unwrap();
    let p = m.install(&sample()).unwrap();
    let bytes = std::fs::read(t.0.join(format!("{}.lbplug", p.digest))).unwrap();
    assert_eq!(bytes, sample());
    std::fs::write(t.0.join(format!("{}.lbplug", p.digest)), b"{}").unwrap();
    assert_eq!(m.load(&p.digest).err().unwrap().code, "INTEGRITY_FAILED");
}

#[test]
fn compatible_upgrade_copies_state_without_overwrite_and_rollback_keeps_original() {
    let c = coordinator();
    let old = plugin();
    c.register_display("display".into()).unwrap();
    submit(&c, "before-upgrade");
    let req = request(&c, TaskStatus::Completed);
    c.storage(&req, "count", Some(json!(7))).unwrap();
    let mut next = old.clone();
    next.digest = "new-digest".into();
    next.manifest.version = "1.1.0".into();
    assert_eq!(
        c.copy_compatible_state(&old, &next).unwrap_err().code,
        "BUSY"
    );
    prepared(&c);
    c.result(req).unwrap();
    c.copy_compatible_state(&old, &next).unwrap();
    assert_eq!(
        c.copy_compatible_state(&old, &next).unwrap_err().code,
        "TARGET_NOT_EMPTY"
    );
    c.activate(Some(next.clone()), json!({"duration":4}))
        .unwrap();
    c.register_display("display2".into()).unwrap();
    submit(&c, "after-upgrade");
    assert_eq!(
        c.storage(&request(&c, TaskStatus::Completed), "count", None)
            .unwrap(),
        json!(7)
    );
    c.storage(&request(&c, TaskStatus::Completed), "count", Some(json!(8)))
        .unwrap();
    prepared(&c);
    c.result(request(&c, TaskStatus::Completed)).unwrap();
    c.activate(Some(old.clone()), json!({"duration":4}))
        .unwrap();
    c.register_display("display3".into()).unwrap();
    submit(&c, "rollback");
    assert_eq!(
        c.storage(&request(&c, TaskStatus::Completed), "count", None)
            .unwrap(),
        json!(7)
    );
    next.manifest.state_schema_version += 1;
    assert_eq!(
        c.copy_compatible_state(&old, &next).unwrap_err().code,
        "STATE_SCHEMA_MISMATCH"
    );
}
#[test]
fn duplicate_archive_paths_are_rejected() {
    let t = Temp::new();
    let m = PluginManager::new(t.0.clone(), true, vec![]).unwrap();
    let malformed = br#"{"format":"liveboom.plugin.v1","files":{"x":"eA==","x":"eA=="},"integrity":{},"signature":null}"#;
    assert_eq!(m.verify(malformed).err().unwrap().code, "INVALID_PACKAGE");
}

#[test]
fn plugin_input_schema_counts_unicode_graphemes_and_rejects_controls() {
    let schema = plugin().input_schema;
    let family = "👨‍👩‍👦";
    assert!(
        play_runtime::schema::validate(&schema, &json!({"nickname":family.repeat(32)})).is_ok()
    );
    assert!(
        play_runtime::schema::validate(&schema, &json!({"nickname":family.repeat(33)})).is_err()
    );
    assert!(play_runtime::schema::validate(&schema, &json!({"nickname":"a\u{0000}b"})).is_err());
    assert!(play_runtime::schema::validate(&schema, &json!({"nickname":""})).is_err());
}

fn schema_defaults(s: &Value) -> Value {
    if let Some(value) = s.get("default") {
        return value.clone();
    }
    if let Some(props) = s["properties"].as_object() {
        return Value::Object(
            props
                .iter()
                .map(|(k, v)| (k.clone(), schema_defaults(v)))
                .collect(),
        );
    }
    if let Some(v) = s["enum"].as_array().and_then(|a| a.first()) {
        return v.clone();
    }
    Value::Null
}
fn printer() -> PluginInfo {
    let manifest: PluginManifest =
        serde_json::from_str(include_str!("../../../plugins/printer-3d/manifest.json")).unwrap();
    PluginInfo {
        manifest,
        examples: vec![],
        digest: "a".repeat(64),
        input_schema: serde_json::from_str(include_str!(
            "../../../plugins/printer-3d/schemas/input.json"
        ))
        .unwrap(),
        config_schema: serde_json::from_str(include_str!(
            "../../../plugins/printer-3d/schemas/config.json"
        ))
        .unwrap(),
        plan_schema: Some(
            serde_json::from_str(include_str!(
                "../../../plugins/printer-3d/schemas/plan.json"
            ))
            .unwrap(),
        ),
        presentation_schema: Some(
            serde_json::from_str(include_str!(
                "../../../plugins/printer-3d/schemas/presentation.json"
            ))
            .unwrap(),
        ),
    }
}
fn printer_coordinator() -> Coordinator {
    let c = Coordinator::new(Box::new(MemoryStore::default())).unwrap();
    let p = printer();
    let config = schema_defaults(&p.config_schema);
    c.activate(Some(p), config).unwrap();
    c.register_display("3d-output".into()).unwrap();
    c
}
fn printer_submit(c: &Coordinator, id: &str, count: u32, event: &str, priority: u8) -> String {
    c.submit_local(SubmitRequest{command_id:id.into(),input:json!({"nickname":"昵称","content":"text","media":"","event":event,"quantity":count})},InputSource::Demo,priority).unwrap()
}
fn current_request(c: &Coordinator) -> ResultRequest {
    let t = c.snapshot(true).unwrap().current.unwrap();
    ResultRequest {
        task_id: t.id,
        epoch: t.epoch,
        instance: t.instance,
        status: TaskStatus::Completed,
    }
}
fn frozen_plan(count: usize) -> Value {
    json!({"nickname":"昵称","content":"text","media":"","event":"beer","scored":true,"units":vec![json!({"score":88,"size":"large"});count]})
}
#[test]
fn batch_capacity_and_plan_are_atomic_and_final_result_requires_every_unit() {
    let c = printer_coordinator();
    printer_submit(&c, "batch", 2, "beer", 0);
    let r = current_request(&c);
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().work_units, 4);
    assert!(c.prepare(r.clone(), frozen_plan(3)).is_err());
    assert!(!c.snapshot(true).unwrap().current.unwrap().prepared);
    c.prepare(r.clone(), frozen_plan(4)).unwrap();
    assert!(c.result(r.clone()).is_err());
    assert!(c.unit_done(&r, 1).is_err());
    for index in 0..4 {
        c.unit_done(&r, index).unwrap();
        c.unit_done(&r, index).unwrap();
    }
    c.result(r).unwrap();
    let t = c.snapshot(true).unwrap().history.pop().unwrap();
    assert_eq!(t.completed_units, 4);
    assert_eq!(t.unit_completed_at.len(), 4);
    assert_eq!(t.source, InputSource::Demo);
    assert!(t.finished_at.is_some());
    printer_submit(&c, "full", 50, "beer", 0);
    let before = c.snapshot(true).unwrap().version;
    assert!(c.submit_local(SubmitRequest{command_id:"overflow".into(),input:json!({"nickname":"昵称","content":"text","media":"","event":"manual","quantity":1})},InputSource::Manual,0).is_err());
    assert_eq!(c.snapshot(true).unwrap().version, before);
}
#[test]
fn preemption_preserves_frozen_scores_completed_units_and_rejects_late_callbacks() {
    let c = printer_coordinator();
    let first = printer_submit(&c, "first", 2, "beer", 0);
    let old = current_request(&c);
    c.prepare(old.clone(), frozen_plan(4)).unwrap();
    c.unit_done(&old, 0).unwrap();
    let second = printer_submit(&c, "priority", 1, "manual", 1);
    c.preempt().unwrap();
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().id, second);
    assert!(c.unit_done(&old, 1).is_err());
    assert!(c.result(old.clone()).is_err());
    c.cancel(&second).unwrap();
    let t = c.snapshot(true).unwrap().current.unwrap();
    assert_eq!(t.id, first);
    assert_ne!(t.epoch, old.epoch);
    assert_eq!(t.completed_units, 1);
    assert_eq!(t.plan.unwrap(), frozen_plan(4));
}
#[test]
fn idle_preferences_are_instance_scoped_and_display_settings_do_not_rewrite_plans() {
    let c = printer_coordinator();
    c.preferences("3d-output", "views", Some(json!([{"name":"镜头"}])))
        .unwrap();
    assert!(c.preferences("other", "views", None).is_err());
    printer_submit(&c, "first", 1, "beer", 0);
    let r = current_request(&c);
    c.prepare(r, frozen_plan(2)).unwrap();
    let p = printer();
    let presentation = schema_defaults(p.presentation_schema.as_ref().unwrap());
    c.set_presentation(presentation).unwrap();
    assert_eq!(
        c.snapshot(true).unwrap().current.unwrap().plan.unwrap(),
        frozen_plan(2)
    );
}
#[test]
fn media_is_reencoded_bounded_and_isolated_by_owner() {
    use image::{ImageFormat, RgbImage};
    let temp = Temp::new();
    let store = play_runtime::media::MediaStore(temp.0.clone());
    let mut data = std::io::Cursor::new(vec![]);
    RgbImage::new(1024, 800)
        .write_to(&mut data, ImageFormat::Png)
        .unwrap();
    let reference = store.import(&"a".repeat(64), data.get_ref()).unwrap();
    let uri = store.resolve(&"a".repeat(64), &reference).unwrap();
    assert!(uri.starts_with("data:image/png;base64,"));
    let raw = STANDARD.decode(uri.split(',').nth(1).unwrap()).unwrap();
    let decoded = image::load_from_memory(&raw).unwrap();
    assert!(decoded.width() <= 512 && decoded.height() <= 512);
    assert!(store.resolve(&"b".repeat(64), &reference).is_err());
    assert!(
        store
            .resolve(&"a".repeat(64), "media:../../secret")
            .is_err()
    );
    assert!(store.import(&"a".repeat(64), b"<svg/>").is_err());
}
#[test]
fn schema_arrays_are_bounded_and_unknown_capabilities_fail_closed() {
    use play_runtime::schema;
    assert!(schema::check_schema(&json!({"type":"array","items":{"type":"integer"}})).is_err());
    let schema =
        json!({"type":"array","maxItems":2,"items":{"type":"integer","minimum":0,"maximum":10}});
    assert!(schema::validate(&schema, &json!([1, 2])).is_ok());
    assert!(schema::validate(&schema, &json!([1, 2, 3])).is_err());
    assert!(schema::validate(&schema, &json!([-1])).is_err());
    let temp = Temp::new();
    let manager = PluginManager::new(temp.0.clone(), true, vec![]).unwrap();
    let mut b: Bundle = serde_json::from_slice(&sample()).unwrap();
    let mut m: Value =
        serde_json::from_slice(&STANDARD.decode(&b.files["manifest.json"]).unwrap()).unwrap();
    m["capabilities"] = json!(["arbitrary.network"]);
    replace(&mut b, "manifest.json", &serde_json::to_vec(&m).unwrap());
    assert_eq!(
        manager.verify(&encode(&b)).err().unwrap().code,
        "INCOMPATIBLE_CAPABILITY"
    );
}
#[test]
fn sqlite_checkpoint_has_transactional_query_projections() {
    let temp = Temp::new();
    let path = temp.0.join("db.sqlite");
    let c = Coordinator::new(Box::new(SqliteStore::open(&path).unwrap())).unwrap();
    let p = printer();
    let config = schema_defaults(&p.config_schema);
    c.activate(Some(p), config).unwrap();
    c.register_display("3d-output".into()).unwrap();
    printer_submit(&c, "stored", 1, "beer", 0);
    c.prepare(current_request(&c), frozen_plan(2)).unwrap();
    let db = rusqlite::Connection::open(&path).unwrap();
    let count: i64 = db
        .query_row("SELECT count(*) FROM runtime_work_items", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 2);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))
            .unwrap(),
        2
    );
    drop(db);
    drop(c);
    let persisted = Coordinator::new(Box::new(SqliteStore::open(&path).unwrap())).unwrap();
    assert_eq!(persisted.snapshot(true).unwrap().history.len(), 1);

    let unsupported = temp.0.join("unsupported.sqlite");
    let db = rusqlite::Connection::open(&unsupported).unwrap();
    db.execute_batch("CREATE TABLE runtime_state(id INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL, body TEXT NOT NULL); INSERT INTO runtime_state VALUES(1,1,'{}'); PRAGMA user_version=1;").unwrap();
    assert_eq!(
        SqliteStore::open(&unsupported).err().unwrap().code,
        "SCHEMA_MISMATCH"
    );
    assert_eq!(
        db.query_row("SELECT body FROM runtime_state WHERE id=1", [], |r| r
            .get::<_, String>(0))
            .unwrap(),
        "{}"
    );
}

#[test]
fn cross_schema_migration_is_data_only_atomic_and_preserves_rollback_source() {
    let c = coordinator();
    submit(&c, "source");
    c.register_display("source-output".into()).unwrap();
    let r = request(&c, TaskStatus::Completed);
    c.storage(&r, "old-key", Some(json!({"camera":1}))).unwrap();
    c.cancel(&r.task_id).unwrap();
    let source = c.snapshot(true).unwrap().active.unwrap();
    let mut target = source.clone();
    target.manifest.version = "2.0.0".into();
    target.manifest.state_schema_version = 2;
    target.digest = "b".repeat(64);
    c.migrate_state(
        &source,
        &target,
        [("old-key".into(), "new-key".into())].into(),
        [("preferences:gain".into(), json!(0.5))].into(),
    )
    .unwrap();
    assert!(
        c.migrate_state(&source, &target, Default::default(), Default::default())
            .is_err()
    );
    c.activate(Some(target), json!({"duration":4})).unwrap();
    submit(&c, "target");
    c.register_display("target-output".into()).unwrap();
    let r = request(&c, TaskStatus::Completed);
    assert_eq!(c.storage(&r, "new-key", None).unwrap(), json!({"camera":1}));
    c.cancel(&r.task_id).unwrap();
    c.activate(Some(source), json!({"duration":4})).unwrap();
    submit(&c, "rollback");
    c.register_display("source-again".into()).unwrap();
    assert_eq!(
        c.storage(&request(&c, TaskStatus::Completed), "old-key", None)
            .unwrap(),
        json!({"camera":1})
    );
}
#[test]
fn new_rule_config_does_not_change_accepted_tasks_and_demo_reset_keeps_manual_data() {
    let c = printer_coordinator();
    printer_submit(&c, "demo", 1, "beer", 0);
    let original = c.snapshot(true).unwrap().current.unwrap().config;
    let mut config = original.clone();
    config["rules"]["beer"]["units"] = json!(3);
    c.configure(config.clone()).unwrap();
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().config, original);
    let input = json!({"nickname":"手动","content":"text","media":"","event":"beer","quantity":1});
    c.submit(SubmitRequest {
        command_id: "manual".into(),
        input,
    })
    .unwrap();
    assert_eq!(c.snapshot(true).unwrap().queue[0].work_units, 3);
    c.reset_demo().unwrap();
    let s = c.snapshot(true).unwrap();
    assert_eq!(s.current.unwrap().source, InputSource::Manual);
    assert!(s.history.is_empty());
    assert_eq!(s.config, config);
}

#[test]
fn preview_and_export_dimensions_are_checked_in_addition_to_byte_quotas() {
    use image::{ImageFormat, RgbImage};
    let mut data = std::io::Cursor::new(vec![]);
    RgbImage::new(640, 360)
        .write_to(&mut data, ImageFormat::Jpeg)
        .unwrap();
    assert!(play_runtime::media::validate_preview(data.get_ref()).is_ok());
    let mut oversized = std::io::Cursor::new(vec![]);
    RgbImage::new(641, 360)
        .write_to(&mut oversized, ImageFormat::Jpeg)
        .unwrap();
    assert!(play_runtime::media::validate_preview(oversized.get_ref()).is_err());
    assert!(play_runtime::media::validate_export(data.get_ref()).is_err());
}

#[test]
fn priority_bursts_cannot_starve_an_accepted_ordinary_task() {
    let c = coordinator();
    c.register_display("fair-output".into()).unwrap();
    let high = |id: &str| {
        c.submit_local(
            SubmitRequest {
                command_id: id.into(),
                input: json!({"nickname":id}),
            },
            InputSource::Manual,
            1,
        )
        .unwrap()
    };
    let first = high("h1");
    let ordinary = submit(&c, "ordinary");
    let second = high("h2");
    let third = high("h3");
    high("h4");
    c.cancel(&first).unwrap();
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().id, second);
    c.cancel(&second).unwrap();
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().id, third);
    c.cancel(&third).unwrap();
    assert_eq!(c.snapshot(true).unwrap().current.unwrap().id, ordinary);
}

#[test]
fn printer_manifest_schemas_capabilities_and_examples_verify_together() {
    let temp = Temp::new();
    let manager = PluginManager::new(temp.0.clone(), true, vec![]).unwrap();
    let mut bundle: Bundle = serde_json::from_slice(&sample()).unwrap();
    for (path, data) in [
        (
            "manifest.json",
            include_str!("../../../plugins/printer-3d/manifest.json"),
        ),
        (
            "schemas/input.json",
            include_str!("../../../plugins/printer-3d/schemas/input.json"),
        ),
        (
            "schemas/config.json",
            include_str!("../../../plugins/printer-3d/schemas/config.json"),
        ),
        (
            "schemas/plan.json",
            include_str!("../../../plugins/printer-3d/schemas/plan.json"),
        ),
        (
            "schemas/presentation.json",
            include_str!("../../../plugins/printer-3d/schemas/presentation.json"),
        ),
        (
            "schemas/examples.json",
            include_str!("../../../plugins/printer-3d/schemas/examples.json"),
        ),
    ] {
        replace(&mut bundle, path, data.as_bytes());
    }
    replace(
        &mut bundle,
        "web/control.html",
        b"<main>React control fixture</main>",
    );
    let verified = manager.verify(&encode(&bundle)).unwrap();
    assert_eq!(verified.info.examples.len(), 9);
    assert!(
        verified
            .info
            .manifest
            .capabilities
            .iter()
            .any(|c| c == "control.viewport.v1")
    );
    assert!(verified.info.plan_schema.is_some());
}

#[test]
fn control_entry_requires_a_verified_capability_and_separate_document() {
    let temp = Temp::new();
    let manager = PluginManager::new(temp.0.clone(), true, vec![]).unwrap();
    let mut bundle: Bundle = serde_json::from_slice(&sample()).unwrap();
    let mut manifest: Value =
        serde_json::from_slice(&STANDARD.decode(&bundle.files["manifest.json"]).unwrap()).unwrap();
    manifest["controlEntry"] = json!("web/control.html");
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    replace(
        &mut bundle,
        "web/control.html",
        b"<main>PRIVATE_CONTROL_UI</main>",
    );
    assert!(manager.verify(&encode(&bundle)).is_err());
    manifest["capabilities"] = json!(["control.v1", "control.viewport.v1"]);
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    let installed = manager.install(&encode(&bundle)).unwrap();
    let control = manager.document_for(&installed.digest, true).unwrap();
    assert!(control.contains("PRIVATE_CONTROL_UI"));
    assert!(control.contains("connect-src 'none'"));
    assert!(
        !manager
            .document(&installed.digest)
            .unwrap()
            .contains("PRIVATE_CONTROL_UI")
    );
    manifest["capabilities"] = json!(["control.v1"]);
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert_eq!(
        manager.verify(&encode(&bundle)).err().unwrap().code,
        "INVALID_MANIFEST"
    );
    manifest["capabilities"] = json!(["control.viewport.v1"]);
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert_eq!(
        manager.verify(&encode(&bundle)).err().unwrap().code,
        "INVALID_MANIFEST"
    );
    manifest["capabilities"] = json!(["control.v1", "control.viewport.v1"]);
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert!(manager.verify(&encode(&bundle)).is_ok());
    manifest["controlEntry"] = json!("../control.html");
    replace(
        &mut bundle,
        "manifest.json",
        &serde_json::to_vec(&manifest).unwrap(),
    );
    assert!(manager.verify(&encode(&bundle)).is_err());
}
