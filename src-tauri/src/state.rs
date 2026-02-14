use crate::database::VaultManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub vault: Arc<Mutex<Option<VaultManager>>>,
    pub server_port: Arc<Mutex<u16>>,
    /// Cache of decrypted asset data: asset_id -> decrypted bytes.
    /// Avoids re-reading + re-decrypting entire files on every Range Request (video seeking).
    pub asset_cache: Arc<Mutex<HashMap<String, Vec<u8>>>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            vault: Arc::new(Mutex::new(None)),
            server_port: Arc::new(Mutex::new(0)),
            asset_cache: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
