import { Store } from '@tauri-apps/plugin-store';

const STORE_PATH = 'config.json';
let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
    if (!storeInstance) {
        storeInstance = await Store.load(STORE_PATH);
    }
    return storeInstance;
}

export const CONFIG_KEYS = {
    LAST_OPENED_VAULT: 'last_opened_vault',
};

export async function initConfig() {
    await getStore();
}

export async function getConfig<T>(key: string): Promise<T | null> {
    const store = await getStore();
    const value = await store.get<T>(key);
    return value === undefined ? null : value;
}

export async function setConfig(key: string, value: any) {
    const store = await getStore();
    await store.set(key, value);
    await store.save();
}

export async function getLastOpenedVault(): Promise<string | null> {
    return await getConfig<string>(CONFIG_KEYS.LAST_OPENED_VAULT);
}

export async function setLastOpenedVault(path: string) {
    await setConfig(CONFIG_KEYS.LAST_OPENED_VAULT, path);
}
