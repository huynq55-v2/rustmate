use crate::database::VaultManager;
use std::sync::Mutex;

pub struct AppState {
    pub vault: Mutex<Option<VaultManager>>,
}

impl Default for AppState {
    fn default() -> Self {
        AppState {
            vault: Mutex::new(None),
        }
    }
}
