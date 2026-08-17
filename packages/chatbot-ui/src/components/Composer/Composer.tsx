import React from 'react';
const { useState, useRef, useEffect, useCallback, useImperativeHandle } = React;
import './Composer.css';
import { AttachedFile } from '../../api/types';
import { EnablableTool } from '../../api/GatewayStreamClient';
import { ToolToggles, hasRunnableTools } from '../ToolToggles/ToolToggles';

export interface ComposerHandle {
    focus: () => void;
}

export interface ComposerProps {
    onSend?: (text: string, attachedFiles?: AttachedFile[]) => void;
    disabled?: boolean;
    placeholder?: string;
    storageApiUrl?: string;
    accessToken?: string | null;
    /**
     * User-enabled tools offered in the composer's tools menu.
     *
     * The button appears only when at least one is runnable here, so a
     * deployment with no user-enabled tools — or an app with no handler for the
     * client ones — gets no button rather than one that opens an empty menu.
     */
    tools?: EnablableTool[];
    /** UUIDs currently switched on. */
    enabledToolIds?: string[];
    /** Called with the full new selection — not a delta. */
    onToolsChange?: (enabledIds: string[]) => void;
    /** Slugs the host app registered a handler for; see {@link ToolToggles}. */
    handledToolSlugs?: string[];
}

const ALLOWED_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (contentType?: string | null): string => {
    if (!contentType) return '\u{1F4CE}';
    if (contentType.startsWith('image/')) return '\u{1F5BC}\u{FE0F}';
    if (contentType === 'application/pdf') return '\u{1F4C4}';
    if (contentType.startsWith('text/')) return '\u{1F4DD}';
    return '\u{1F4CE}';
};

