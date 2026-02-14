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
    // 1. Try to serve from cache first (fast path for video seeking)
    let cached = {
        let cache = state.asset_cache.lock().unwrap();
        cache.get(&id).cloned()
    };

    // 2. Get mime_type from DB (always needed for headers)
    let mime_type = {
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
        match manager
            .conn
            .query_row("SELECT mime_type FROM assets WHERE id = ?1", [&id], |row| {
                row.get::<_, String>(0)
            }) {
            Ok(mt) => mt,
            Err(_) => return (StatusCode::NOT_FOUND, "Asset not found").into_response(),
        }
    };

    // 3. Get decrypted data: from cache or decrypt fresh
    let decrypted_data = if let Some(data) = cached {
        data
    } else {
        // Need to decrypt: get file path and key
        let (asset_path, asset_key) = {
            let vault_guard = match state.vault.lock() {
                Ok(guard) => guard,
                Err(_) => {
                    return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to lock vault")
                        .into_response()
                }
            };
            let manager = match vault_guard.as_ref() {
                Some(m) => m,
                None => return (StatusCode::FORBIDDEN, "Vault locked").into_response(),
            };
            let file_filename: String = match manager.conn.query_row(
                "SELECT file_path FROM assets WHERE id = ?1",
                [&id],
                |row| row.get(0),
            ) {
                Ok(f) => f,
                Err(_) => return (StatusCode::NOT_FOUND, "Asset not found").into_response(),
            };
            let full_path = manager.asset_path.join(&file_filename);
            let key = manager.asset_key;
            (full_path, key)
        }; // vault_guard dropped here

        if !asset_path.exists() {
            return (StatusCode::NOT_FOUND, "File not found on disk").into_response();
        }

        let encrypted_data = match std::fs::read(&asset_path) {
            Ok(d) => d,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file").into_response()
            }
        };

        let data: Vec<u8> = match security::decrypt_data(&encrypted_data, &asset_key) {
            Ok(d) => d,
            Err(_) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to decrypt").into_response()
            }
        };

        // Store in cache for future Range Requests (video seeking)
        {
            let mut cache = state.asset_cache.lock().unwrap();
            // Simple eviction: limit to ~50 items to prevent unbounded memory growth
            if cache.len() >= 50 {
                // Remove oldest entry (arbitrary key)
                if let Some(old_key) = cache.keys().next().cloned() {
                    cache.remove(&old_key);
                }
            }
            cache.insert(id.clone(), data.clone());
        }

        data
    };

    // 4. Range Support
    let total_len = decrypted_data.len() as u64;

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

    // 5. Full response (no Range header)
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, mime_type.parse().unwrap());
    headers.insert(header::ACCEPT_RANGES, "bytes".parse().unwrap());

    (StatusCode::OK, headers, decrypted_data).into_response()
}
