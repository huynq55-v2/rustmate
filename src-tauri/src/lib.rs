// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
pub mod commands;
pub mod database;
pub mod models;
pub mod security;
pub mod state;
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
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::unlock_vault,
            commands::init_vault,
            commands::close_vault,
            commands::create_shard,
            commands::get_shards,
            commands::import_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
