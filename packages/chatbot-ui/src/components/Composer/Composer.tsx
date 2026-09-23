import React from 'react';
const { useState, useRef, useEffect, useCallback, useImperativeHandle } = React;
import './Composer.css';
import { AttachedFile } from '../../api/types';
import { netFetch } from '../../common/localNetwork';
import { EnablableTool } from '../../api/GatewayStreamClient';
import { ToolToggles, hasRunnableTools } from '../ToolToggles/ToolToggles';
import { UsageIndicator } from '../UsageIndicator/UsageIndicator';
import type { TurnUsageSummary } from '../../common/usageSummary';
import {
    ChatbotUIConfig,
    ContextSelectorConfig,
} from '../../common/chatbotConfig';

export interface ComposerHandle {
    focus: () => void;
}

export interface ComposerProps {
    onSend?: (text: string, attachedFiles?: AttachedFile[], contextIds?: string[]) => void;
    disabled?: boolean;
    placeholder?: string;
    storageApiUrl?: string;
    accessToken?: string | null;
    tools?: EnablableTool[];
    enabledToolIds?: string[];
    onToolsChange?: (enabledIds: string[]) => void;
    handledToolSlugs?: string[];
    onStop?: () => void;
    isRunning?: boolean;
    isStopping?: boolean;
    usage?: TurnUsageSummary | null;
    config?: ChatbotUIConfig;
    contextConfig?: ContextSelectorConfig;
    selectedContextIds?: string[];
    onContextChange?: (selectedIds: string[]) => void;
    onSelectedContextsChange?: (selectedIds: string[]) => void;
    onVoiceInput?: () => void;
    /** Where the tools menu opens relative to the composer. */
    toolMenuPlacement?: 'above' | 'center';
    /** Optional agent switcher component to integrate into the bottom row. */
    agentSwitcher?: React.ReactNode;
    /** Optional left content for the bottom row. */
    bottomLeftContent?: React.ReactNode;
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
    onStop,
    isRunning = false,
    isStopping = false,
    disabled = false,
    placeholder = 'Describe what you want to do…',
    storageApiUrl,
    accessToken,
    tools = [],
    enabledToolIds = [],
    onToolsChange,
    handledToolSlugs = [],
    usage = null,
    config: _config,
    contextConfig: _contextConfig,
    selectedContextIds,
    onContextChange: _onContextChange,
    onSelectedContextsChange: _onSelectedContextsChange,
    onVoiceInput,
    toolMenuPlacement = 'above',
    agentSwitcher,
    bottomLeftContent,
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
    const canSend = Boolean(input.trim()) && !disabled && !isUploading;

    const uploadFile = useCallback(async (file: File): Promise<AttachedFile | null> => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            setUploadError(`Unsupported file type: ${file.type}`);
            return null;
        }

        if (file.size > MAX_FILE_SIZE) {
            setUploadError(`File too large (${formatFileSize(file.size)}). Max: ${formatFileSize(MAX_FILE_SIZE)}`);
            return null;
        }

        if (!storageApiUrl) {
            setUploadError('File upload is unavailable: no storage API URL is configured.');
            return null;
        }
        if (!accessToken) {
            setUploadError('File upload is unavailable: no access token is configured.');
            return null;
        }

