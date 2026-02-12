import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Shard {
    id: string;
    title: string;
    content: string;
    tags: string[];
    created_at: string;
    updated_at: string;
}

interface SmartLibraryLayoutProps {
    vaultPath: string;
    onCloseVault: () => void;
}

type ViewMode = 'editor' | 'viewer' | 'inspector';

export default function SmartLibraryLayout({ vaultPath, onCloseVault }: SmartLibraryLayoutProps) {
    const [shards, setShards] = useState<Shard[]>([]);
    const [selectedShardId, setSelectedShardId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('editor');

    useEffect(() => {
        loadShards();
    }, []);

    const loadShards = async () => {
        try {
            const result = await invoke<Shard[]>('get_shards');
            setShards(result);
        } catch (error) {
            console.error("Failed to load shards:", error);
        }
    };

    const handleCreateShard = async () => {
        // TODO: Implement create shard dialog/logic
        console.log("Create shard clicked");
        const title = `Untitled ${shards.length + 1}`;
        try {
            const newShard = await invoke<Shard>('create_shard', {
                title,
                content: '',
                tags: []
            });
            setShards([newShard, ...shards]);
            setSelectedShardId(newShard.id);
        } catch (e) {
            console.error(e);
        }
    };

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: '#f4f4f5' }}>
            {/* Left Sidebar: Shard Library */}
            <div style={{ width: '250px', minWidth: '250px', borderRight: '1px solid #e4e4e7', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid #e4e4e7', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>Library</h3>
                    <button onClick={handleCreateShard} style={{ cursor: 'pointer', padding: '0.2rem 0.5rem' }}>+</button>
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {shards.map(shard => (
                        <div
                            key={shard.id}
                            onClick={() => setSelectedShardId(shard.id)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderBottom: '1px solid #f0f0f0',
                                cursor: 'pointer',
                                backgroundColor: selectedShardId === shard.id ? '#e4e4e7' : 'transparent',
                                fontSize: '0.9rem'
                            }}
                        >
                            <div style={{ fontWeight: 500 }}>{shard.title}</div>
                            <div style={{ fontSize: '0.75rem', color: '#71717a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {shard.content || "Empty content"}
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '0.5rem', borderTop: '1px solid #e4e4e7', fontSize: '0.75rem', color: '#a1a1aa' }}>
                    {shards.length} shards
                </div>
            </div>

            {/* Center: Main Editor/Viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
                <header style={{ height: '50px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', padding: '0 1rem', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button disabled={viewMode === 'editor'} onClick={() => setViewMode('editor')}>Editor</button>
                        <button disabled={viewMode === 'viewer'} onClick={() => setViewMode('viewer')}>Viewer</button>
                    </div>
                    <div>
                        <span style={{ fontSize: '0.8rem', color: '#71717a', marginRight: '1rem' }}>{vaultPath}</span>
                        <button onClick={onCloseVault} style={{ fontSize: '0.8rem' }}>Close Vault</button>
                    </div>
                </header>

                <div style={{ flex: 1, padding: '2rem', overflowY: 'auto' }}>
                    {selectedShardId ? (
                        <div>
                            <h1>{shards.find(s => s.id === selectedShardId)?.title}</h1>
                            <p>{shards.find(s => s.id === selectedShardId)?.content}</p>
                            {/* Editor implementation will go here */}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#a1a1aa' }}>
                            Select or create a shard back to start
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar: Inspector */}
            {viewMode === 'inspector' || true && ( // Always show inspector for now, or toggle? User asked for 3-col layout.
                <div style={{ width: '300px', minWidth: '300px', borderLeft: '1px solid #e4e4e7', backgroundColor: '#fafafa', padding: '1rem' }}>
                    <h3>Inspector</h3>
                    {selectedShardId ? (
                        <div>
                            <p><strong>ID:</strong> {selectedShardId}</p>
                            <p><strong>Created:</strong> {shards.find(s => s.id === selectedShardId)?.created_at}</p>
                        </div>
                    ) : (
                        <p style={{ color: '#a1a1aa' }}>No shard selected</p>
                    )}
                </div>
            )}
        </div>
    );
}
