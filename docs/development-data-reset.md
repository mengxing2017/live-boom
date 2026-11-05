# 开发数据目录与删库重置

## 何时需要重置

项目尚未上线，不维护旧开发数据的向后兼容。更新代码后如果启动报 `STORAGE_CORRUPT: unknown variant legacy_local, expected manual or demo`，原因是原数据库保存了已删除的任务来源枚举。外层的 `Failed to setup app` / `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` 是应用初始化失败的后续错误，不是 pnpm 或 Rust 工具链故障。

这属于开发数据与当前代码结构不匹配。重新构建或删除 `target/` 不会清理运行数据；无需恢复旧枚举或引入迁移兼容。旧字段、检查点结构变化引发的反序列化错误，以及 `SCHEMA_MISMATCH`，也可按此流程重置。

## 数据库位置

宿主使用 Tauri `app.path().app_data_dir()`，应用标识为 `com.liveboom.desktop`，数据库文件名为 `liveboom.sqlite`。路径与项目源码目录无关；开发版与相同标识的安装版共用数据目录。

| 系统 | 应用数据目录 | 数据库 |
| --- | --- | --- |
| Linux | `${XDG_DATA_HOME:-$HOME/.local/share}/com.liveboom.desktop` | 目录内 `liveboom.sqlite` |
| Windows | `%APPDATA%\com.liveboom.desktop` | 目录内 `liveboom.sqlite` |
| macOS | `~/Library/Application Support/com.liveboom.desktop` | 目录内 `liveboom.sqlite` |

当前命名下，本开发环境的默认数据库位置（首次启动时创建）：

```text
/home/dev/.local/share/com.liveboom.desktop/liveboom.sqlite
```

Linux 的 `XDG_DATA_HOME` 应以实际启动应用的终端环境为准。WAL 模式还可能产生 `liveboom.sqlite-wal` 和 `liveboom.sqlite-shm`，它们属于同一数据库，处理时不能遗漏。

## 推荐：备份整个目录后重新初始化

先停止 `tauri dev`，关闭控制窗与展示窗，确认没有 liveboom 进程仍占用该目录。下面的命令通过重命名保留数据，不执行永久删除；下次启动由应用创建新目录、新库和当前示例插件。

Linux（在启动应用的同一终端环境执行）：

```sh
liveboom_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/com.liveboom.desktop"
liveboom_backup_dir="${liveboom_data_dir}.backup-$(date +%Y%m%d-%H%M%S)-$$"
mv -- "$liveboom_data_dir" "$liveboom_backup_dir"
printf '已备份到 %s\n' "$liveboom_backup_dir"
devbox run desktop
```

Windows PowerShell：

```powershell
$liveboomDataDir = Join-Path $env:APPDATA 'com.liveboom.desktop'
$liveboomBackupDir = "$liveboomDataDir.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')-$PID"
Move-Item -LiteralPath $liveboomDataDir -Destination $liveboomBackupDir
Write-Host "已备份到 $liveboomBackupDir"
pnpm tauri dev
```

macOS：

```sh
liveboom_data_dir="$HOME/Library/Application Support/com.liveboom.desktop"
liveboom_backup_dir="${liveboom_data_dir}.backup-$(date +%Y%m%d-%H%M%S)-$$"
mv "$liveboom_data_dir" "$liveboom_backup_dir"
printf '已备份到 %s\n' "$liveboom_backup_dir"
pnpm tauri dev
```

该流程重置队列、历史、命令回执、插件配置与状态、已安装插件、发布者信任、导入素材及目录内窗口/采集偏好。备份保存原数据，但不意味着当前代码可以重新打开旧数据。重新启动后检查默认昵称登记可用，再启用 3D 制作台进行操作。

## 只重置数据库

如果确定需要保留插件文件、素材文件和窗口偏好，可仅备份数据库及其 WAL/SHM。仍必须先完全退出应用。Linux 示例：

```sh
liveboom_data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/com.liveboom.desktop"
liveboom_db_backup_dir="${liveboom_data_dir}.db-backup-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -- "$liveboom_db_backup_dir"
for liveboom_db_file in liveboom.sqlite liveboom.sqlite-wal liveboom.sqlite-shm; do
  if [ -f "$liveboom_data_dir/$liveboom_db_file" ]; then
    mv -- "$liveboom_data_dir/$liveboom_db_file" "$liveboom_db_backup_dir/"
  fi
done
printf '数据库已备份到 %s\n' "$liveboom_db_backup_dir"
devbox run desktop
```

新库会丢失旧队列、历史、命令回执和插件状态，保留的素材不自动恢复旧引用。不要只删除 JSON 中的 `legacy_local` 或手工修改 SQLite 投影表；检查点和投影由宿主事务统一维护。如果随后遇到旧插件不受信任或同版本包内容冲突，采用上面的整个目录重置流程。

目录内的 `liveboom.before-v2-*.sqlite` 属于此前开发代码生成的历史备份，当前代码不再生成或自动读取它们。`hsts-storage.sqlite` 等 WebKit 数据库不是业务数据库，不应当作 `liveboom.sqlite` 单独操作。

## 实现依据

- `apps/desktop/src-tauri/tauri.conf.json`：应用标识。
- `apps/desktop/src-tauri/src/lib.rs`：`app_data_dir()`、`liveboom.sqlite`、新库初始化和示例插件安装。
- `crates/play-runtime/src/persistence/mod.rs`：SQLite WAL、当前检查点版本校验。

项目重命名同步更换了应用标识和数据库文件名，首次运行会使用新的数据目录，不自动迁移旧开发数据。本次未删除或修改实际运行数据库。
