use crate::database::{VaultError, VaultManager};
use crate::models::{Asset, Shard};
use crate::security;
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{command, State};
use uuid::Uuid;

#[command]
pub async fn unlock_vault(
    app_state: State<'_, AppState>,
    path: String,
    password: String,
) -> Result<bool, String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;

    match VaultManager::new(&path, &password) {
        Ok(manager) => {
            *vault_guard = Some(manager);
            Ok(true)
        }
        Err(e) => Err(e.to_string()),
    }
}

#[command]
pub async fn init_vault(
    app_state: State<'_, AppState>,
    path: String,
    password: String,
) -> Result<bool, String> {
    unlock_vault(app_state, path, password).await
}

#[command]
pub async fn close_vault(app_state: State<'_, AppState>) -> Result<(), String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    *vault_guard = None;
    Ok(())
}

#[command]
pub async fn check_vault_status(path: String) -> Result<String, String> {
    let path = Path::new(&path);
    if !path.exists() || !path.is_dir() {
        return Err("Invalid path".to_string());
    }

    let db_path = path.join("shards.db");
    if db_path.exists() {
        Ok("existing".to_string())
    } else {
        Ok("new".to_string())
    }
}

#[command]
pub async fn create_shard(
    app_state: State<'_, AppState>,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<Shard, String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    let id = Uuid::new_v4().to_string();
    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().to_rfc3339();

    manager.conn.execute(
        "INSERT INTO shards (id, title, content, tags, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        (&id, &title, &content, &tags_json, &now),
    ).map_err(|e| e.to_string())?;

    // Link assets found in content
    link_assets_to_shard(manager, &id, &content).map_err(|e| e.to_string())?;

    Ok(Shard {
        id,
        title,
        content,
        tags,
        created_at: now.clone(),
        updated_at: now,
    })
}

