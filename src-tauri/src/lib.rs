// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod database;
pub mod models;
pub mod protocol;
pub mod security;
pub mod server;
pub mod state;
use tauri::Manager;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_uri_scheme_protocol("asset", |ctx, req| {
            match protocol::asset_protocol_handler(ctx.app_handle(), req) {
                Ok(r) => r,
                Err(e) => tauri::http::Response::builder()
                    .status(500)
                    .body(e.to_string().into_bytes())
                    .unwrap(),
            }
        })
        .manage(state::AppState::default())
        .setup(|app| {
            let state = app.state::<state::AppState>();
            let state_cloned = state.inner().clone();

            tauri::async_runtime::spawn(async move {
                match server::start_server(state_cloned.clone()).await {
                    Ok(port) => {
                        println!("Server running on port {}", port);
                        *state_cloned.server_port.lock().unwrap() = port;
                    }
                    Err(e) => eprintln!("Failed to start server: {}", e),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::unlock_vault,
            commands::init_vault,
            commands::close_vault,
            commands::check_vault_status,
            commands::create_shard,
            commands::update_shard,
            commands::delete_shard,
            commands::get_shards,
            commands::import_asset,
            commands::delete_asset,
            commands::get_server_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
