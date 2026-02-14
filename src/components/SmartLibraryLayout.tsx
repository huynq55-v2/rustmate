import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open } from '@tauri-apps/plugin-dialog';
import hljs from 'highlight.js';
// Remove static css so we can switch themes in iframe
import { marked, Renderer } from 'marked';

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

    // Theme State
    const [theme, setTheme] = useState<'light' | 'dark'>(() => {
        return (localStorage.getItem('theme') as 'light' | 'dark') || 'light';
    });

    // Apply Theme
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }, [theme]);

    const toggleTheme = () => {
        setTheme(prev => prev === 'light' ? 'dark' : 'light');
    };

    // Editor State
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    // Tag State
    const [newTag, setNewTag] = useState('');

    // Server Port
    const [serverPort, setServerPort] = useState<number | null>(null);

    // Linking State
    const [showLinkModal, setShowLinkModal] = useState(false);

    // Handle messages from Iframe Viewer (e.g. shard links) AND Editor
    const editorIframeRef = useRef<HTMLIFrameElement>(null);
    const lastEditorContent = useRef('');

    // Iframe Style Generators
    const getIframeStyle = () => `
        body {
            font-family: system-ui, -apple-system, blinkmacsystemfont, "Segoe UI", roboto, oxygen, ubuntu, cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
            margin: 0;
            padding: ${viewMode === 'viewer' ? '2rem' : '0'};
            color: ${theme === 'dark' ? '#f4f4f5' : '#0f0f0f'};
            background-color: transparent;
            font-weight: 400;
            height: 100vh;
            display: flex;
            flex-direction: column;
            -webkit-font-smoothing: antialiased;
        }
        textarea {
            color: ${theme === 'dark' ? '#f4f4f5' : '#0f0f0f'};
            caret-color: ${theme === 'dark' ? '#60a5fa' : '#2563eb'};
        }
        a { color: ${theme === 'dark' ? '#60a5fa' : '#2563eb'}; }
        code { background: ${theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}; }
        blockquote { border-left-color: ${theme === 'dark' ? '#3f3f46' : '#e5e7eb'}; color: ${theme === 'dark' ? '#a1a1aa' : '#6b7280'}; }
        h1 { border-bottom-color: ${theme === 'dark' ? '#3f3f46' : '#eaeaea'}; }
        
        /* Fix Code Wrapping */
        pre {
            white-space: pre-wrap;
            word-break: break-word;
            overflow-wrap: break-word; /* standard */
        }
        pre code {
            white-space: pre-wrap !important;
            word-break: break-word !important;
            overflow-wrap: break-word !important;
        }
    `;

    // Handle messages from Iframe Viewer (e.g. shard links) AND Editor
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'open_shard') {
                const shardId = event.data.id;
                setSelectedShardId(shardId);
                setViewMode('viewer');
            } else if (event.data?.type === 'editor_update') {
                const newValue = event.data.value;
                if (newValue !== lastEditorContent.current) {
                    lastEditorContent.current = newValue; // Update ref first
                    setEditContent(newValue);
                    setIsDirty(true);
                }
            } else if (event.data?.type === 'editor_ready') {
                // Iframe is ready, send initial content
                // We always send content on ready, regardless of lastEditorContent, because iframe is fresh.
                // We do NOT update lastEditorContent here, or we set it?
                // Actually, if we send content, we should set lastEditorContent to match, to avoid echo?
                // No, echo protection is on `editor_update` (incoming) vs `editContent` (outgoing).
                // If we send, it's outgoing.

                // FORCE SEND
                if (editorIframeRef.current) {
                    editorIframeRef.current.contentWindow?.postMessage({ type: 'set_content', value: editContent }, '*');
                }
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [editContent]); // Add dependency on editContent so handleMessage uses fresh state? 
    // Or allow handleMessage to read state via closure?
    // If we use dependency, we re-bind listener. That's fine.

    // Sync content TO editor iframe when switching shards - keep this for hot switches if needed, 
    // but editor_ready covers mount.
    // However, if we switch Shard while ALREADY in editor, iframe might NOT reload (if React reuses it).
    // React usually re-renders iframe srcDoc -> reload.
    // If srcDoc changes, iframe reloads.
    // srcDoc depends on nothing?? No, it's memoized or static in my code?
    // In my code: `srcDoc={(() => { ... })()}`. It's re-evaluated on every render.
    // But since it returns a string, if the string is identical, React might not reload the iframe?
    // The string IS identical (no dynamic content embedded anymore).
    // So if we switch shard, `editContent` changes, parent re-renders.
    // Does iframe reload?
    // If `srcDoc` string is identical, React might keep the DOM node.
    // If so, `editor_ready` WON'T fire on shard switch!
    // So we NEED the `useEffect` on `editContent` change too.

    useEffect(() => {
        if (viewMode === 'editor' && editorIframeRef.current) {
            if (editContent !== lastEditorContent.current) {
                // Content changed from OUTSIDE (e.g. switching shard, or initial load)
                lastEditorContent.current = editContent; // Sync ref
                editorIframeRef.current.contentWindow?.postMessage({ type: 'set_content', value: editContent }, '*');

                // Retry for initial load
                setTimeout(() => {
                    editorIframeRef.current?.contentWindow?.postMessage({ type: 'set_content', value: editContent }, '*');
                }, 50);
            }
        }
    }, [editContent, viewMode]);
    // Problem: If I type in editor -> editContent updates -> this effect runs -> sends 'set_content' back to editor -> loop/cursor reset?
    // FIX: Only send if the update came from OUTSIDE?
    // How to distinguish?
    // We can check if isDirty? No.
    // We need to know if the last change was from us.
    // Ref: lastContentFromEditor.
    // If editContent === lastContentFromEditor, do NOT send.

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

            // Detect and delete removed assets
            const oldAssets = extractAssetIds(shard.content);
            const newAssets = extractAssetIds(editContent);
            const removedAssets = [...oldAssets].filter(x => !newAssets.has(x));

            if (removedAssets.length > 0) {
                console.log("Assets to delete:", removedAssets);
                for (const assetId of removedAssets) {
                    await invoke('delete_asset', { id: assetId });
                }
            }

            setShards(shards.map(s => s.id === selectedShardId ? updatedShard : s));
            setIsDirty(false);
        } catch (e) {
            console.error("Failed to save:", e);
            await message("Failed to save: " + String(e), { kind: 'error' });
        }
    };

    const extractAssetIds = (content: string): Set<string> => {
        const matches = content.matchAll(/asset:\/\/([a-zA-Z0-9-]+)/g);
        return new Set(Array.from(matches, m => m[1]));
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

    // Link Logic
    const handleLinkClick = () => {
        // Just open the modal. The Iframe should keep its selection/focus, 
        // or we rely on the user having selected something before clicking.
        setShowLinkModal(true);
    };

    // Code Block Logic
    const handleInsertCode = () => {
        const lang = window.prompt('Ngôn ngữ? (python, rust, js, ts, html, css, sql...)', 'python') || '';

        editorIframeRef.current?.contentWindow?.postMessage({
            type: 'wrap_selection',
            prefix: `\n\`\`\`${lang}\n`,
            suffix: `\n\`\`\`\n`
        }, '*');

        // Focus the iframe to ensure input loop works? 
        // The wrap_selection logic in iframe already does focus().
    };

    const handleSelectShardForLink = (targetShard: Shard) => {
        const insertUrl = `shard://${targetShard.id}`;

        // We instruct iframe to wrap current selection with link syntax, OR insert if empty.
        // Actually, markdown link is [text](url).
        // If selection is empty, we insert [Title](shard://ID).
        // If selection is "foo", we insert [foo](shard://ID).

        editorIframeRef.current?.contentWindow?.postMessage({
            type: 'wrap_selection',
            prefix: `[`,
            suffix: `](${insertUrl})`
        }, '*');

        // If the selection was empty, the result is `[](url)`, which is bad.
        // My wrap_selection logic: "before + prefix + selected + suffix + after".
        // If selected is empty -> "prefix + suffix". -> `[](url)`.
        // We want `[Title](url)`.
        // Logic fix: Check if we have selection?
        // Parent doesn't know.
        // So we should send a smarter command: `cmd_link_shard`?
        // Let's implement `cmd_link_shard` in Iframe?
        // Or just `wrap_selection` with a fallback inside Iframe?
        // Getting complicated.
        // Simplest: `wrap_selection` with `defaultText` param?
        // Iframe logic: `const selected = ... || data.defaultText`.

        // Let's assume for now user selects text OR we just insert title.
        // If I use `insert_text`, it overwrites?
        // Let's use `wrap_selection` and improve iframe script later if needed.
        // Or better: update `srcDoc` to handle `defaultText`.
        // But for now, I'll just use `wrap_selection`.
        // Wait, if I want to use `Title` if empty, I need to know if it's empty.
        // I'll send `defaultText: targetShard.title`.
        // I need to update iframe script to handle `defaultText`.
        // Let's do that in a separate edit.

        // For now:
        editorIframeRef.current?.contentWindow?.postMessage({
            type: 'wrap_selection',
            prefix: `[`,
            suffix: `](${insertUrl})`,
            defaultText: targetShard.title
        }, '*');

    };

    // Media Import Logic
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
        <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <style>
                {`
                :root {
                    --bg-primary: #fafafa;
                    --bg-secondary: #ffffff;
                    --bg-tertiary: #e4e4e7;
                    --text-primary: #0f0f0f;
                    --text-secondary: #71717a;
                    --border-color: #e4e4e7;
                    --input-bg: #ffffff;
                    --accent-color: #2563eb;
                }

                [data-theme='dark'] {
                    --bg-primary: #18181b;
                    --bg-secondary: #27272a;
                    --bg-tertiary: #3f3f46;
                    --text-primary: #f4f4f5;
                    --text-secondary: #a1a1aa;
                    --border-color: #3f3f46;
                    --input-bg: #27272a;
                    --accent-color: #60a5fa;
                }

                button {
                    background-color: var(--bg-tertiary);
                    color: var(--text-primary);
                    border: 1px solid var(--border-color);
                    padding: 0.3rem 0.6rem;
                    border-radius: 4px;
                    cursor: pointer;
                    transition: background-color 0.2s, color 0.2s, border-color 0.2s;
                }
                button:hover:not(:disabled) {
                    background-color: var(--bg-tertiary);
                    filter: brightness(1.1);
                }
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                `}
            </style>
            {/* Left Sidebar: Shard Library */}
            <div style={{ width: '250px', minWidth: '250px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)' }}>
                <div style={{ padding: '1rem', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem' }}>Library</h3>
                        <div style={{ display: 'flex', gap: '5px' }}>
                            <button onClick={toggleTheme} style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                {theme === 'light' ? '🌙' : '☀️'}
                            </button>
                            <button onClick={handleCreateShard} style={{ cursor: 'pointer', padding: '0.2rem 0.5rem', background: 'var(--accent-color)', color: 'white', border: 'none' }}>+</button>
                        </div>
                    </div>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ width: '100%', padding: '0.4rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                    />
                </div>

                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {filteredShards.map(shard => (
                        <div
                            key={shard.id}
                            onClick={() => { setSelectedShardId(shard.id); setViewMode('viewer'); }}
                            style={{
                                padding: '0.5rem 1rem',
                                borderBottom: '1px solid var(--border-color)', // changed from #f0f0f0
                                cursor: 'pointer',
                                backgroundColor: selectedShardId === shard.id ? 'var(--bg-tertiary)' : 'transparent',
                                fontSize: '0.9rem'
                            }}
                        >
                            <div style={{ fontWeight: 500 }}>{shard.title}</div>
                            {shard.tags.length > 0 && (
                                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '2px' }}>
                                    {shard.tags.slice(0, 3).map(tag => (
                                        <span key={tag} style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '0 4px', borderRadius: '4px' }}>#{tag}</span>
                                    ))}
                                </div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {shard.content || "Empty content"}
                            </div>
                        </div>
                    ))}
                </div>

                <div style={{ padding: '0.5rem', borderTop: '1px solid var(--border-color)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {filteredShards.length} shards
                </div>
            </div>

            {/* Center: Main Editor/Viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--bg-secondary)' }}>
                <header style={{ height: '50px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', padding: '0 1rem', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button disabled={viewMode === 'editor'} onClick={() => setViewMode('editor')}>Editor</button>
                        <button disabled={viewMode === 'viewer'} onClick={() => setViewMode('viewer')}>Viewer</button>
                    </div>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        {selectedShardId && viewMode === 'editor' && (
                            <>
                                <button onClick={handleInsertCode} style={{ fontSize: '0.9rem' }}>Code</button>
                                <button onClick={handleLinkClick} style={{ fontSize: '0.9rem' }}>Link Shard</button>
                                <button onClick={handleImportMedia} style={{ fontSize: '0.9rem' }}>Insert Media</button>
                            </>
                        )}

                        {selectedShardId && (
                            <>
                                <button onClick={handleDelete} style={{ color: '#ef4444' }}>Delete</button>
                                <button onClick={handleSave} disabled={!isDirty}>Save</button>
                            </>
                        )}
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', borderLeft: '1px solid var(--border-color)', paddingLeft: '1rem' }}>{vaultPath}</span>
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
                                    style={{ fontSize: '1.5rem', fontWeight: 'bold', border: 'none', outline: 'none', marginBottom: '1rem', width: '100%', background: 'transparent', color: 'var(--text-primary)' }}
                                    placeholder="Shard Title"
                                />
                                <iframe
                                    ref={editorIframeRef as any}
                                    title="editor"
                                    style={{ flex: 1, border: 'none', width: '100%', height: '100%', backgroundColor: 'transparent' }}
                                    srcDoc={(() => {
                                        return `
                                            <!DOCTYPE html>
                                            <html>
                                            <head>
                                                <style>
                                                    ${getIframeStyle()}
                                                    textarea {
                                                        flex: 1;
                                                        width: 100%;
                                                        height: 100%;
                                                        border: none;
                                                        outline: none;
                                                        resize: none;
                                                        font-size: 1rem;
                                                        font-family: "JetBrains Mono", monospace;
                                                        padding: 0;
                                                        margin: 0;
                                                        box-sizing: border-box;
                                                        line-height: 1.6;
                                                        background: transparent;
                                                    }
                                                </style>
                                            </head>
                                            <body>
                                                <textarea id="editor" placeholder="Write something..."></textarea>
                                                <script>
                                                    const editor = document.getElementById('editor');
                                                    
                                                    // 1. Initial Load & Sync from Parent
                                                    window.addEventListener('message', (event) => {
                                                        const data = event.data;
                                                        if (data.type === 'set_content') {
                                                            editor.value = data.value;
                                                        } else if (data.type === 'get_content') {
                                                            // Reply? Maybe not needed if we sync on input
                                                        } else if (data.type === 'insert_text') {
                                                            const start = editor.selectionStart;
                                                            const end = editor.selectionEnd;
                                                            const text = editor.value;
                                                            const before = text.substring(0, start);
                                                            const after = text.substring(end);
                                                            const insert = data.text;
                                                            
                                                            editor.value = before + insert + after;
                                                            const newCursor = start + insert.length;
                                                            editor.selectionStart = newCursor;
                                                            editor.selectionEnd = newCursor;
                                                            editor.focus();
                                                            
                                                            // Notify parent
                                                            window.parent.postMessage({ type: 'editor_update', value: editor.value }, '*');
                                                        } else if (data.type === 'wrap_selection') {
                                                            const start = editor.selectionStart;
                                                            const end = editor.selectionEnd;
                                                            const text = editor.value;
                                                            const before = text.substring(0, start);
                                                            const selected = text.substring(start, end);
                                                            const after = text.substring(end);
                                                            // data.prefix, data.suffix
                                                            
                                                            const newVal = before + data.prefix + selected + data.suffix + after;
                                                            editor.value = newVal;
                                                            
                                                            // Cursor logic: if selected was empty, place cursor inside
                                                            if (start === end) {
                                                                const newCursor = start + data.prefix.length;
                                                                editor.selectionStart = newCursor;
                                                                editor.selectionEnd = newCursor;
                                                            } else {
                                                                // Select the wrapped text? Or just cursor at end?
                                                                // Let's select the wrapped text (including prefix/suffix? No, just original selection content? )
                                                                // Standard behavior: select valid content.
                                                                editor.selectionStart = start + data.prefix.length;
                                                                editor.selectionEnd = end + data.prefix.length;
                                                            }
                                                            editor.focus();
                                                             window.parent.postMessage({ type: 'editor_update', value: editor.value }, '*');
                                                        }
                                                    });

                                                    // 2. Input Handling
                                                    editor.addEventListener('input', () => {
                                                         window.parent.postMessage({ type: 'editor_update', value: editor.value }, '*');
                                                    });
                                                    
                                                    // 3. Request initial content on load
                                                    window.parent.postMessage({ type: 'editor_ready' }, '*');
                                                </script>
                                            </body>
                                            </html>
                                        `;
                                    })()}
                                />
                            </div>
                        ) : (
                            <iframe
                                title="viewer"
                                style={{ flex: 1, border: 'none', width: '100%', height: '100%', backgroundColor: 'transparent' }}
                                srcDoc={(() => {
                                    // 1. Process Markdown Content
                                    // 1a. Replace asset:// URLs
                                    let content = editContent.replace(
                                        /asset:\/\/([a-zA-Z0-9-]+)/g,
                                        (_m, id) => `http://localhost:${serverPort}/asset/${id}`
                                    );

                                    // 1b. Extract code blocks
                                    const codeBlocks: string[] = [];
                                    content = content.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, lang, code) => {
                                        let highlighted: string;
                                        try {
                                            if (lang && hljs.getLanguage(lang)) {
                                                highlighted = hljs.highlight(code, { language: lang }).value;
                                            } else {
                                                // escape HTML if no language
                                                highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                            }
                                        } catch (e) {
                                            console.error("Highlight error:", e);
                                            highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                        }

                                        const langBadge = lang
                                            ? `<div style="font-size:0.7rem;color:${theme === 'dark' ? '#a1a1aa' : '#71717a'};margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em;user-select:none;">${lang}</div>`
                                            : '';

                                        // Ensure pre has relative positioning for the badge if needed, or just flex column?
                                        // A div inside pre is valid HTML? No, pre content model is phrasing content.
                                        // But browsers render it. However, to be safe, let's put badge OUTSIDE pre?
                                        // No, we want it inside the "box".

                                        // Let's use a wrapper div for the whole block?
                                        // But `marked` replaces placeholder with block.
                                        // If block is `div`, it's fine.

                                        const block = `
                                            <div class="code-block-wrapper" style="position:relative;margin:12px 0;border-radius:8px;background:${theme === 'dark' ? '#27272a' : '#f4f4f5'};padding:1rem;">
                                                ${langBadge}
                                                <pre class="hljs" style="margin:0;padding:0;background:transparent;overflow-x:auto;"><code>${highlighted}</code></pre>
                                            </div>
                                        `;

                                        codeBlocks.push(block);
                                        return `\n\nCODEBLOCK${codeBlocks.length - 1}PLACEHOLDER\n\n`;
                                    });

                                    // 1c. Protect HTML
                                    const htmlBlocks: string[] = [];
                                    content = content.replace(/<(video|embed|track|\/video)[^>]*\/?>/gi, (match) => {
                                        htmlBlocks.push(match);
                                        return `HTMLSAFE${htmlBlocks.length - 1}END`;
                                    });

                                    // 1d. Custom Renderer
                                    const renderer = new Renderer();
                                    renderer.link = ({ href, text }) => {
                                        if (href && href.startsWith('shard://')) {
                                            const id = href.replace('shard://', '');
                                            return `<a href="#" data-shard-id="${id}" style="text-decoration:underline;cursor:pointer;">${text}</a>`;
                                        }
                                        return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
                                    };

                                    // 1e. Parse
                                    let html = marked.parse(content, { renderer, breaks: true }) as string;

                                    // 1f. Restore
                                    html = html.replace(/<p>\s*CODEBLOCK(\d+)PLACEHOLDER\s*<\/p>/g, (_, idx) => codeBlocks[parseInt(idx)]);
                                    html = html.replace(/CODEBLOCK(\d+)PLACEHOLDER/g, (_, idx) => codeBlocks[parseInt(idx)]);
                                    html = html.replace(/HTMLSAFE(\d+)END/g, (_, idx) => htmlBlocks[parseInt(idx)]);

                                    // 2. Wrap in HTML Template
                                    return `
                                        <!DOCTYPE html>
                                        <html>
                                        <head>
                                            <style>
                                                ${getIframeStyle()}
                                                /* Extra styles for viewer */
                                                h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
                                                h1 { font-size: 2em; border-bottom: 1px solid; padding-bottom: 0.3em; }
                                                p { line-height: 1.6; margin-bottom: 1em; }
                                                a { text-decoration: none; cursor: pointer; }
                                                a:hover { text-decoration: underline; }
                                                img { max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                                                pre { font-family: "JetBrains Mono", monospace; font-size: 0.9em; }
                                                code { font-family: "JetBrains Mono", monospace; padding: 0.2em 0.4em; border-radius: 4px; }
                                                pre code { background: transparent; padding: 0; }
                                                blockquote { border-left: 4px solid; margin: 0; padding-left: 1rem; }
                                                ul, ol { padding-left: 1.5rem; }
                                                li { margin-bottom: 0.5em; }
                                                ::selection { background-color: #b4d5fe; color: inherit; }
                                            </style>
                                            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${theme === 'dark' ? 'github-dark' : 'github'}.min.css">
                                        </head>
                                        <body>
                                            <h1>${editTitle}</h1>
                                            ${html}
                                            <script>
                                                // Link click handling
                                                document.addEventListener('click', e => {
                                                    const link = e.target.closest('a[data-shard-id]');
                                                    if (link) {
                                                        e.preventDefault();
                                                        window.parent.postMessage({ type: 'open_shard', id: link.dataset.shardId }, '*');
                                                    }
                                                });
                                                
                                                // Forward scroll events? Maybe not needed for simple viewer.
                                            </script>
                                        </body>
                                        </html>
                                    `;
                                })()}
                            />
                        )
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                            Select or create a shard to start
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar: Inspector */}
            {true && (
                <div style={{ width: '300px', minWidth: '300px', borderLeft: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)', padding: '1rem' }}>
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
                                        style={{ flex: 1, padding: '4px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                                    />
                                    <button onClick={handleAddTag} disabled={!newTag.trim()}>+</button>
                                </div>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                                    {shards.find(s => s.id === selectedShardId)?.tags.map(tag => (
                                        <span key={tag} style={{ background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            #{tag}
                                            <span
                                                onClick={() => handleRemoveTag(tag)}
                                                style={{ cursor: 'pointer', fontWeight: 'bold', color: 'var(--text-secondary)' }}
                                            >&times;</span>
                                        </span>
                                    ))}
                                    {shards.find(s => s.id === selectedShardId)?.tags.length === 0 && <small style={{ color: 'var(--text-secondary)' }}>No tags</small>}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <p style={{ color: 'var(--text-secondary)' }}>No shard selected</p>
                    )}
                </div>
            )}

            {/* Link Shard Modal */}
            {showLinkModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div style={{ backgroundColor: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px', width: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '1px solid var(--border-color)' }}>
                        <h3 style={{ marginTop: 0 }}>Select Shard to Link</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search shards..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--input-bg)', color: 'var(--text-primary)' }}
                            />
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '4px', minHeight: '200px' }}>
                            {filteredShards.map(shard => (
                                <div
                                    key={shard.id}
                                    onClick={() => handleSelectShardForLink(shard)}
                                    style={{ padding: '0.5rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}
                                >
                                    <div style={{ fontWeight: 'bold' }}>{shard.title}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{shard.id.substring(0, 8)}...</div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => setShowLinkModal(false)} style={{ marginTop: '1rem', padding: '0.5rem' }}>Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
}