#[command]
pub async fn get_shards(app_state: State<'_, AppState>) -> Result<Vec<Shard>, String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    let mut stmt = manager.conn.prepare("SELECT id, title, content, tags, created_at, updated_at FROM shards ORDER BY updated_at DESC").map_err(|e| e.to_string())?;

    let shard_iter = stmt
        .query_map([], |row| {
            let tags_str: String = row.get(3)?;
            let tags: Vec<String> = serde_json::from_str(&tags_str).unwrap_or_default();

            Ok(Shard {
                id: row.get(0)?,
                title: row.get(1)?,
                content: row.get(2)?,
                tags,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut shards = Vec::new();
    for shard in shard_iter {
        shards.push(shard.map_err(|e| e.to_string())?);
    }

    Ok(shards)
}

#[command]
pub async fn import_asset(
    app_state: State<'_, AppState>,
    file_path: String,
) -> Result<Asset, String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    let source_path = Path::new(&file_path);
    if !source_path.exists() {
        return Err("File not found".to_string());
    }

    let file_stem = source_path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let extension = source_path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    // Simple mime type guessing based on extension
    let mime_type = match extension.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" => "audio/ogg",
        "pdf" => "application/pdf",
        "vtt" => "text/vtt",
        "srt" => "application/x-subrip",
        _ => "application/octet-stream",
    }
    .to_string();

    let id = Uuid::new_v4().to_string();
    // Keeping extension for convenience, but content is encrypted
    let dest_filename = format!("{}.{}", id, extension);
    let dest_path = manager.asset_path.join(&dest_filename);

    // Read and Encrypt
    let raw_data = fs::read(source_path).map_err(|e| e.to_string())?;
    let encrypted_data = security::encrypt_data(&raw_data, &manager.asset_key)
        .map_err(|e: security::SecurityError| e.to_string())?;
    fs::write(&dest_path, encrypted_data).map_err(|e| e.to_string())?;

    let now = chrono::Local::now().to_rfc3339();

    // Insert into DB
    // Note: shard_id is NULL initially, will be linked when Shard is saved.
    // Or we can pass shard_id if we have it? For drag & drop, we might not have saved the shard yet.
    // Let's allow NULL.

    manager.conn.execute(
        "INSERT INTO assets (id, shard_id, file_path, original_name, mime_type, created_at) VALUES (?1, NULL, ?2, ?3, ?4, ?5)",
        (&id, &dest_filename, &file_stem, &mime_type, &now),
    ).map_err(|e| e.to_string())?;

    Ok(Asset {
        id,
        shard_id: None,
        file_path: dest_filename,
        original_name: file_stem,
        mime_type,
        created_at: now,
    })
}

#[command]
pub async fn update_shard(
    app_state: State<'_, AppState>,
    id: String,
    title: String,
    content: String,
    tags: Vec<String>,
) -> Result<Shard, String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    let tags_json = serde_json::to_string(&tags).map_err(|e| e.to_string())?;
    let now = chrono::Local::now().to_rfc3339();

    manager
        .conn
        .execute(
            "UPDATE shards SET title = ?1, content = ?2, tags = ?3, updated_at = ?4 WHERE id = ?5",
            (&title, &content, &tags_json, &now, &id),
        )
        .map_err(|e| e.to_string())?;

    // Also fetch created_at to return complete Shard object
    let created_at: String = manager
        .conn
        .query_row(
            "SELECT created_at FROM shards WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    // Link assets found in content
    link_assets_to_shard(manager, &id, &content).map_err(|e| e.to_string())?;

    Ok(Shard {
        id,
        title,
        content,
        tags,
        created_at,
        updated_at: now,
    })
}

fn link_assets_to_shard(
    manager: &mut VaultManager,
    shard_id: &str,
    content: &str,
) -> Result<(), rusqlite::Error> {
    // Simple parser for asset://<uuid>
    // UUID v4 is 36 characters long
    let key = "asset://";
    let mut start_idx = 0;

    let mut asset_ids = std::collections::HashSet::new();

    while let Some(idx) = content[start_idx..].find(key) {
        let abs_idx = start_idx + idx + key.len();
        if abs_idx + 36 <= content.len() {
            let uuid_str = &content[abs_idx..abs_idx + 36];
            // Basic validation: check if looks like uuid (optional, but safe)
            // Just assuming it's an ID for now.
            asset_ids.insert(uuid_str.to_string());
        }
        start_idx = abs_idx;
    }

    for asset_id in asset_ids {
        // We only link if it's currently NULL? Or force ownership?
        // Force ownership.
        manager.conn.execute(
            "UPDATE assets SET shard_id = ?1 WHERE id = ?2",
            [shard_id, &asset_id],
        )?;
    }
    Ok(())
}

#[command]
pub async fn delete_asset(app_state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    // 1. Get file path
    let file_path: String = manager
        .conn
        .query_row("SELECT file_path FROM assets WHERE id = ?1", [&id], |row| {
            row.get(0)
        })
        .map_err(|_| "Asset not found".to_string())?;

    // 2. Delete from disk
    let full_path = manager.asset_path.join(&file_path);
    if full_path.exists() {
        let _ = fs::remove_file(full_path);
    }

    // 3. Delete from DB
    manager
        .conn
        .execute("DELETE FROM assets WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    // 4. Invalidate cache
    drop(vault_guard);
    if let Ok(mut cache) = app_state.asset_cache.lock() {
        cache.remove(&id);
    }

    Ok(())
}

#[command]
pub async fn delete_shard(app_state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut vault_guard = app_state.vault.lock().map_err(|e| e.to_string())?;
    let manager = vault_guard.as_mut().ok_or("Vault not locked")?;

    // 1. Find all assets linked to this shard
    let mut stmt = manager
        .conn
        .prepare("SELECT id, file_path FROM assets WHERE shard_id = ?1")
        .map_err(|e| e.to_string())?;
    let asset_iter = stmt
        .query_map([&id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    // 2. Delete asset files from disk
    for asset_result in asset_iter {
        if let Ok((_asset_id, file_path)) = asset_result {
            let full_path = manager.asset_path.join(&file_path);
            if full_path.exists() {
                let _ = fs::remove_file(full_path); // Ignore error if file missing
            }
        }
    }

    // 3. Delete assets from DB
    manager
        .conn
        .execute("DELETE FROM assets WHERE shard_id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    // 4. Delete shard from DB
    manager
        .conn
        .execute("DELETE FROM shards WHERE id = ?1", [&id])
        .map_err(|e: rusqlite::Error| e.to_string())?;

    Ok(())
}

#[command]
pub async fn get_server_port(app_state: State<'_, AppState>) -> Result<u16, String> {
    let port = *app_state.server_port.lock().map_err(|e| e.to_string())?;
    Ok(port)
}
