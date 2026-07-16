use std::{
    error::Error,
    fs,
    fs::File,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct ServerProcess(Mutex<Option<Child>>);

impl Drop for ServerProcess {
    fn drop(&mut self) {
        shutdown_child_process(&self.0);
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                shutdown_server_process(window.app_handle());
            }
        })
        .setup(|app| {
            app.manage(ServerProcess(Mutex::new(None)));
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External("about:blank".parse()?),
            )
            .title("NeuroBook")
            .inner_size(1440.0, 920.0)
            .min_inner_size(1024.0, 720.0)
            .build()?;
            window.eval(&format!(
                "document.open();document.write({});document.close();",
                js_string_literal(loading_html())
            ))?;

            let handle = app.handle().clone();
            thread::spawn(move || {
                let Some(window) = handle.get_webview_window("main") else {
                    return;
                };
                let result =
                    boot_product_server(&handle, |message, _progress, _remaining_seconds| {
                        append_startup_log(&format!("progress: {message}"));
                    });
                match result {
                    Ok((url, child)) => {
                        let state = handle.state::<ServerProcess>();
                        if let Ok(mut stored_child) = state.0.lock() {
                            *stored_child = Some(child);
                        }
                        if let Ok(parsed_url) = url.parse() {
                            let _ = window.navigate(parsed_url);
                        }
                    }
                    Err(error) => {
                        show_loading_error(&window, &error.to_string());
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build NeuroBook Tauri app")
        .run(|app, event| {
            if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
                shutdown_server_process(app);
            }
        });
}

fn shutdown_server_process(app: &tauri::AppHandle) {
    let state = app.state::<ServerProcess>();
    shutdown_child_process(&state.0);
}

fn shutdown_child_process(process_slot: &Mutex<Option<Child>>) {
    if let Ok(mut child) = process_slot.lock() {
        if let Some(mut process) = child.take() {
            terminate_process_tree(&mut process);
        }
    }
}

fn terminate_process_tree(process: &mut Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &process.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
        return;
    }

    #[cfg(not(windows))]
    {
        let _ = process.kill();
    }
}

fn boot_product_server(
    app: &tauri::AppHandle,
    progress: impl Fn(&str, u8, u64),
) -> Result<(String, Child), Box<dyn Error>> {
    append_startup_log("boot thread started");
    progress("定位桌面版数据目录", 8, 80);
    let resource_dir = app.path().resource_dir()?;
    append_startup_log(&format!("resource_dir={}", resource_dir.display()));
    let product_root = resolve_product_root(app)?;
    append_startup_log(&format!("product_root={}", product_root.display()));
    progress("检查并解压运行时文件", 15, 75);
    let product_root = sync_product_runtime(
        &resource_dir.join("product.zip"),
        &resource_dir.join("product-build-id"),
        &product_root,
    )?;
    append_startup_log("product runtime ready");
    let bun = resource_dir.join("runtime").join("bun").join("bun.exe");
    if !bun.exists() {
        return Err(format!("bundled bun runtime not found: {}", bun.display()).into());
    }

    let port = reserve_port()?;
    append_startup_log(&format!("reserved_port={port}"));
    progress("准备用户资产和本地数据库", 48, 45);
    let envs = product_env(&product_root, port);
    let log_root = product_root.join("logs");
    fs::create_dir_all(&log_root)?;
    append_startup_log(&format!("log_root={}", log_root.display()));
    run_database_migration(&bun, &product_root, &envs, &log_root)?;
    append_startup_log("database migration applied");
    run_prepare_system_assets(&bun, &product_root, &envs, &log_root)?;
    append_startup_log("system assets prepared");

    progress("启动本地服务", 72, 25);
    let entry = product_root
        .join(".output")
        .join("server")
        .join("index.mjs");
    let server_stdout = File::create(log_root.join("tauri-server.stdout.log"))?;
    let server_stderr = File::create(log_root.join("tauri-server.stderr.log"))?;
    let mut command = hidden_command(&bun);
    let mut child = command
        .arg(entry)
        .current_dir(&product_root)
        .envs(envs)
        .stdin(Stdio::null())
        .stdout(Stdio::from(server_stdout))
        .stderr(Stdio::from(server_stderr))
        .spawn()?;
    append_startup_log("nitro process spawned");
    wait_for_server(&mut child, port, Duration::from_secs(120), |elapsed| {
        let progress_value = 74_u8
            .saturating_add((elapsed.as_secs().min(110) / 5) as u8)
            .min(98);
        let remaining = 120_u64.saturating_sub(elapsed.as_secs());
        progress("等待本地服务就绪", progress_value, remaining);
    })?;
    append_startup_log("nitro server ready");
    Ok((format!("http://127.0.0.1:{port}/"), child))
}

fn resolve_product_root(app: &tauri::AppHandle) -> Result<PathBuf, Box<dyn Error>> {
    let exe_dir = std::env::current_exe()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("failed to resolve executable directory")?;
    let portable_root = exe_dir.join("data");
    let portable_product = portable_root.join("product");
    if ensure_writable_dir(&portable_root).is_ok() {
        return Ok(portable_product);
    }

    Ok(app.path().app_data_dir()?.join("product"))
}

fn ensure_writable_dir(path: &Path) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(path)?;
    let probe = path.join(".write-test");
    fs::write(&probe, b"ok")?;
    fs::remove_file(probe)?;
    Ok(())
}

fn sync_product_runtime(
    archive_path: &Path,
    marker_path: &Path,
    target: &Path,
) -> Result<PathBuf, Box<dyn Error>> {
    if !archive_path.exists() {
        return Err(format!(
            "bundled product archive not found: {}",
            archive_path.display()
        )
        .into());
    }

    let source_marker = fs::read_to_string(marker_path).unwrap_or_default();
    let target_marker = fs::read_to_string(target.join(".tauri-build-id")).unwrap_or_default();
    if target.exists()
        && product_markers_match(&source_marker, &target_marker)
        && product_runtime_ready(target)
    {
        fs::create_dir_all(target.join("workspace").join(".nbook"))?;
        return Ok(target.to_path_buf());
    }

    let preserved_root = target.with_extension("preserved");
    if preserved_root.exists() {
        fs::remove_dir_all(&preserved_root)?;
    }
    preserve_user_runtime_paths(target, &preserved_root)?;
    if target.exists() {
        fs::remove_dir_all(target)?;
    }
    extract_product_archive(archive_path, target)?;
    restore_user_runtime_paths(target, &preserved_root)?;
    Ok(target.to_path_buf())
}

fn preserve_user_runtime_paths(target: &Path, preserved_root: &Path) -> Result<(), Box<dyn Error>> {
    if !target.exists() {
        return Ok(());
    }
    fs::create_dir_all(preserved_root)?;
    for name in ["workspace", "logs"] {
        let source = target.join(name);
        if source.exists() {
            fs::rename(&source, preserved_root.join(name))?;
        }
    }
    Ok(())
}

fn product_markers_match(source_marker: &str, target_marker: &str) -> bool {
    let source_marker = source_marker.trim();
    let target_marker = target_marker.trim();
    !source_marker.is_empty() && source_marker == target_marker
}

fn product_runtime_ready(target: &Path) -> bool {
    let server_root = target.join(".output").join("server");
    server_root.join("index.mjs").exists()
        && server_root
            .join("chunks")
            .join("_")
            .join("nitro.mjs")
            .exists()
        && direct_bun_runtime_imports_ready(&server_root)
}

fn direct_bun_runtime_imports_ready(server_root: &Path) -> bool {
    let mut pending = vec![server_root.to_path_buf()];
    while let Some(path) = pending.pop() {
        let Ok(entries) = fs::read_dir(path) else {
            return false;
        };
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if entry_path.is_dir() {
                if entry_path.file_name().and_then(|value| value.to_str()) == Some("node_modules") {
                    continue;
                }
                pending.push(entry_path);
                continue;
            }
            if entry_path.extension().and_then(|value| value.to_str()) != Some("mjs") {
                continue;
            }
            let Ok(text) = fs::read_to_string(&entry_path) else {
                return false;
            };
            if !direct_bun_imports_ready_for_text(server_root, &text) {
                return false;
            }
        }
    }
    true
}

