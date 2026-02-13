use crate::database::VaultManager;
use crate::security;
use crate::state::AppState;
use std::fs;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

pub fn asset_protocol_handler(
    app: &AppHandle,
    request: Request<Vec<u8>>,
) -> Result<Response<Vec<u8>>, Box<dyn std::error::Error>> {
    let path = request.uri().path();
    let id_str = path.trim_start_matches('/');

    if id_str.is_empty() {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .body("Missing asset ID".as_bytes().to_vec())
            .map_err(|e| e.into());
    }

    let state = app.state::<AppState>();

    let vault_guard = state
        .vault
        .lock()
        .map_err(|_| "Failed to lock vault state")?;

    let manager = match vault_guard.as_ref() {
        Some(m) => m,
        None => {
            return Response::builder()
                .status(StatusCode::FORBIDDEN)
                .body("Vault is locked".as_bytes().to_vec())
                .map_err(|e| e.into());
        }
    };

    // Query DB
    let (file_filename, mime_type): (String, String) = manager
        .conn
        .query_row(
            "SELECT file_path, mime_type FROM assets WHERE id = ?1",
            [id_str],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| {
            println!("Asset not found in DB: {} ({})", id_str, e);
            "Asset not found"
        })?;

    println!("Serving Asset: {} Mime: {}", id_str, mime_type);

    let full_path = manager.asset_path.join(&file_filename);
    let key = manager.asset_key;

    // Additional logging for path
    if !full_path.exists() {
        println!("File not found at path: {:?}", full_path);
        return Err("File not found on disk".into());
    }

    drop(vault_guard);

    let encrypted_data = fs::read(&full_path).map_err(|e| {
        println!("Failed to read file: {}", e);
        "Failed to read file"
    })?;

    let decrypted_data = security::decrypt_data(&encrypted_data, &key).map_err(|e| {
        println!("Failed to decrypt: {}", e);
        "Failed to decrypt"
    })?;

    let total_len = decrypted_data.len() as u64;

    if let Some(range_header) = request.headers().get("Range") {
        if let Ok(range_str) = range_header.to_str() {
            if let Some(range_s) = range_str.strip_prefix("bytes=") {
                let parts: Vec<&str> = range_s.split('-').collect();
                let start = parts[0].parse::<u64>().unwrap_or(0);
                let end = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse::<u64>().unwrap_or(total_len - 1)
                } else {
                    total_len - 1
                };

                if start <= end && start < total_len {
                    let end = std::cmp::min(end, total_len - 1);
                    let chunk = decrypted_data[start as usize..=end as usize].to_vec();

                    return Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(
                            "Content-Range",
                            format!("bytes {}-{}/{}", start, end, total_len),
                        )
                        .header("Content-Length", chunk.len())
                        .header("Content-Type", &mime_type)
                        .header("Access-Control-Allow-Origin", "*")
                        .header("Accept-Ranges", "bytes")
                        .body(chunk)
                        .map_err(|e| e.into());
                } else {
                    return Response::builder()
                        .status(StatusCode::RANGE_NOT_SATISFIABLE)
                        .header("Content-Range", format!("bytes */{}", total_len))
                        .body(vec![])
                        .map_err(|e| e.into());
                }
            }
        }
    }

    Response::builder()
        .header("Content-Type", &mime_type)
        .header("Access-Control-Allow-Origin", "*")
        .header("Accept-Ranges", "bytes")
        .body(decrypted_data)
        .map_err(|e| e.into())
}