export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(({
    onSend,
    disabled = false,
    placeholder = 'Type a message...',
    storageApiUrl,
    accessToken,
    tools = [],
    enabledToolIds = [],
    onToolsChange,
    handledToolSlugs = [],
}, ref) => {
    const [toolMenuOpen, setToolMenuOpen] = useState(false);
    const showToolsButton =
        Boolean(onToolsChange) && hasRunnableTools(tools, handledToolSlugs);
    const activeToolCount = enabledToolIds.length;
    const [input, setInput] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const [uploadingCount, setUploadingCount] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const composerRef = useRef<HTMLDivElement>(null);
    const dragCounterRef = useRef(0);

    useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
    }));

    const adjustHeight = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = 'auto';
            textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
        }
    }, []);

    useEffect(() => {
        adjustHeight();
    }, [input, adjustHeight]);

    const isUploading = uploadingCount > 0;
    const canSend = input.trim() && !disabled && !isUploading;

    const uploadFile = useCallback(async (file: File): Promise<AttachedFile | null> => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            setUploadError(`Unsupported file type: ${file.type}`);
            return null;
        }

        if (file.size > MAX_FILE_SIZE) {
            setUploadError(`File too large (${formatFileSize(file.size)}). Max: ${formatFileSize(MAX_FILE_SIZE)}`);
            return null;
        }

        if (!storageApiUrl || !accessToken) {
            setUploadError('Storage API not configured.');
            return null;
        }

        setUploadingCount(prev => prev + 1);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${storageApiUrl}/api/v1/attachments/upload`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${accessToken}` },
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData?.message || errData?.detail || `Upload failed (${response.status})`);
            }

            const result = await response.json();
            const fileData: AttachedFile = {
                file_id: result.data.file.file_id,
                filename: result.data.file.filename,
                content_type: result.data.file.content_type,
                size_bytes: result.data.file.size_bytes,
                localBlobUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
            };

            return fileData;
        } catch (err) {
            setUploadError(err instanceof Error ? err.message : 'Upload failed');
            return null;
        } finally {
            setUploadingCount(prev => prev - 1);
        }
    }, [storageApiUrl, accessToken]);

    const handleFileSelect = useCallback(async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
            const result = await uploadFile(file);
            if (result) {
                setAttachedFiles(prev => [...prev, result]);
            }
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [uploadFile]);

    const removeFile = useCallback((fileId: string) => {
        setAttachedFiles(prev => {
            const file = prev.find(f => f.file_id === fileId);
            if (file?.localBlobUrl) {
                URL.revokeObjectURL(file.localBlobUrl);
            }
            return prev.filter(f => f.file_id !== fileId);
        });
    }, []);

    const handleSend = useCallback(() => {
        if (canSend) {
            onSend?.(input.trim(), attachedFiles.length > 0 ? attachedFiles : undefined);
            setInput('');
            setAttachedFiles([]);
            setUploadError(null);
            requestAnimationFrame(() => textareaRef.current?.focus());
        }
    }, [input, canSend, onSend, attachedFiles]);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (dragCounterRef.current === 1) {
            setIsDragging(true);
        }
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current -= 1;
        if (dragCounterRef.current === 0) {
            setIsDragging(false);
        }
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current = 0;
        setIsDragging(false);
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    }, [handleFileSelect]);

    return (
        <div
            ref={composerRef}
            className={`cb-composer ${isDragging ? 'cb-composer-drag-active' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {toolMenuOpen && showToolsButton && (
                <ToolToggles
                    tools={tools}
                    enabledIds={enabledToolIds}
                    onChange={onToolsChange!}
                    handledSlugs={handledToolSlugs}
                    onClose={() => setToolMenuOpen(false)}
                />
            )}
            {isDragging && (
                <div className="cb-drag-overlay">
                    <div className="cb-drag-overlay-content">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span>Drop files here</span>
                    </div>
                </div>
            )}
            <div className="cb-composer-input-wrapper">
                {attachedFiles.length > 0 && (
                    <div className="cb-attached-files">
                        {attachedFiles.map(f => (
                            <div key={f.file_id} className="cb-attached-file-chip">
                                <span className="cb-chip-icon">{getFileIcon(f.content_type)}</span>
                                <span className="cb-chip-name">{f.filename}</span>
                                <span className="cb-chip-size">{formatFileSize(f.size_bytes)}</span>
                                <button
                                    className="cb-chip-remove"
                                    onClick={() => removeFile(f.file_id)}
                                    title="Remove"
                                >
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {isUploading && (
                    <div className="cb-upload-progress-bar">
                        <div className="cb-upload-progress-text">
                            <span className="cb-upload-spinner-inline" />
                            Uploading {uploadingCount} file{uploadingCount > 1 ? 's' : ''}...
                        </div>
                    </div>
                )}

                {uploadError && (
                    <div className="cb-upload-error">
                        <span>{uploadError}</span>
                        <button className="cb-error-dismiss" onClick={() => setUploadError(null)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}

                <textarea
                    ref={textareaRef}
                    className="cb-composer-textarea"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    disabled={disabled}
                    rows={1}
                />
                <div className="cb-composer-actions">
                    <div className="cb-actions-left">
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            onChange={(e) => e.target.files && handleFileSelect(e.target.files)}
                            accept={ALLOWED_TYPES.join(',')}
                            style={{ display: 'none' }}
                            disabled={disabled || isUploading}
                        />
                        <button
                            className="cb-action-btn"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={disabled || isUploading || !storageApiUrl}
                            title="Attach files"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                        </button>
                        {showToolsButton && (
                            <button
                                // `active-state` while the menu is open, `active-icon` while any
                                // tool is on — the two are independent, and the icon tint is the
                                // at-a-glance signal that survives closing the menu.
                                className={
                                    'cb-action-btn'
                                    + (toolMenuOpen ? ' active-state' : '')
                                    + (activeToolCount > 0 ? ' active-icon' : '')
                                }
                                onClick={() => setToolMenuOpen(open => !open)}
                                disabled={disabled}
                                title="Tools"
                                aria-haspopup="true"
                                aria-expanded={toolMenuOpen}
                                style={{ position: 'relative' }}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="4" y1="21" x2="4" y2="14" />
                                    <line x1="4" y1="10" x2="4" y2="3" />
                                    <line x1="12" y1="21" x2="12" y2="12" />
                                    <line x1="12" y1="8" x2="12" y2="3" />
                                    <line x1="20" y1="21" x2="20" y2="16" />
                                    <line x1="20" y1="12" x2="20" y2="3" />
                                    <line x1="1" y1="14" x2="7" y2="14" />
                                    <line x1="9" y1="8" x2="15" y2="8" />
                                    <line x1="17" y1="16" x2="23" y2="16" />
                                </svg>
                                {activeToolCount > 0 && (
                                    <span className="cb-action-btn-badge">{activeToolCount}</span>
                                )}
                            </button>
                        )}
                    </div>
                    <button
                        className={`cb-send-btn ${canSend ? 'active' : ''}`}
                        onClick={handleSend}
                        disabled={!canSend}
                        title={isUploading ? 'Waiting for uploads...' : 'Send message'}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="12" y1="19" x2="12" y2="5" />
                            <polyline points="5 12 12 5 19 12" />
                        </svg>
                    </button>
                </div>
            </div>
            <div className="cb-composer-footer">
                <span>Uses AI. Verify results.</span>
            </div>
        </div>
    );
});

Composer.displayName = 'Composer';
