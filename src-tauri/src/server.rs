use crate::security;
use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tower_http::cors::CorsLayer;

pub async fn start_server(app_state: AppState) -> Result<u16, Box<dyn std::error::Error>> {
    let app = Router::new()
        .route("/asset/:id", get(get_asset))
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 0));
    let listener = TcpListener::bind(addr).await?;
    let port = listener.local_addr()?.port();

    println!("Asset Server started on port: {}", port);

    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });

    Ok(port)
}

async fn get_asset(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let vault_guard = match state.vault.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to lock vault").into_response()
        }
    };

    let manager = match vault_guard.as_ref() {
        Some(m) => m,
        None => return (StatusCode::FORBIDDEN, "Vault locked").into_response(),
    };

    // Query DB
    let (file_filename, mime_type): (String, String) = match manager.conn.query_row(
        "SELECT file_path, mime_type FROM assets WHERE id = ?1",
        [&id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ) {
        Ok(r) => r,
        Err(_) => return (StatusCode::NOT_FOUND, "Asset not found").into_response(),
    };

    let full_path = manager.asset_path.join(&file_filename);
    let key = manager.asset_key;

    // We must drop the lock before reading/decrypting to avoid blocking other ops?
    // Actually, reading from DB is fast. Decrypting might take time.
    // But `manager` is borrowed from `vault_guard`.
    // We need to clone `file_path` and `key` to release lock?
    // `key` is [u8; 32] (Copy). `file_filename` is String (Clone).
    // `manager.asset_path` is PathBuf (Clone).

    let asset_path = full_path.clone();
    let asset_key = key;

    // Drop lock to allow other threads
    drop(vault_guard);

    if !asset_path.exists() {
        return (StatusCode::NOT_FOUND, "File not found on disk").into_response();
    }

    let encrypted_data = match std::fs::read(&asset_path) {
        Ok(d) => d,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file").into_response()
        }
    };

    let decrypted_data: Vec<u8> = match security::decrypt_data(&encrypted_data, &asset_key) {
        Ok(d) => d,
        Err(_) => return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to decrypt").into_response(),
    };

    // Range Support
    let total_len = decrypted_data.len() as u64;

    // Simple Range parser
    if let Some(range_header) = headers.get(header::RANGE) {
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

                    let mut headers = HeaderMap::new();
                    headers.insert(header::CONTENT_TYPE, mime_type.parse().unwrap());
                    headers.insert(
                        header::CONTENT_RANGE,
                        format!("bytes {}-{}/{}", start, end, total_len)
                            .parse()
                            .unwrap(),
                    );
                    headers.insert(header::CONTENT_LENGTH, chunk.len().into());
                    headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());

                    return (StatusCode::PARTIAL_CONTENT, headers, chunk).into_response();
                } else {
                    let mut headers = HeaderMap::new();
                    headers.insert(
                        header::CONTENT_RANGE,
                        format!("bytes */{}", total_len).parse().unwrap(),
                    );
                    return (StatusCode::RANGE_NOT_SATISFIABLE, headers).into_response();
                }
            }
        }
    }

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, mime_type.parse().unwrap());
    headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());

    (StatusCode::OK, headers, decrypted_data).into_response()
}
