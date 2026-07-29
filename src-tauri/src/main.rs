#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent};

const SIDECAR_NAME: &str = "vocab-api.exe";
const API_PORT: &str = "18432";

struct Sidecar(Mutex<Option<Child>>);

fn sidecar_path(app: &tauri::App) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if cfg!(debug_assertions) {
        return Ok(PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(SIDECAR_NAME));
    }
    Ok(app.path().resource_dir()?.join(SIDECAR_NAME))
}

fn start_sidecar(app: &tauri::App) -> Result<Child, Box<dyn std::error::Error>> {
    let path = sidecar_path(app)?;
    if !path.is_file() {
        return Err(format!("未找到 FastAPI sidecar：{}", path.display()).into());
    }
    Ok(Command::new(path)
        .args(["--host", "127.0.0.1", "--port", API_PORT])
        .spawn()?)
}

fn wait_for_sidecar() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = format!("127.0.0.1:{API_PORT}").parse()?;
    let deadline = Instant::now() + Duration::from_secs(15);
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(250)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(150));
    }
    Err("FastAPI sidecar 启动超时。".into())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut child = start_sidecar(app)?;
            if let Err(error) = wait_for_sidecar() {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
            app.manage(Sidecar(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("构建 Tauri 应用失败")
        .run(|app_handle, event| {
            if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
                if let Some(state) = app_handle.try_state::<Sidecar>() {
                    if let Ok(mut child) = state.0.lock() {
                        if let Some(mut process) = child.take() {
                            let _ = process.kill();
                            let _ = process.wait();
                        }
                    }
                }
            }
        });
}