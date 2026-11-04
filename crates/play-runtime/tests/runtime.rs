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
        let p = std::env::temp_dir().join(format!("likeboom-{}", new_id()));
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
        format: "likeboom.plugin.v1".into(),
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
    let malformed = br#"{"format":"likeboom.plugin.v1","files":{"x":"eA==","x":"eA=="},"integrity":{},"signature":null}"#;
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
