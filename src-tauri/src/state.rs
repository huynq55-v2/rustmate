use crate::database::VaultManager;
use std::sync::{Arc, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub vault: Arc<Mutex<Option<VaultManager>>>,
    pub server_port: Arc<Mutex<u16>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            vault: Arc::new(Mutex::new(None)),
            server_port: Arc::new(Mutex::new(0)),
        }
    }
}