fn direct_bun_imports_ready_for_text(server_root: &Path, text: &str) -> bool {
    const MARKER: &str = "node_modules/.bun/";
    for line in text.lines() {
        let trimmed = line.trim_start();
        if !trimmed.starts_with("import ") && !trimmed.starts_with("export ") {
            continue;
        }
        let mut remaining = trimmed;
        while let Some(index) = remaining.find(MARKER) {
            let import_path = &remaining[index..];
            let end = import_path
                .find(|ch: char| matches!(ch, '\'' | '"' | '`') || ch.is_whitespace())
                .unwrap_or(import_path.len());
            let runtime_path = import_path[..end].replace('/', std::path::MAIN_SEPARATOR_STR);
            if !server_root.join(runtime_path).exists() {
                return false;
            }
            remaining = &import_path[end..];
        }
    }
    true
}

fn restore_user_runtime_paths(target: &Path, preserved_root: &Path) -> Result<(), Box<dyn Error>> {
    if !preserved_root.exists() {
        fs::create_dir_all(target.join("workspace").join(".nbook"))?;
        return Ok(());
    }
    for name in ["workspace", "logs"] {
        let preserved = preserved_root.join(name);
        if preserved.exists() {
            let output = target.join(name);
            if output.exists() {
                fs::remove_dir_all(&output)?;
            }
            fs::rename(preserved, output)?;
        }
    }
    fs::remove_dir_all(preserved_root)?;
    fs::create_dir_all(target.join("workspace").join(".nbook"))?;
    Ok(())
}

