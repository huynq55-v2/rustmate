import { Store } from '@tauri-apps/plugin-store';

const STORE_PATH = 'config.json';
const store = new Store(STORE_PATH);

export const CONFIG_KEYS = {
    LAST_OPENED_VAULT: 'last_opened_vault',
};

export async function initConfig() {
    await store.load();
}

export async function getConfig<T>(key: string): Promise<T | null> {
    return await store.get<T>(key);
}

export async function setConfig(key: string, value: any) {
    await store.set(key, value);
    await store.save();
}

export async function getLastOpenedVault(): Promise<string | null> {
    return await getConfig<string>(CONFIG_KEYS.LAST_OPENED_VAULT);
}

export async function setLastOpenedVault(path: string) {
    await setConfig(CONFIG_KEYS.LAST_OPENED_VAULT, path);
}
