import { open } from '@tauri-apps/plugin-dialog';
import { setLastOpenedVault } from '../utils/config';

interface WelcomeScreenProps {
    onVaultOpened: (path: string) => void;
}

export default function WelcomeScreen({ onVaultOpened }: WelcomeScreenProps) {
    const handleOpenVault = async () => {
        const selected = await open({
            directory: true,
            multiple: false,
            title: 'Select Vault Directory',
        });

        if (selected && typeof selected === 'string') {
            await setLastOpenedVault(selected);
            onVaultOpened(selected);
        }
    };

    return (
        <div className="container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
            <h1>Rustmate AI</h1>
            <p>Select a Vault to begin.</p>

            <div style={{ marginTop: '2rem' }}>
                <button onClick={handleOpenVault}>
                    Open Vault
                </button>
            </div>

            <div style={{ marginTop: '1rem', opacity: 0.6 }}>
                <small>Select an existing folder or create a new one.</small>
            </div>
        </div>
    );
}
