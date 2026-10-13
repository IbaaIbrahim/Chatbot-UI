import React from 'react';
import './Composer.css';
import { AttachedFile } from '../../api/types';
import { netFetch } from '../../common/localNetwork';
import { formatLabel } from '../../common/labels';
import { ToolToggles, hasRunnableTools } from '../ToolToggles/ToolToggles';
import { UsageIndicator } from '../UsageIndicator/UsageIndicator';
import {
    resolveStorageUploadUrl,
    parseUploadedFileResponse,
} from '../../common/attachmentUtils';
import { useChatActions, useChatRuntime, useChatState, useIcons, useLabels } from '../../store/hooks';

const { useState, useRef, useEffect, useLayoutEffect, useCallback, useImperativeHandle } = React;

export interface ComposerHandle {
    focus: () => void;
    /** Replace the text in the input. */
    setText: (text: string) => void;
    directToolCall?: (toolSlug: string, toolInput: any) => Promise<any>;
    getAttachedFiles: () => AttachedFile[];
    clearAttachedFiles: () => void;
}

/**
 * Per-instance overrides only. Everything shared — whether a turn is running,
 * the tools, which controls exist — comes from the provider, so two composers
 * on one page agree about all of it.
 */
export interface ComposerProps {
    /** Overrides the chat's own busy state, for a host with work of its own in flight. */
    disabled?: boolean;
    /** Overrides `labels.composerPlaceholder` for this composer only. */
    placeholder?: string;
    /** Where the tools menu opens relative to the composer. */
    toolMenuPlacement?: 'above' | 'center';
    className?: string;
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

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_TEXTAREA_HEIGHT_PX = 180;

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

/**
 * The usage ring, subscribed on its own: the summary is rebuilt as the turn
 * streams, and only this needs to redraw when it is.
 */
const ComposerUsage: React.FC = () => {
    const usage = useChatState(s => s.usageSummary);
    const details = useChatState(s => s.config.composer.usageDetails);
    return usage ? <UsageIndicator summary={usage} details={details} /> : null;
};

export const Composer = React.forwardRef<ComposerHandle, ComposerProps>(({
    disabled: disabledProp,
    placeholder: placeholderProp,
    toolMenuPlacement = 'above',
    className = '',
}, ref) => {
    const storageApiUrl = useChatState(s => s.storageApiUrl);
    const accessToken = useChatState(s => s.accessToken);
    const tools = useChatState(s => s.enablableTools);
    const enabledToolIds = useChatState(s => s.enabledToolIds);
    const handledToolSlugs = useChatState(s => s.handledToolSlugs);
    const registeredTools = useChatState(s => s.registeredTools);
    const isBusy = useChatState(s => s.isThinking || s.isResuming);
    const isStopping = useChatState(s => s.isStopping);
    const canStop = useChatState(s => s.canStop);
    const hasPendingQuestions = useChatState(s => s.pendingQuestions !== null);
    const composerConfig = useChatState(s => s.config.composer);
    const hasMessages = useChatState(s => s.messages.length > 0);
    const actions = useChatActions();
    const { registerComposer } = useChatRuntime();
    const labels = useLabels();
    const icons = useIcons();

    const disabled = disabledProp ?? (isBusy || hasPendingQuestions);
    const placeholder = placeholderProp
        ?? (hasPendingQuestions ? labels.questionnairePlaceholder : labels.composerPlaceholder);

    const compact = composerConfig.density === 'compact'
        || (composerConfig.density === 'auto' && hasMessages);
    const compactRef = useRef(compact);
    compactRef.current = compact;
    // Whether a compact composer has given its text the full width. See adjustHeight.
    const [multiline, setMultiline] = useState(false);

    const [toolMenuOpen, setToolMenuOpen] = useState(false);
    const showToolsButton = composerConfig.tools && hasRunnableTools(tools, handledToolSlugs);
    const activeToolCount = enabledToolIds.length;
    const [input, setInput] = useState('');
    const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
    const attachedFilesRef = useRef<AttachedFile[]>(attachedFiles);
    attachedFilesRef.current = attachedFiles;

    const [uploadingCount, setUploadingCount] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragCounterRef = useRef(0);

    const directToolCall = useCallback(async (toolSlug: string, toolInput: any): Promise<any> => {
        const registeredTool = registeredTools[toolSlug];
        if (registeredTool && 'run' in registeredTool && registeredTool.run) {
            return registeredTool.run(toolInput, { tool_slug: toolSlug, step_uuid: '' });
        }
        throw new Error(`No direct tool handler available for '${toolSlug}'`);
    }, [registeredTools]);

    useImperativeHandle(ref, () => ({
        focus: () => textareaRef.current?.focus(),
        setText: setInput,
        directToolCall,
        getAttachedFiles: () => attachedFilesRef.current,
        clearAttachedFiles: () => setAttachedFiles([]),
    }));

    // So `useChatActions().focusComposer()` / `setComposerText()` reach this
    // composer from anywhere in the host.
    useEffect(() => registerComposer({
        focus: () => textareaRef.current?.focus(),
        setText: setInput,
    }), [registerComposer]);

    // Cleanup object URLs on unmount
    useEffect(() => {
        return () => {
            attachedFilesRef.current.forEach(f => {
                if (f.localBlobUrl) {
                    try {
                        URL.revokeObjectURL(f.localBlobUrl);
                    } catch {
                        // Already revoked.
                    }
                }
            });
        };
    }, []);

    /**
     * Fit the box to its text.
     *
     * An empty box keeps its natural one-row height rather than being measured:
     * the measurement includes the placeholder, and a composer laid out narrow
     * for a moment — mid-move into a host's fullscreen page — wrapped it into a
     * box several rows tall that stayed that way until the user typed.
     *
     * A compact composer keeps its text beside the buttons until the text needs
     * a second line, then gives it the full width — and keeps it there until the
     * box is emptied. Returning to one row as soon as the text fit again would
     * re-wrap it at the narrower width and flip the layout straight back, so a
     * line ending near the edge would make the box flicker on every keystroke.
     */
    const adjustHeight = useCallback(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        if (!textarea.value) {
            textarea.style.height = '';
            setMultiline(false);
            return;
        }
        if (compactRef.current
            && (textarea.value.includes('\n') || textarea.scrollHeight > textarea.clientHeight + 1)) {
            setMultiline(true);
        }
        textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
    }, []);

    // Before paint, so a keystroke never shows a box of the previous height, and
    // again when the layout changes under the text.
    useLayoutEffect(() => {
        adjustHeight();
    }, [input, compact, multiline, adjustHeight]);

    // The same text wraps to a different height at a different width — a mode
    // switch, a sidebar opening — so the box is re-fitted whenever its width changes.
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea || typeof ResizeObserver === 'undefined') return undefined;
        let fittedWidth = textarea.clientWidth;
        const observer = new ResizeObserver(() => {
            if (textarea.clientWidth === fittedWidth) return;
            fittedWidth = textarea.clientWidth;
            adjustHeight();
        });
        observer.observe(textarea);
        return () => observer.disconnect();
    }, [adjustHeight]);

    const isUploading = uploadingCount > 0;
    const hasText = Boolean(input.trim());
    const hasFiles = attachedFiles.length > 0;
    const canSend = (hasText || hasFiles) && !disabled && !isUploading;

    const uploadFile = useCallback(async (file: File): Promise<AttachedFile | null> => {
        if (!ALLOWED_TYPES.includes(file.type)) {
            setUploadError(formatLabel(labels.unsupportedFileType, { type: file.type }));
            return null;
        }

        if (file.size > MAX_FILE_SIZE) {
            setUploadError(formatLabel(labels.fileTooLarge, {
                size: formatFileSize(file.size),
                max: formatFileSize(MAX_FILE_SIZE),
            }));
            return null;
        }

        if (!storageApiUrl) {
            setUploadError(labels.uploadNeedsStorageUrl);
            return null;
        }
        if (!accessToken) {
            setUploadError(labels.uploadNeedsToken);
            return null;
        }

        setUploadingCount(prev => prev + 1);
        setUploadError(null);

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await netFetch(resolveStorageUploadUrl(storageApiUrl), {
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

            const parsed = parseUploadedFileResponse(await response.json(), file);

            // Generate a local blob URL for immediate local preview
            let localBlobUrl: string | undefined;
            try {
                localBlobUrl = URL.createObjectURL(file);
            } catch {
                localBlobUrl = undefined;
            }

            return {
                file_id: parsed.file_id,
                filename: parsed.filename,
                content_type: parsed.content_type,
                size_bytes: parsed.size_bytes,
                url: parsed.url,
                localBlobUrl,
            };
        } catch (err: any) {
            setUploadError(err.message || labels.uploadFailed);
            return null;
        } finally {
            setUploadingCount(prev => Math.max(0, prev - 1));
        }
    }, [storageApiUrl, accessToken, labels]);

    const handleFileSelect = useCallback(async (files: FileList | File[]) => {
        for (const file of Array.from(files)) {
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
        setAttachedFiles(prev => {
            const file = prev.find(f => f.file_id === fileId);
            if (file?.localBlobUrl) {
                try {
                    URL.revokeObjectURL(file.localBlobUrl);
                } catch {
                    // Already revoked.
                }
            }
            return prev.filter(f => f.file_id !== fileId);
        });
    }, []);

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

        void actions.sendMessage(textToSend, filesToSend);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

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

        if (composerConfig.attachments && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    }, [composerConfig.attachments, handleFileSelect]);

    const showMic = composerConfig.mic && Boolean(composerConfig.onVoiceInput);
    const showFooter = composerConfig.disclaimer || composerConfig.usage;
    const hasNotices = hasFiles || isUploading || Boolean(uploadError);

    const composerClasses = [
        'cb-composer',
        compact ? 'cb-composer--compact' : null,
        compact && multiline ? 'cb-composer--multiline' : null,
        isDragging ? 'cb-dragging' : null,
        className || null,
    ].filter(Boolean).join(' ');

    return (
        <div
            className={composerClasses}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {isDragging && composerConfig.attachments && (
                <div className="cb-drag-overlay">
                    <div className="cb-drag-message">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                        </svg>
                        <span>{labels.dropFiles}</span>
                    </div>
                </div>
            )}

            {showToolsButton && toolMenuOpen && (
                <ToolToggles
                    onClose={() => setToolMenuOpen(false)}
                    tools={tools}
                    enabledIds={enabledToolIds}
                    onChange={actions.setEnabledToolIds}
                    handledSlugs={handledToolSlugs}
                    placement={toolMenuPlacement}
                />
            )}

            <div className="cb-composer-input-wrapper">
                <div className="cb-composer-upper">
                    {hasNotices && (
                        <div className="cb-composer-notices">
                            {hasFiles && (
                                <div className="cb-attached-files-list">
                                    {attachedFiles.map(f => (
                                        <div key={f.file_id} className="cb-attached-file-chip">
                                            <span className="cb-chip-icon">{getFileIcon(f.content_type)}</span>
                                            <span className="cb-chip-name">{f.filename}</span>
                                            <span className="cb-chip-size">{formatFileSize(f.size_bytes)}</span>
                                            <button
                                                type="button"
                                                className="cb-chip-remove"
                                                onClick={() => removeFile(f.file_id)}
                                                title={labels.removeAttachment}
                                                aria-label={labels.removeAttachment}
                                            >
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
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
                                        {formatLabel(labels.uploadingFiles, { count: uploadingCount })}
                                    </div>
                                </div>
                            )}

                            {uploadError && (
                                <div className="cb-upload-error">
                                    <span>{uploadError}</span>
                                    <button
                                        type="button"
                                        className="cb-error-dismiss"
                                        onClick={() => setUploadError(null)}
                                        aria-label={labels.close}
                                    >
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                                            <line x1="18" y1="6" x2="6" y2="18" />
                                            <line x1="6" y1="6" x2="18" y2="18" />
                                        </svg>
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <textarea
                        ref={textareaRef}
                        className="cb-composer-textarea"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        aria-label={placeholder}
                        disabled={disabled}
                        rows={1}
                    />

                    <div className="cb-composer-actions">
                        <div className="cb-actions-left">
                            {composerConfig.attachments && (
                                <>
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
                                        type="button"
                                        className="cb-action-btn cb-plus-btn"
                                        onClick={() => fileInputRef.current?.click()}
                                        disabled={disabled || isUploading || !storageApiUrl}
                                        title={storageApiUrl ? labels.addAttachment : labels.attachmentsUnavailable}
                                        aria-label={labels.addAttachment}
                                    >
                                        {icons.attach}
                                    </button>
                                </>
                            )}

                            {showToolsButton && (
                                <button
                                    type="button"
                                    className={
                                        'cb-action-btn cb-tools-btn'
                                        + (toolMenuOpen ? ' active-state' : '')
                                        + (activeToolCount > 0 ? ' active-icon' : '')
                                    }
                                    onClick={() => setToolMenuOpen(open => !open)}
                                    disabled={disabled}
                                    title={labels.tools}
                                    aria-label={labels.tools}
                                    aria-haspopup="true"
                                    aria-expanded={toolMenuOpen}
                                >
                                    {icons.tools}
                                    {activeToolCount > 0 && (
                                        <span className="cb-action-btn-badge">{activeToolCount}</span>
                                    )}
                                </button>
                            )}
                        </div>

                        <div className="cb-actions-right">
                            {showMic && (
                                <button
                                    type="button"
                                    className="cb-action-btn cb-mic-btn"
                                    title={labels.voiceInput}
                                    aria-label={labels.voiceInput}
                                    onClick={composerConfig.onVoiceInput}
                                >
                                    {icons.mic}
                                </button>
                            )}

                            {canStop && isBusy ? (
                                <button
                                    type="button"
                                    className="cb-send-btn cb-stop-btn active"
                                    onClick={() => void actions.stopTurn()}
                                    disabled={isStopping}
                                    title={isStopping ? labels.stopping : labels.stop}
                                    aria-label={isStopping ? labels.stopping : labels.stop}
                                >
                                    {icons.stop}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    className={`cb-send-btn ${canSend ? 'active' : ''}`}
                                    onClick={handleSend}
                                    disabled={!canSend}
                                    title={isUploading ? labels.waitingForUploads : labels.send}
                                    aria-label={labels.send}
                                >
                                    {icons.send}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showFooter && (
                <div className="cb-composer-footer">
                    {composerConfig.disclaimer && <span className="cb-composer-footer-note">{labels.disclaimer}</span>}
                    {composerConfig.usage && <ComposerUsage />}
                </div>
            )}
        </div>
    );
});

Composer.displayName = 'Composer';

export const ChatComposer = Composer;