        setUploadingCount(prev => prev + 1);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const uploadUrl = `${storageApiUrl.replace(/\/+$/, '')}/upload`;
            const response = await netFetch(uploadUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.detail || errData.message || `Upload failed (${response.status})`);
            }

            const data = await response.json();
            return {
                file_id: data.file_id || data.id,
                filename: file.name,
                content_type: file.type,
                size_bytes: file.size,
                url: data.url,
            };
        } catch (err: any) {
            setUploadError(err.message || 'File upload failed');
            return null;
        } finally {
            setUploadingCount(prev => Math.max(0, prev - 1));
        }
    }, [storageApiUrl, accessToken]);

    const handleFileSelect = useCallback(async (files: FileList | File[]) => {
        const fileArray = Array.from(files);
        for (const file of fileArray) {
            const uploaded = await uploadFile(file);
            if (uploaded) {
                setAttachedFiles(prev => [...prev, uploaded]);
            }
        }
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [uploadFile]);

    const removeFile = useCallback((fileId: string) => {
        setAttachedFiles(prev => prev.filter(f => f.file_id !== fileId));
    }, []);

    const handleDragEnter = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounterRef.current += 1;
        if (e.dataTransfer?.types?.includes('Files')) {
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
        setIsDragging(false);
        dragCounterRef.current = 0;

        if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    }, [handleFileSelect]);

    const handleSend = () => {
        if (!canSend) return;
        const textToSend = input.trim();
        const filesToSend = attachedFiles.length > 0 ? [...attachedFiles] : undefined;
        setInput('');
        setAttachedFiles([]);
        setUploadError(null);

        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        onSend?.(textToSend, filesToSend, selectedContextIds);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div
            ref={composerRef}
            className={`cb-composer ${isDragging ? 'cb-dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {isDragging && (
                <div className="cb-drag-overlay">
                    <div className="cb-drag-message">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span>Drop files to attach</span>
                    </div>
                </div>
            )}

            {showToolsButton && toolMenuOpen && (
                <ToolToggles
                    onClose={() => setToolMenuOpen(false)}
                    tools={tools}
                    enabledIds={enabledToolIds}
                    onChange={onToolsChange!}
                    handledSlugs={handledToolSlugs}
                    placement={toolMenuPlacement}
                />
            )}

            <div className="cb-composer-input-wrapper">
                <div className="cb-composer-upper">
                    {attachedFiles.length > 0 && (
                        <div className="cb-attached-files-list">
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

                            {/* Plus button matching Image 1, 3, 4 */}
                            <button
                                className="cb-action-btn cb-plus-btn"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={disabled || isUploading || !storageApiUrl || !accessToken}
                                title="Add attachment"
                                aria-label="Add attachment"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <line x1="12" y1="5" x2="12" y2="19" />
                                    <line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                            </button>

                            {showToolsButton && (
                                <button
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

                        <div className="cb-actions-right">
                            {/* Voice input button matching Image 1, 3, 4 */}
                            <button
                                type="button"
                                className="cb-action-btn cb-mic-btn"
                                title="Voice input"
                                aria-label="Voice input"
                                onClick={onVoiceInput}
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                                    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                                    <line x1="12" y1="19" x2="12" y2="23" />
                                    <line x1="8" y1="23" x2="16" y2="23" />
                                </svg>
                            </button>

                            {onStop && isRunning ? (
                                <button
                                    className="cb-send-btn cb-stop-btn active"
                                    onClick={onStop}
                                    disabled={isStopping}
                                    title={isStopping ? 'Stopping…' : 'Stop generating'}
                                    aria-label={isStopping ? 'Stopping' : 'Stop generating'}
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                                        <rect x="6" y="6" width="12" height="12" rx="2" />
                                    </svg>
                                </button>
                            ) : (
                                <button
                                    className={`cb-send-btn ${canSend ? 'active' : ''}`}
                                    onClick={handleSend}
                                    disabled={!canSend}
                                    title={isUploading ? 'Waiting for uploads…' : 'Send message'}
                                    aria-label="Send message"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <line x1="22" y1="2" x2="11" y2="13" />
                                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {(agentSwitcher || bottomLeftContent) && (
                    <div className="cb-composer-bottom-row">
                        <div className="cb-composer-bottom-left">
                            {bottomLeftContent}
                        </div>
                        <div className="cb-composer-bottom-right">
                            {agentSwitcher}
                        </div>
                    </div>
                )}
            </div>

            <div className="cb-composer-footer">
                <span className="cb-composer-footer-note">Uses AI. Verify results.</span>
                {usage && <UsageIndicator summary={usage} />}
            </div>
        </div>
    );
});

Composer.displayName = 'Composer';
