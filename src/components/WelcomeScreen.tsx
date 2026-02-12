import { useState, useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core'; // v2 API
import { setLastOpenedVault } from '../utils/config';

interface WelcomeScreenProps {
    onVaultOpened: (path: string) => void;
    initialPath?: string | null;
}

type VaultStatus = 'initial' | 'unlock' | 'create';

export default function WelcomeScreen({ onVaultOpened, initialPath }: WelcomeScreenProps) {
    const [vaultPath, setVaultPath] = useState<string | null>(initialPath || null);
    const [status, setStatus] = useState<VaultStatus>('initial');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (initialPath) {
            checkStatus(initialPath);
        }
    }, [initialPath]);

    const checkStatus = async (path: string) => {
        try {
            const vaultStatus = await invoke<string>('check_vault_status', { path });
            if (vaultStatus === 'existing') {
                setStatus('unlock');
            } else {
                setStatus('create');
            }
        } catch (err: any) {
            setError(err.toString());
        }
    };

    const handleSelectVault = async () => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: 'Select Vault Directory',
            });

            if (selected && typeof selected === 'string') {
                setVaultPath(selected);
                setError(null);
                checkStatus(selected);
            }
        } catch (err: any) {
            setError(err.toString());
        }
    };

    const handleUnlock = async () => {
        if (!vaultPath || !password) return;
        setIsLoading(true);
        setError(null);

        try {
            await invoke('unlock_vault', { path: vaultPath, password });
            await setLastOpenedVault(vaultPath);
            onVaultOpened(vaultPath);
        } catch (err: any) {
            setError("Failed to open vault: " + err.toString());
            setIsLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!vaultPath || !password) return;
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await invoke('init_vault', { path: vaultPath, password });
            await setLastOpenedVault(vaultPath);
            onVaultOpened(vaultPath);
        } catch (err: any) {
            setError("Failed to create vault: " + err.toString());
            setIsLoading(false);
        }
    };

    return (
        <div className="container" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            padding: '2rem',
            textAlign: 'center'
        }}>
            <h1 style={{ marginBottom: '0.5rem' }}>Rustmate AI</h1>
            <p style={{ opacity: 0.7, marginBottom: '2rem' }}>Secure Context Shard Manager</p>

            {status === 'initial' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                    <button
                        onClick={handleSelectVault}
                        style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', cursor: 'pointer' }}
                    >
                        Open / Create Vault
                    </button>
                    <small style={{ opacity: 0.5 }}>Select a folder to begin</small>
                </div>
            )}

            {status === 'unlock' && (
                <div style={{ width: '100%', maxWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3>Unlock Vault</h3>
                    <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', opacity: 0.6, fontSize: '0.8rem' }}>
                        {vaultPath}
                    </div>

                    <input
                        type="password"
                        placeholder="Enter Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ padding: '0.5rem' }}
                        disabled={isLoading}
                    />

                    <button
                        onClick={handleUnlock}
                        disabled={isLoading || !password}
                        style={{ padding: '0.5rem', cursor: isLoading ? 'wait' : 'pointer' }}
                    >
                        {isLoading ? 'Unlocking...' : 'Unlock'}
                    </button>

                    <button
                        onClick={() => { setStatus('initial'); setPassword(''); setError(null); }}
                        style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                        Cancel
                    </button>
                </div>
            )}

            {status === 'create' && (
                <div style={{ width: '100%', maxWidth: '300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <h3>Create New Vault</h3>
                    <div style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', opacity: 0.6, fontSize: '0.8rem' }}>
                        {vaultPath}
                    </div>

                    <input
                        type="password"
                        placeholder="Set Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        style={{ padding: '0.5rem' }}
                        disabled={isLoading}
                    />

                    <input
                        type="password"
                        placeholder="Confirm Password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        style={{ padding: '0.5rem' }}
                        disabled={isLoading}
                    />

                    <button
                        onClick={handleCreate}
                        disabled={isLoading || !password || !confirmPassword}
                        style={{ padding: '0.5rem', cursor: isLoading ? 'wait' : 'pointer' }}
                    >
                        {isLoading ? 'Creating...' : 'Initialize Vault'}
                    </button>

                    <button
                        onClick={() => { setStatus('initial'); setPassword(''); setConfirmPassword(''); setError(null); }}
                        style={{ background: 'transparent', border: 'none', color: '#666', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                        Cancel
                    </button>
                </div>
            )}

            {error && (
                <div style={{ marginTop: '1rem', color: 'red', fontSize: '0.9rem', maxWidth: '300px' }}>
                    {error}
                </div>
            )}
        </div>
    );
}