fn extract_product_archive(archive_path: &Path, target: &Path) -> Result<(), Box<dyn Error>> {
    fs::create_dir_all(target)?;
    let file = File::open(archive_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        let Some(relative_path) = entry.enclosed_name() else {
            continue;
        };
        let output_path = target.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)?;
        } else {
            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output = File::create(&output_path)?;
            std::io::copy(&mut entry, &mut output)?;
        }
    }
    Ok(())
}

fn reserve_port() -> Result<u16, Box<dyn Error>> {
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn product_env(product_root: &Path, port: u16) -> Vec<(String, String)> {
    let data_root = product_root.join("workspace");
    let log_root = product_root.join("logs");
    let mut envs = read_product_env(product_root);
    envs.extend([
        ("NODE_ENV".into(), "production".into()),
        ("HOST".into(), "127.0.0.1".into()),
        ("PORT".into(), port.to_string()),
        ("NITRO_PORT".into(), port.to_string()),
        ("NUXT_PORT".into(), port.to_string()),
        ("DATABASE_KIND".into(), "sqlite".into()),
        (
            "DATABASE_URL".into(),
            "file:./workspace/.nbook/neuro-book.sqlite".into(),
        ),
        ("NEURO_BOOK_LOG_DIR".into(), log_root.display().to_string()),
        ("NEURO_BOOK_TAURI".into(), "1".into()),
        (
            "NEURO_BOOK_PRODUCT_ROOT".into(),
            product_root.display().to_string(),
        ),
        (
            "NEURO_BOOK_WORKSPACE_ROOT".into(),
            data_root.display().to_string(),
        ),
    ]);
    envs
}

fn read_product_env(product_root: &Path) -> Vec<(String, String)> {
    let Ok(text) = fs::read_to_string(product_root.join(".env")) else {
        return Vec::new();
    };
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                return None;
            }
            let (key, value) = trimmed.split_once('=')?;
            Some((
                key.trim().to_string(),
                value
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .to_string(),
            ))
        })
        .collect()
}

