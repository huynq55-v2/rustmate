import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open } from '@tauri-apps/plugin-dialog';

interface Shard {
    id: string;
    title: string;
    content: string;
    tags: string[];
    created_at: string;
    updated_at: string;
}

interface Asset {
    id: string;
    mime_type: string;
    original_name: string;
}

interface SmartLibraryLayoutProps {
    vaultPath: string;
    onCloseVault: () => void;
}

type ViewMode = 'editor' | 'viewer' | 'inspector';

export default function SmartLibraryLayout({ vaultPath, onCloseVault }: SmartLibraryLayoutProps) {
    const [shards, setShards] = useState<Shard[]>([]);
    const [selectedShardId, setSelectedShardId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<ViewMode>('viewer');
    const [searchQuery, setSearchQuery] = useState('');

    // Editor State
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    // Tag State
    const [newTag, setNewTag] = useState('');

    // Server Port
    const [serverPort, setServerPort] = useState<number | null>(null);

    useEffect(() => {
        loadShards();
        invoke<number>('get_server_port').then(setServerPort).catch(console.error);
    }, []);

    // Sync editor state when selection changes
    useEffect(() => {
        if (selectedShardId) {
            const shard = shards.find(s => s.id === selectedShardId);
            if (shard) {
                setEditTitle(shard.title);
                setEditContent(shard.content);
                setIsDirty(false);
                setNewTag('');
            }
        } else {
            setEditTitle('');
            setEditContent('');
        }
    }, [selectedShardId, shards]);

    const loadShards = async () => {
        try {
            const result = await invoke<Shard[]>('get_shards');
            setShards(result);
        } catch (error) {
            console.error("Failed to load shards:", error);
            alert("Failed to load shards: " + JSON.stringify(error));
        }
    };

    const handleCreateShard = async () => {
        const title = `Untitled ${shards.length + 1}`;
        try {
            const newShard = await invoke<Shard>('create_shard', {
                title,
                content: '',
                tags: []
            });
            setShards([newShard, ...shards]);
            setSelectedShardId(newShard.id);
            setViewMode('editor');
        } catch (e) {
            console.error(e);
            alert("Failed to create shard: " + JSON.stringify(e));
        }
    };

    const handleSave = async () => {
        if (!selectedShardId) return;
        const shard = shards.find(s => s.id === selectedShardId);
        if (!shard) return;

        try {
            const updatedShard = await invoke<Shard>('update_shard', {
                id: selectedShardId,
                title: editTitle,
                content: editContent,
                tags: shard.tags
            });

            setShards(shards.map(s => s.id === selectedShardId ? updatedShard : s));
            setIsDirty(false);
        } catch (e) {
            console.error("Failed to save:", e);
        }
    };

    const handleDelete = async () => {
        if (!selectedShardId) return;

        const yes = await ask("Are you sure you want to delete this shard?", {
            title: 'Delete Shard',
            kind: 'warning'
        });

        if (!yes) return;

        try {
            await invoke('delete_shard', { id: selectedShardId });
            setShards(shards.filter(s => s.id !== selectedShardId));
            setSelectedShardId(null);
        } catch (e) {
            console.error("Failed to delete:", e);
            await message(e instanceof Error ? e.message : String(e), { title: 'Error', kind: 'error' });
        }
    };

    const handleAddTag = async () => {
        const tag = newTag.trim();
        if (!tag || !selectedShardId) return;

        const shard = shards.find(s => s.id === selectedShardId);
        if (!shard) return;

        if (shard.tags.includes(tag)) {
            setNewTag('');
            return;
        }

        const updatedTags = [...shard.tags, tag];

        try {
            const updatedShard = await invoke<Shard>('update_shard', {
                id: selectedShardId,
                title: editTitle,
                content: editContent,
                tags: updatedTags
            });

            setShards(shards.map(s => s.id === selectedShardId ? updatedShard : s));
            setNewTag('');
            setIsDirty(false);
        } catch (e) {
            console.error("Failed to add tag", e);
            await message("Failed to add tag", { kind: 'error' });
        }
    };

    const handleRemoveTag = async (tagToRemove: string) => {
        if (!selectedShardId) return;
        const shard = shards.find(s => s.id === selectedShardId);
        if (!shard) return;

        const updatedTags = shard.tags.filter(t => t !== tagToRemove);
        try {
            const updatedShard = await invoke<Shard>('update_shard', {
                id: selectedShardId,
                title: editTitle,
                content: editContent,
                tags: updatedTags
            });

            setShards(shards.map(s => s.id === selectedShardId ? updatedShard : s));
            setIsDirty(false);
        } catch (e) {
            console.error("Failed to remove tag", e);
            await message("Failed to remove tag", { kind: 'error' });
        }
    };

    const handleImportMedia = async () => {
        try {
            const file = await open({
                multiple: false,
                filters: [{
                    name: 'Media',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'webm', 'mp3', 'wav', 'pdf']
                }]
            });

            if (file) {
                const filePath = file as string;
                const asset = await invoke<Asset>('import_asset', { filePath });

                let insertText = '';
                if (asset.mime_type.startsWith('image')) {
                    insertText = `\n![${asset.original_name}](asset://${asset.id})\n`;
                } else if (asset.mime_type.startsWith('video')) {
                    const addSrt = await ask("Do you want to add a subtitle/caption file for this video?", { title: 'Add Subtitles?', kind: 'info' });
                    let trackHtml = '';
                    if (addSrt) {
                        const subFile = await open({
                            multiple: false,
                            filters: [{ name: 'Subtitles', extensions: ['vtt', 'srt'] }]
                        });
                        if (subFile) {
                            const subPath = subFile as string;
                            const subAsset = await invoke<Asset>('import_asset', { filePath: subPath });
                            trackHtml = `  <track label="Subtitles" kind="subtitles" srclang="en" src="asset://${subAsset.id}" default />`;
                        }
                    }
                    insertText = `\n<video controls src="asset://${asset.id}" style="width: 80%; display: block; margin: 20px auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">\n${trackHtml}\n</video>\n`;
                } else if (asset.mime_type === 'application/pdf') {
                    insertText = `\n<embed src="asset://${asset.id}" type="application/pdf" style="width: 100%; height: 600px; display: block; margin: 20px auto; border-radius: 8px;" />\n`;
                } else {
                    insertText = `\n[${asset.original_name}](asset://${asset.id})\n`;
                }

                setEditContent(prev => prev + insertText);
                setIsDirty(true);
            }
        } catch (e) {
            console.error("Failed to import media", e);
            await message("Failed to import media: " + String(e), { kind: 'error' });
        }
    };

    const filteredShards = shards.filter(shard =>
        shard.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shard.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        shard.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: '#f4f4f5' }}>
            <div style={{ width: '250px', minWidth: '250px', borderRight: '1px solid #e4e4e7', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid #e4e4e7' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>Library</h3>
                        <button onClick={handleCreateShard} style={{ cursor: 'pointer', padding: '0.2rem 0.5rem' }}>+</button>
                    </div>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '0.4rem', border: '1px solid #e4e4e7', borderRadius: '4px' }}
                    />
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredShards.map(shard => (
                        <div
                            key={shard.id}
                            onClick={() => { setSelectedShardId(shard.id); setViewMode('viewer'); }}
                            style={{
                                padding: '0.5rem 1rem',
                                borderBottom: '1px solid #f0f0f0',
                                cursor: 'pointer',
                                backgroundColor: selectedShardId === shard.id ? '#e4e4e7' : 'transparent',
                                fontSize: '0.9rem'
                            }}
                        >
                            <div style={{ fontWeight: 500 }}>{shard.title}</div>
                            {shard.tags.length > 0 && (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '2px' }}>
                                    {shard.tags.slice(0, 3).map(tag => (
                                        <span key={tag} style={{ fontSize: '0.7rem', color: '#666', background: '#eee', padding: '0 4px', borderRadius: '4px' }}>#{tag}</span>
                                    ))}
                                </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: '#71717a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {shard.content || "Empty content"}
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '0.5rem', borderTop: '1px solid #e4e4e7', fontSize: '0.75rem', color: '#a1a1aa' }}>
                    {filteredShards.length} shards
                </div>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
                <header style={{ height: '50px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', padding: '0 1rem', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button disabled={viewMode === 'editor'} onClick={() => setViewMode('editor')}>Editor</button>
                        <button disabled={viewMode === 'viewer'} onClick={() => setViewMode('viewer')}>Viewer</button>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        {selectedShardId && viewMode === 'editor' && (
                            <button onClick={handleImportMedia} style={{ fontSize: '0.9rem' }}>Insert Media</button>
                        )}
                        {selectedShardId && (
                            <>
                                <button onClick={handleDelete} style={{ color: 'red' }}>Delete</button>
                                <button onClick={handleSave} disabled={!isDirty}>Save</button>
                            </>
                        )}
                        <span style={{ fontSize: '0.8rem', color: '#71717a', borderLeft: '1px solid #eee', paddingLeft: '1rem' }}>{vaultPath}</span>
                        <button onClick={onCloseVault} style={{ fontSize: '0.8rem' }}>Close</button>
                    </div>
                </header>

                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                    {selectedShardId ? (
                        viewMode === 'editor' ? (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '2rem' }}>
                                <input
                                    type="text"
                                    value={editTitle}
                                    onChange={(e) => { setEditTitle(e.target.value); setIsDirty(true); }}
                                    style={{ fontSize: '1.5rem', fontWeight: 'bold', border: 'none', outline: 'none', marginBottom: '1rem', width: '100%' }}
                                    placeholder="Shard Title"
                                />
                                <textarea
                                    value={editContent}
                                    onChange={(e) => { setEditContent(e.target.value); setIsDirty(true); }}
                                    style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: '1rem', fontFamily: 'monospace' }}
                                    placeholder="Write something..."
                                />
                            </div>
                        ) : (
                            <div style={{ padding: '2rem' }}>
                                {/* Viewer Mode - Basic Markdown (raw for now, but imgs work via asset protocol) */}
                                <h1>{editTitle}</h1>
                                {/* 
                                    Rendering Strategy:
                                    1. Global: Replace 'asset://id' -> 'http://localhost:port/asset/id'
                                    2. Markdown Images: '![alt](url)' -> '<img ...>'
                                    3. Markdown Links: '[text](url)' -> '<a ...>' 
                                    4. HTML: <video>, <embed> are already HTML, so just the URL replacement above makes them work!
                                */}
                                <div dangerouslySetInnerHTML={{
                                    __html: editContent
                                        .replace(/\n/g, '<br/>')
                                        // 1. Global Asset URL Replacement
                                        .replace(/asset:\/\/([a-zA-Z0-9-]+)/g, (match, id) => `http://localhost:${serverPort}/asset/${id}`)
                                        // 2. Markdown Images (now using http url)
                                        .replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => `<img src="${src}" alt="${alt}" style="width: 80%; display: block; margin: 20px auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);"/>`)
                                        // 3. Markdown Links (simple) - Negative lookbehind for '!' to avoid treating images as links? 
                                        // Easier: Match images first (already done), they are now <img> tags.
                                        // But wait, the `replace` returns a string.
                                        // So `![foo](url)` became `<img...>`. 
                                        // Now `[foo](url)` regex won't match `<img...>` hopefully.
                                        .replace(/\[(.*?)\]\((.*?)\)/g, (match, text, href) => `<a href="${href}" target="_blank">${text}</a>`)
                                }} />
                            </div>
                        )
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#a1a1aa' }}>
                            Select or create a shard to start
                        </div>
                    )}
                </div >
            </div >

            {/* Right Sidebar: Inspector */}
            {
                true && (
                    <div style={{ width: '300px', minWidth: '300px', borderLeft: '1px solid #e4e4e7', backgroundColor: '#fafafa', padding: '1rem' }}>
                        <h3>Inspector</h3>
                        {selectedShardId ? (
                            <div>
                                <p><strong>ID:</strong> <span style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}>{selectedShardId}</span></p>
                                <p><strong>Created:</strong> <br /> <small>{shards.find(s => s.id === selectedShardId)?.created_at}</small></p>
                                <p><strong>Updated:</strong> <br /> <small>{shards.find(s => s.id === selectedShardId)?.updated_at}</small></p>
                                <div style={{ marginTop: '1rem' }}>
                                    <strong>Tags:</strong>
                                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                        <input
                                            type="text"
                                            value={newTag}
                                            onChange={(e) => setNewTag(e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                                            placeholder="Add tag..."
                                            style={{ flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid #ccc' }}
                                        />
                                        <button onClick={handleAddTag} disabled={!newTag.trim()}>+</button>
                                    </div>
                                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                        {shards.find(s => s.id === selectedShardId)?.tags.map(tag => (
                                            <span key={tag} style={{ background: '#e4e4e7', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                #{tag}
                                                <span
                                                    onClick={() => handleRemoveTag(tag)}
                                                    style={{ cursor: 'pointer', fontWeight: 'bold', color: '#666' }}
                                                >&times;</span>
                                            </span>
                                        ))}
                                        {shards.find(s => s.id === selectedShardId)?.tags.length === 0 && <small style={{ color: '#999' }}>No tags</small>}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p style={{ color: '#a1a1aa' }}>No shard selected</p>
                        )}
                    </div>
                )
            }
        </div >
    );
}
