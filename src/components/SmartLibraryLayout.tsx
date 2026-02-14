import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ask, message, open } from '@tauri-apps/plugin-dialog';
import hljs from 'highlight.js';
import 'highlight.js/styles/atom-one-dark.css';
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

    // Editor State
    const [editTitle, setEditTitle] = useState('');
    const [editContent, setEditContent] = useState('');
    const [isDirty, setIsDirty] = useState(false);

    // Tag State
    const [newTag, setNewTag] = useState('');

    // Server Port
    const [serverPort, setServerPort] = useState<number | null>(null);

    // Linking State
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [showLinkModal, setShowLinkModal] = useState(false);
    const [cursorPos, setCursorPos] = useState<{ start: number, end: number } | null>(null);

    // Handle messages from Iframe Viewer (e.g. shard links)
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === 'open_shard') {
                const shardId = event.data.id;
                setSelectedShardId(shardId);
                setViewMode('viewer');
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, []);

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
        if (textareaRef.current) {
            setCursorPos({
                start: textareaRef.current.selectionStart,
                end: textareaRef.current.selectionEnd
            });
            setShowLinkModal(true);
        }
    };

    // Code Block Logic
    const handleInsertCode = () => {
        if (!textareaRef.current) return;
        const lang = window.prompt('Ngôn ngữ? (python, rust, js, ts, html, css, sql...)', 'python') || '';
        const ta = textareaRef.current;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const selected = editContent.substring(start, end);
        const codeBlock = `\n\`\`\`${lang}\n${selected || '// code here'}\n\`\`\`\n`;
        const newContent = editContent.substring(0, start) + codeBlock + editContent.substring(end);
        setEditContent(newContent);
        setIsDirty(true);
        setTimeout(() => {
            ta.focus();
            const cursorAt = start + 5 + lang.length; // after ```lang\n
            ta.selectionStart = cursorAt;
            ta.selectionEnd = cursorAt + (selected || '// code here').length;
        }, 0);
    };

    const handleSelectShardForLink = (targetShard: Shard) => {
        if (!cursorPos) return;

        const currentText = editContent;
        const selectedText = currentText.substring(cursorPos.start, cursorPos.end);
        const linkText = selectedText || targetShard.title;
        const insertText = `[${linkText}](shard://${targetShard.id})`;

        const newContent = currentText.substring(0, cursorPos.start) + insertText + currentText.substring(cursorPos.end);

        setEditContent(newContent);
        setIsDirty(true);
        setShowLinkModal(false);
        setCursorPos(null);
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
        <div style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden', backgroundColor: '#f4f4f5' }}>
            {/* Left Sidebar: Shard Library */}
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

            {/* Center: Main Editor/Viewer */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff' }}>
                <header style={{ height: '50px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', padding: '0 1rem', justifyContent: 'space-between' }}>
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
                                    ref={textareaRef}
                                    value={editContent}
                                    onChange={(e) => { setEditContent(e.target.value); setIsDirty(true); }}
                                    style={{ flex: 1, border: 'none', outline: 'none', resize: 'none', fontSize: '1rem', fontFamily: 'monospace' }}
                                    placeholder="Write something..."
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
                                        if (lang && hljs.getLanguage(lang)) {
                                            highlighted = hljs.highlight(code, { language: lang }).value;
                                        } else {
                                            highlighted = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                        }
                                        const langBadge = lang
                                            ? `<div style="font-size:0.7rem;color:#7f849c;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;">${lang}</div>`
                                            : '';
                                        const block = `<pre class="hljs" style="padding:1rem;border-radius:8px;overflow-x:auto;margin:12px 0;"><code>${langBadge}${highlighted}</code></pre>`;
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
                                            return `<a href="#" data-shard-id="${id}" style="color:#2563eb;text-decoration:underline;cursor:pointer;">${text}</a>`;
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
                                                body {
                                                    font-family: system-ui, -apple-system, blinkmacsystemfont, "Segoe UI", roboto, oxygen, ubuntu, cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif;
                                                    margin: 0;
                                                    padding: 2rem;
                                                    color: #0f0f0f;
                                                    background-color: transparent;
                                                    font-weight: 400;
                                                    -webkit-font-smoothing: antialiased;
                                                }
                                                h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; font-weight: 600; }
                                                h1 { font-size: 2em; border-bottom: 1px solid #eaeaea; padding-bottom: 0.3em; }
                                                p { line-height: 1.6; margin-bottom: 1em; }
                                                a { color: #2563eb; text-decoration: none; cursor: pointer; }
                                                a:hover { text-decoration: underline; }
                                                img { max-width: 100%; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                                                pre { font-family: "JetBrains Mono", monospace; font-size: 0.9em; }
                                                code { font-family: "JetBrains Mono", monospace; background: rgba(0,0,0,0.05); padding: 0.2em 0.4em; border-radius: 4px; }
                                                pre code { background: transparent; padding: 0; }
                                                blockquote { border-left: 4px solid #e5e7eb; margin: 0; padding-left: 1rem; color: #6b7280; }
                                                ul, ol { padding-left: 1.5rem; }
                                                li { margin-bottom: 0.5em; }
                                                ::selection { background-color: #b4d5fe; color: inherit; }
                                            </style>
                                            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css">
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#a1a1aa' }}>
                            Select or create a shard to start
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar: Inspector */}
            {true && (
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
            )}

            {/* Link Shard Modal */}
            {showLinkModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000
                }}>
                    <div style={{ backgroundColor: 'white', padding: '1rem', borderRadius: '8px', width: '400px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}>
                        <h3 style={{ marginTop: 0 }}>Select Shard to Link</h3>
                        <div style={{ marginBottom: '1rem' }}>
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search shards..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{ width: '100%', padding: '0.5rem', border: '1px solid #ccc', borderRadius: '4px' }}
                            />
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px', minHeight: '200px' }}>
                            {filteredShards.map(shard => (
                                <div
                                    key={shard.id}
                                    onClick={() => handleSelectShardForLink(shard)}
                                    style={{ padding: '0.5rem', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                                >
                                    <div style={{ fontWeight: 'bold' }}>{shard.title}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{shard.id.substring(0, 8)}...</div>
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