fn run_prepare_system_assets(
    bun: &Path,
    product_root: &Path,
    envs: &[(String, String)],
    log_root: &Path,
) -> Result<(), Box<dyn Error>> {
    let script = product_root
        .join(".output")
        .join("server")
        .join("scripts")
        .join("build")
        .join("prepare-system-assets.ts");
    let prepare_stdout = File::create(log_root.join("tauri-prepare.stdout.log"))?;
    let prepare_stderr = File::create(log_root.join("tauri-prepare.stderr.log"))?;
    let mut command = hidden_command(bun);
    let status = command
        .arg(script)
        .arg("--sync-user-assets")
        .current_dir(product_root)
        .envs(envs.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::from(prepare_stdout))
        .stderr(Stdio::from(prepare_stderr))
        .status()?;
    if !status.success() {
        return Err(format!("prepare-system-assets failed with status: {status}").into());
    }
    Ok(())
}

fn run_database_migration(
    bun: &Path,
    product_root: &Path,
    envs: &[(String, String)],
    log_root: &Path,
) -> Result<(), Box<dyn Error>> {
    let script = product_root
        .join(".output")
        .join("server")
        .join("scripts")
        .join("db")
        .join("prisma-migrate.mjs");
    let migrate_stdout = File::create(log_root.join("tauri-migrate.stdout.log"))?;
    let migrate_stderr = File::create(log_root.join("tauri-migrate.stderr.log"))?;
    let mut command = hidden_command(bun);
    let status = command
        .arg(script)
        .arg("--deploy")
        .current_dir(product_root)
        .envs(envs.iter().cloned())
        .stdin(Stdio::null())
        .stdout(Stdio::from(migrate_stdout))
        .stderr(Stdio::from(migrate_stderr))
        .status()?;
    if !status.success() {
        return Err(format!("database migration failed with status: {status}").into());
    }
    Ok(())
}

fn hidden_command(program: &Path) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn wait_for_server(
    child: &mut Child,
    port: u16,
    timeout: Duration,
    progress: impl Fn(Duration),
) -> Result<(), Box<dyn Error>> {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if http_health_check(port).is_ok() {
            return Ok(());
        }
        if let Some(status) = child.try_wait()? {
            return Err(format!(
                "Nitro server exited before becoming ready on port {port}: {status}"
            )
            .into());
        }
        progress(start.elapsed());
        thread::sleep(Duration::from_millis(250));
    }
    Err(format!("Nitro server did not become ready on port {port}").into())
}

fn http_health_check(port: u16) -> Result<(), Box<dyn Error>> {
    let mut stream = TcpStream::connect(("127.0.0.1", port))?;
    stream.set_read_timeout(Some(Duration::from_secs(2)))?;
    stream.set_write_timeout(Some(Duration::from_secs(2)))?;
    stream.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")?;
    let mut buffer = [0_u8; 256];
    let read = stream.read(&mut buffer)?;
    if read == 0 {
        return Err("health check returned empty response".into());
    }
    let head = String::from_utf8_lossy(&buffer[..read]);
    if head.starts_with("HTTP/") {
        return Ok(());
    }
    Err("health check failed".into())
}

fn loading_html() -> &'static str {
    r#"<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color:#4c3924;background:#f4ead6;font-family:"Microsoft YaHei",serif}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#fff8e8 0,#f4ead6 38%,#e4d0aa 100%)}
