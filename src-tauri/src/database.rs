use crate::security;
use rusqlite::{Connection, Result};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum VaultError {
    #[error("Database error: {0}")]
    DbError(#[from] rusqlite::Error),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
    #[error("Security error: {0}")]
    SecurityError(#[from] security::SecurityError),
    #[error("Invalid password")]
    InvalidPassword,
    #[error("Vault already exists")]
    VaultAlreadyExists,
}

pub struct VaultManager {
    pub db_path: PathBuf,
    pub asset_path: PathBuf,
    pub asset_key: [u8; security::KEY_LEN],
    pub conn: Connection,
    // Connection is not typically kept alive in struct if we want thread safety or short-lived connections,
    // but for a single-user desktop app, keeping it open or re-opening is valid.
    // For this MVP, let's just generate the config to open connections.
}

impl VaultManager {
    pub fn new(vault_path: &str, password: &str) -> Result<Self, VaultError> {
        let vault_path = Path::new(vault_path);
        let db_path = vault_path.join("shards.db");
        let salt_path = vault_path.join(".salt");
        let assets_path = vault_path.join("assets");

        if !db_path.exists() {
            // Initialize new vault
            fs::create_dir_all(&assets_path)?;

            // 1. Generate and save salt
            let salt = security::generate_salt();
            fs::write(&salt_path, &salt)?;

            // 2. Derive Asset Key
            let asset_key = security::derive_key(password, &salt);

            // 3. Init DB
            let conn = Connection::open(&db_path)?;

            // Set Key for SQLCipher FIRST
            conn.pragma_update(None, "key", &password)?;

            // Optimize for local performance
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;

            // Create Tables
            conn.execute(
                "CREATE TABLE IF NOT EXISTS shards (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    tags TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )",
                [],
            )?;

            conn.execute(
                "CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY,
                    shard_id TEXT,
                    file_path TEXT,
                    original_name TEXT,
                    mime_type TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )",
                [],
            )?;

            // Verify encryption by writing something
            // Check if key is correct? SQLCipher doesn't validate key until you read/write.
            // Creating tables implicitly writes.

            return Ok(VaultManager {
                db_path,
                asset_path: assets_path,
                asset_key,
                conn,
            });
        } else {
            // Open existing vault
            if !salt_path.exists() {
                // This might be an old vault or corrupted.
                // For MVP, assume it requires salt.
                return Err(VaultError::IoError(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "Salt file missing",
                )));
            }

            let salt_bytes = fs::read(&salt_path)?;
            let asset_key = security::derive_key(password, &salt_bytes);

            let conn = Connection::open(&db_path)?;

            conn.pragma_update(None, "key", &password)?;

            // Optimize for local performance
            conn.pragma_update(None, "journal_mode", "WAL")?;
            conn.pragma_update(None, "synchronous", "NORMAL")?;
            conn.pragma_update(None, "foreign_keys", "ON")?;

            // Verify password by attempting to read
            // Also check cipher version to ensure we are running SQLCipher
            let version: String = conn
                .query_row("PRAGMA cipher_version", [], |row| row.get(0))
                .unwrap_or_default();
            println!("SQLCipher Version: {}", version);

            match conn.query_row("SELECT count(*) FROM shards", [], |_| Ok(())) {
                Ok(_) => Ok(VaultManager {
                    db_path,
                    asset_path: assets_path,
                    asset_key,
                    conn,
                }),
                Err(e) => {
                    println!("Vault Verification Failed: {:?}", e);
                    Err(VaultError::InvalidPassword)
                }
            }
        }
    }

    pub fn get_connection(&self, password: &str) -> Result<Connection, VaultError> {
        let conn = Connection::open(&self.db_path)?;
        conn.pragma_update(None, "key", &password)?;
        Ok(conn)
    }
}