.card{width:min(560px,calc(100vw - 48px));padding:34px 38px;border:1px solid rgba(115,82,43,.22);border-radius:24px;background:rgba(255,250,239,.78);box-shadow:0 24px 70px rgba(84,58,25,.18)}
.brand{font-size:13px;letter-spacing:.34em;font-weight:700;color:#9b6a34}
h1{margin:14px 0 8px;font-size:30px;line-height:1.15;color:#3f2d1d}
.status{min-height:24px;margin:0 0 24px;color:#6d563d}
.bar{height:10px;overflow:hidden;border-radius:999px;background:#e2cfaa}
.fill{height:100%;width:0%;border-radius:inherit;background:linear-gradient(90deg,#b77a35,#d8a85b);transition:width .35s ease}
.meta{display:flex;justify-content:space-between;margin-top:12px;color:#7a6246;font-size:13px}
.error{display:none;margin-top:18px;padding:14px;border-radius:14px;background:#fff0ed;color:#8d2f20;white-space:pre-wrap}
</style>
</head>
<body>
<main class="card">
<div class="brand">NEURO BOOK</div>
<h1>正在启动本地工作区</h1>
<p id="status" class="status">准备启动...</p>
<div class="bar"><div id="fill" class="fill"></div></div>
<div class="meta"><span id="percent">0%</span><span id="eta">预计剩余时间计算中</span></div>
<div id="error" class="error"></div>
</main>
<script>
const stages=[
  [0,"定位桌面版数据目录",8],
  [4,"检查并解压运行时文件",20],
  [12,"准备用户资产和本地数据库",48],
  [28,"启动本地服务",72],
  [38,"等待本地服务就绪",84],
  [55,"仍在启动，首次打开可能较慢",92]
];
const started=Date.now();
const totalSeconds=85;
function renderAutoProgress(){
  const elapsed=Math.floor((Date.now()-started)/1000);
  const stage=stages.toReversed().find(([second])=>elapsed>=second) || stages[0];
  const nextStage=stages.find(([second])=>second>elapsed);
  const base=stage[2];
  const next=nextStage ? nextStage[2] : 98;
  const span=Math.max(1,(nextStage ? nextStage[0] : totalSeconds)-stage[0]);
  const progress=Math.min(98,base+((elapsed-stage[0])/span)*(next-base));
  const remaining=Math.max(1,totalSeconds-elapsed);
  window.__nbookStartupUpdate(stage[1],progress,remaining);
}
window.__nbookStartupUpdate=function(message,progress,remainingSeconds){
  document.getElementById("status").textContent=message;
  document.getElementById("fill").style.width=Math.max(0,Math.min(100,progress))+"%";
  document.getElementById("percent").textContent=Math.round(progress)+"%";
  document.getElementById("eta").textContent=remainingSeconds>0 ? "预计剩余 "+remainingSeconds+" 秒" : "即将完成";
};
window.__nbookStartupError=function(message){
  document.getElementById("status").textContent="启动失败";
  const error=document.getElementById("error");
  error.style.display="block";
  error.textContent=message;
};
renderAutoProgress();
setInterval(renderAutoProgress,1000);
</script>
</body>
</html>"#
}

fn show_loading_error(window: &WebviewWindow, message: &str) {
    append_startup_log(&format!("startup error: {message}"));
    let script = format!(
        "window.__nbookStartupError?.({});",
        js_string_literal(message)
    );
    let eval_window = window.clone();
    let _ = window.run_on_main_thread(move || {
        let _ = eval_window.eval(script);
    });
}

fn append_startup_log(message: &str) {
    let log_path = std::env::current_exe()
        .ok()
        .and_then(|path| {
            path.parent()
                .map(|parent| parent.join("data").join("tauri-startup.log"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("neuro-book-tauri-startup.log"));
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    {
        let _ = writeln!(file, "[{:?}] {}", std::time::SystemTime::now(), message);
    }
}

fn js_string_literal(value: &str) -> String {
    let mut output = String::from("\"");
    for character in value.chars() {
        match character {
            '\\' => output.push_str("\\\\"),
            '"' => output.push_str("\\\""),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            character if character.is_control() => {
                output.push_str(&format!("\\u{:04x}", character as u32))
            }
            character => output.push(character),
        }
    }
    output.push('"');
    output
}
