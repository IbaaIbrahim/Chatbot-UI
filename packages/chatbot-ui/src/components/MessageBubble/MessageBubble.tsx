import React from 'react';
import ReactDOM from 'react-dom';
const { useState, useEffect, useRef, useCallback } = React;
import './MessageBubble.css';
import { parseToolOutput } from '../../api/toolOutput';
import {
    ToolInvocation,
    ToolActionConfig,
    ToolActionControl,
    ToolActionPlacement,
} from '../ToolInvocation/ToolInvocation';
import { ConfirmButtons, ConfirmStatus } from '../ConfirmButtons/ConfirmButtons';
import { AuthenticatedImage } from '../AuthenticatedImage/AuthenticatedImage';
import { BlinkingIndicator } from '../BlinkingIndicator/BlinkingIndicator';
import { MessageActions } from '../MessageActions/MessageActions';
import { BranchNavigator } from '../BranchNavigator/BranchNavigator';
import { useChatbotContext } from '../../context/ChatbotContext';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export interface Attachment {
    id: string;
    type: 'image' | 'file';
    url: string;
    name?: string;
    size?: number;
    contentType?: string;
    localUrl?: string;
}

export type MessageStepType = 'text' | 'thinking' | 'tool-call' | 'confirm-request' | 'sub-agent' | 'error' | 'notice';

export interface MessageStep {
    id: string;
    type: MessageStepType;
    content?: string;
    toolName?: string;
    toolArgs?: any;
    toolStatus?: 'running' | 'completed' | 'failed';
    toolResult?: any;
    isFinished?: boolean;
    thoughts?: string[];
    // Confirm request fields
    toolCallId?: string;
    confirmLabel?: string;
    confirmDescription?: string;
    confirmStatus?: ConfirmStatus;
    /**
     * Sub-agent fields. A ``sub-agent`` step is one agent's whole run rendered
     * inside another's turn: `subSteps` are the child's own steps, in its own
     * order, and `content` is its answer. Collapsed by default — the user asked
     * one agent a question and should see one answer, with the working
     * available rather than in the way.
     */
    agentName?: string;
    subSteps?: MessageStep[];
    /**
     * Error and notice fields.
     *
     * An ``error`` step is a failure the user can act on, rendered as its own
     * block rather than appended to the answer as prose — a failure buried in
     * the middle of a paragraph is one nobody sees, and it carries a button.
     *
     * ``recovery`` says which button, and the distinction is not cosmetic:
     * ``retry`` re-sends a turn that produced nothing, while ``continue`` picks
     * up a turn that produced something and stopped. Offering the wrong one
     * either throws away a partial answer or silently starts a second billable
     * turn.
     *
     * A ``notice`` is not a failure at all — the run is healthy and waiting, so
     * it gets no button and is replaced when the wait ends.
     */
    recovery?: 'retry' | 'continue' | null;
}

export interface MessageProps {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content?: string;
    steps?: MessageStep[];
    timestamp?: Date;
    attachments?: Attachment[];
    toolInvocation?: {
        toolName: string;
        args: any;
        status: 'running' | 'completed' | 'failed';
        result?: any;
    };
    onAnimationComplete?: () => void;
    shouldAnimate?: boolean;
    onConfirm?: (toolCallId: string) => void;
    onReject?: (toolCallId: string) => void;
    /**
     * Render the steps without the avatar and sender name. Used when this
     * bubble is nested inside another — a sub-agent's run inside the turn that
     * started it — where the surrounding block already says who is speaking.
     * The step rendering itself is identical, which is the point: there is one
     * renderer, not one per nesting level.
     */
    embedded?: boolean;
    /**
     * Who produced this message. Defaults to "Assistant". A conversation can
     * change hands (a handoff), so the label is per message rather than a
     * constant.
     */
    senderName?: string;
    /**
     * Client-tool handlers, keyed by tool slug. A matching ``tool-call`` step
     * renders an action button that re-fires the handler with the step's
     * **arguments** — what a ``dispatch_mode='client'`` tool acts on.
     */
    onToolCall?: Record<string, (data: any) => Promise<any> | void>;
    /**
     * Server-tool output handlers, keyed by tool slug. A matching ``tool-call``
     * step renders an action button that re-fires the handler with the step's
     * **result** — what a ``kafka``/``inline`` tool produced. Kept separate from
     * {@link onToolCall} because the payload differs, not just the timing.
     */
    onToolPreview?: Record<
        string,
        (output: any, context: { step_uuid: string }) => Promise<void> | void
    >;
    /**
     * How each tool's completed step presents its action, keyed by slug.
     *
     * Applies to both handler channels above: having a handler is what makes an
     * action possible, this is what decides whether it is offered and what it
     * looks like. A slug with no entry keeps the default button.
     */
    toolActions?: Record<string, ToolActionConfig>;
    /** Re-send the turn that failed before producing anything. */
    onRetry?: () => void;
    /** Pick up a turn that produced output and then stopped. */
    onContinue?: () => void;
    /**
     * Whether this turn has finished. Defaults to `true`.
     *
     * Only read by tool actions placed at `'turn-end'`, which wait for it. A
     * message rebuilt from history is finished by definition; the live bubble is
     * not, and the chat app passes `false` for it while the run is in flight.
     */
    isTurnComplete?: boolean;
    isWaitingForDeltas?: boolean; // Show blinking indicator when waiting for deltas
    // Message actions
    onReply?: (message: MessageProps, selectedText?: string) => void;
    onEdit?: (messageId: string, content: string) => void;
    onSwitchBranch?: (branchPointMessageId: string, targetChildMessageId: string) => void;
    // Reply display
    replyToMessageId?: string;
    replyToContent?: string;
    replyToRole?: string;
    // Branching
    parentMessageId?: string;
    branchPoint?: boolean;
    branchCount?: number;
    activeBranchIndex?: number;
    branchIds?: string[];
}

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileIcon = (contentType?: string): string => {
    if (!contentType) return '\u{1F4CE}';
    if (contentType.startsWith('image/')) return '\u{1F5BC}\u{FE0F}';
    if (contentType === 'application/pdf') return '\u{1F4C4}';
    if (contentType.startsWith('text/')) return '\u{1F4DD}';
    return '\u{1F4CE}';
};

const inferContentType = (filename?: string, hint?: string): string => {
    if (hint && hint.trim()) return hint;
    if (!filename) return 'application/octet-stream';
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
        case 'pdf': return 'application/pdf';
        case 'png': return 'image/png';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        case 'svg': return 'image/svg+xml';
        case 'txt': return 'text/plain';
        case 'csv': return 'text/csv';
        case 'json': return 'application/json';
        case 'md': return 'text/markdown';
        default: return 'application/octet-stream';
    }
};

// --- Attachment Viewer Modal (unified for all attachment types) ---
const AttachmentViewerModal: React.FC<{
    attachment: Attachment | null;
    isOpen: boolean;
    onClose: () => void;
}> = ({ attachment, isOpen, onClose }) => {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const [pdfPageNumber, setPdfPageNumber] = useState(1);
    const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
    const context = useChatbotContext();
    const downloadLinkRef = useRef<HTMLAnchorElement | null>(null);

    useEffect(() => {
        if (!isOpen || !attachment) return;
        let cancelled = false;

        const load = async () => {
            setState('loading');
            setBlobUrl(null);
            setTextContent(null);
            setErrorMsg('');

            if (!context) {
                setState('error');
                setErrorMsg('No authentication context available');
                return;
            }

            try {
                const url = await context.fetchAuthenticatedUrl(attachment.url);
                if (cancelled) return;
                setBlobUrl(url);

                const ct = attachment.contentType ?? '';
                if (ct.startsWith('text/') || ct === 'text/csv') {
                    const text = await fetch(url).then(r => r.text());
                    if (cancelled) return;
                    setTextContent(text);
                }

                setState('ready');
            } catch (e) {
                if (cancelled) return;
                setState('error');
                setErrorMsg(e instanceof Error ? e.message : 'Failed to load attachment');
            }
        };

        load();
        return () => { cancelled = true; };
    }, [isOpen, attachment, context]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        if (isOpen) {
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
        }
    }, [isOpen, onClose]);

    const handleDownload = () => {
        if (blobUrl && attachment && downloadLinkRef.current) {
            downloadLinkRef.current.href = blobUrl;
            downloadLinkRef.current.download = attachment.name || 'download';
            downloadLinkRef.current.click();
        }
    };

    if (!isOpen || !attachment) return null;

    const ct = inferContentType(attachment.name, attachment.contentType);

    return ReactDOM.createPortal(
        <div className="cb-attachment-viewer-overlay" onClick={onClose}>
            <div className="cb-attachment-viewer-inner" onClick={(e) => e.stopPropagation()}>
                <div className="cb-attachment-viewer-toolbar">
                    <span className="cb-attachment-viewer-filename">{attachment.name || 'Attachment'}</span>
                    <button
                        className="cb-attachment-viewer-close"
                        onClick={onClose}
                        title="Close (Esc)"
                        aria-label="Close attachment"
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </button>
                </div>

                {state === 'loading' && (
                    <div className="cb-attachment-viewer-loading">
                        <span className="cb-att-chip-spinner" aria-hidden />
                    </div>
                )}

                {state === 'error' && (
                    <div className="cb-attachment-viewer-error">
                        <div className="cb-attachment-viewer-error-icon">&#x26A0;</div>
                        <div className="cb-attachment-viewer-error-msg">{errorMsg}</div>
                        <div className="cb-attachment-viewer-actions">
                            <button className="cb-attachment-viewer-action-btn" onClick={onClose}>Close</button>
                        </div>
                    </div>
                )}

                {state === 'ready' && blobUrl && (
                    <div className="cb-attachment-viewer-content">

                        {ct.startsWith('image/') ? (
                            <img src={blobUrl} alt={attachment.name || 'Attachment'} />
                        ) : ct === 'application/pdf' ? (
                            <div className="cb-pdf-viewer">
                                <Document
                                    file={blobUrl}
                                    onLoadSuccess={({ numPages }) => {
                                        setPdfNumPages(numPages);
                                        setPdfPageNumber(1);
                                    }}
                                    loading={<div className="cb-attachment-viewer-loading"><span className="cb-att-chip-spinner" aria-hidden /></div>}
                                    error={<div className="cb-attachment-viewer-error-msg">Failed to load PDF.</div>}
                                >
                                    <Page pageNumber={pdfPageNumber} width={undefined} />
                                </Document>
                                {pdfNumPages != null && pdfNumPages > 1 && (
                                    <div className="cb-pdf-pagination">
                                        <button
                                            className="cb-attachment-viewer-action-btn"
                                            onClick={() => setPdfPageNumber(p => Math.max(1, p - 1))}
                                            disabled={pdfPageNumber <= 1}
                                        >&#8249;</button>
                                        <span>{pdfPageNumber} / {pdfNumPages}</span>
                                        <button
                                            className="cb-attachment-viewer-action-btn"
                                            onClick={() => setPdfPageNumber(p => Math.min(pdfNumPages, p + 1))}
                                            disabled={pdfPageNumber >= pdfNumPages}
                                        >&#8250;</button>
                                    </div>
                                )}
                            </div>
                        ) : (ct.startsWith('text/') || ct === 'text/csv') && textContent != null ? (
                            <pre>{textContent}</pre>
                        ) : (
                            <div className="cb-attachment-viewer-fallback">
                                <div className="cb-attachment-viewer-fallback-icon">{getFileIcon(ct)}</div>
                                <div className="cb-attachment-viewer-fallback-name">{attachment.name || 'File'}</div>
                                {attachment.size != null && (
                                    <div className="cb-attachment-viewer-fallback-size">{formatFileSize(attachment.size)}</div>
                                )}
                                <div className="cb-attachment-viewer-actions">
                                    <button className="cb-attachment-viewer-action-btn primary" onClick={handleDownload}>
                                        Download
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <a ref={downloadLinkRef} style={{ display: 'none' }} />
            </div>
        </div>,
        document.body
    );
};

// --- Attachment Chip (Claude-style compact chip above message) ---
const AttachmentChip: React.FC<{ att: Attachment }> = ({ att }) => {
    const [modalOpen, setModalOpen] = useState(false);

    const handleClick = () => {
        setModalOpen(true);
    };

    const inferredType = inferContentType(att.name, att.contentType);
    const isImage = inferredType.startsWith('image/');

    return (
        <>
            <div
                className="cb-att-chip"
                onClick={handleClick}
                title={att.name}
                role="button"
            >
                {isImage ? (
                    <div className="cb-att-chip-thumb">
                        {att.localUrl ? (
                            <img src={att.localUrl} alt={att.name || ''} />
                        ) : (
                            <AuthenticatedImage src={att.url} alt={att.name || ''} />
                        )}
                    </div>
                ) : (
                    <div className="cb-att-chip-icon">
                        {getFileIcon(inferredType)}
                    </div>
                )}
                <div className="cb-att-chip-info">
                    <span className="cb-att-chip-name">{att.name || 'File'}</span>
                    {att.size != null && (
                        <span className="cb-att-chip-size">{formatFileSize(att.size)}</span>
                    )}
                </div>
                <div className="cb-att-chip-action">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                    </svg>
                </div>
            </div>
            <AttachmentViewerModal
                attachment={att}
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
            />
        </>
    );
};

// --- Attachment List (row of chips above message content) ---
const AttachmentList: React.FC<{ attachments: Attachment[] }> = ({ attachments }) => (
    <div className="cb-att-list">
        {attachments.map(att => (
            <AttachmentChip key={att.id} att={att} />
        ))}
    </div>
);

export const MessageBubble: React.FC<MessageProps> = (props) => {
    const { role, steps, shouldAnimate = true } = props;

    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');

    const getStepsTextContent = (): string => {
        if (!steps || steps.length === 0) return props.content || '';
        const fromSteps = steps
            .filter(s => s.type === 'text')
            .map(s => s.content || '')
            .join('\n\n');
        return fromSteps || props.content || '';
    };

    const handleStartEdit = React.useCallback((content: string) => {
        setEditText(content);
        setIsEditing(true);
    }, []);

    const handleCancelEdit = useCallback(() => {
        setIsEditing(false);
        setEditText('');
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (editText.trim() && props.onEdit) {
            props.onEdit(props.id, editText.trim());
            setIsEditing(false);
            setEditText('');
        }
    }, [editText, props.onEdit, props.id]);

    const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSaveEdit();
        }
        if (e.key === 'Escape') {
            handleCancelEdit();
        }
    }, [handleSaveEdit, handleCancelEdit]);

    const handlePrevBranch = useCallback(() => {
        if (props.onSwitchBranch && props.branchIds && props.activeBranchIndex != null && props.activeBranchIndex > 0) {
            const parentId = props.parentMessageId;
            if (parentId) {
                props.onSwitchBranch(parentId, props.branchIds[props.activeBranchIndex - 1]);
            }
        }
    }, [props.onSwitchBranch, props.branchIds, props.activeBranchIndex, props.parentMessageId]);

    const handleNextBranch = useCallback(() => {
        if (props.onSwitchBranch && props.branchIds && props.activeBranchIndex != null && props.activeBranchIndex < (props.branchCount || 0) - 1) {
            const parentId = props.parentMessageId;
            if (parentId) {
                props.onSwitchBranch(parentId, props.branchIds[props.activeBranchIndex + 1]);
            }
        }
    }, [props.onSwitchBranch, props.branchIds, props.activeBranchIndex, props.branchCount, props.parentMessageId]);

    const bubbleRef = useRef<HTMLDivElement>(null);
    const [selectionPopup, setSelectionPopup] = useState<{ text: string; top: number; left: number } | null>(null);

    useEffect(() => {
        const handleMouseUp = () => {
            const selection = window.getSelection();
            if (!selection || !selection.toString().trim()) {
                setSelectionPopup(null);
                return;
            }
            const el = bubbleRef.current;
            if (!el || !selection.anchorNode || !el.contains(selection.anchorNode)) {
                return;
            }
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const bubbleRect = el.getBoundingClientRect();
            setSelectionPopup({
                text: selection.toString().trim(),
                top: rect.top - bubbleRect.top - 36,
                left: rect.left - bubbleRect.left + rect.width / 2,
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (selectionPopup && !(e.target as HTMLElement)?.closest?.('.cb-selection-reply-popup')) {
                setSelectionPopup(null);
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [selectionPopup]);

    // If steps are present, use steps rendering
    if (steps && steps.length > 0) {
        const textContent = getStepsTextContent();

        // Streamed tokens live on trailing ``'text'`` steps (see
        // useStreamChat.updateAssistantContent) and persisted text arrives as
        // ``'text'`` steps via ``mapSteps`` in useConversations.ts, so the
        // natural ``steps`` array is the source of truth for ordering. Render
        // it directly.
        const renderSteps: MessageStep[] = steps;

        // Collected at this level only. A nested bubble renders the steps of one
        // sub-agent and knows nothing of the turn, so letting it build its own
        // row would put the same control on screen once per nesting level.
        const hoistedActions = props.embedded
            ? []
            : collectHoistedActions(steps, props, props.isTurnComplete !== false);

        return (
            <div ref={bubbleRef} className={`cb-message-row ${role === 'user' ? 'cb-row-user' : 'cb-row-assistant'}`}>
                {role === 'assistant' && !props.embedded && (
                    <div className="cb-avatar-container">
                        <div className="cb-avatar-assistant">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.524-4.476 10-10 10S2 17.524 2 12 6.476 2 12 2z" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                        </div>
                    </div>
                )}

                <div className="cb-message-content-wrapper" style={{ width: '100%', position: 'relative' }}>
                    {role === 'user' || props.embedded ? null : <div className="cb-sender-name">{props.senderName || 'Assistant'}</div>}

                    {props.branchPoint && props.branchCount && props.branchCount > 1 && (
                        <BranchNavigator
                            branchCount={props.branchCount}
                            activeBranchIndex={props.activeBranchIndex ?? 0}
                            onPrevBranch={handlePrevBranch}
                            onNextBranch={handleNextBranch}
                        />
                    )}

                    {props.replyToContent && (
                        <div className="cb-reply-indicator">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="9 17 4 12 9 7" />
                                <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                            </svg>
                            <span className="cb-reply-indicator-text">
                                {props.replyToContent.length > 80
                                    ? props.replyToContent.slice(0, 80) + '...'
                                    : props.replyToContent}
                            </span>
                        </div>
                    )}

                    {role === 'user' && props.attachments && props.attachments.length > 0 && (
                        <AttachmentList attachments={props.attachments} />
                    )}

                    {isEditing && role === 'user' ? (
                        <div className="cb-edit-container">
                            <textarea
                                className="cb-edit-textarea"
                                value={editText}
                                onChange={(e) => setEditText(e.target.value)}
                                onKeyDown={handleEditKeyDown}
                                autoFocus
                                rows={3}
                            />
                            <div className="cb-edit-actions">
                                <button className="cb-edit-cancel" onClick={handleCancelEdit}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                    Cancel
                                </button>
                                <button className="cb-edit-save" onClick={handleSaveEdit} disabled={!editText.trim()}>
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                    Send
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="cb-steps-container">
                            {renderSteps.map((step, index) => {
                                const isLast = index === renderSteps.length - 1;

                                if (step.type === 'thinking') {
                                    return (
                                        <ThinkingBlock
                                            key={step.id}
                                            step={step}
                                        />
                                    );
                                }

                                if (step.type === 'tool-call') {
                                    // Which registry a slug is in decides the payload:
                                    // a client tool is replayed with its input, a
                                    // previewed server tool with its result. Resolved
                                    // by the same function the hoisted row uses, so the
                                    // two can never disagree about that.
                                    const resolved = resolveStepAction(step, props);
                                    // A control placed at turn level is deliberately
                                    // absent here — hoisting means moving it, not
                                    // showing it twice.
                                    const onStep = resolved?.placement === 'step'
                                        ? resolved
                                        : undefined;

                                    return (
                                        <div key={step.id} className="cb-step-tool">
                                            <ToolInvocation
                                                toolName={step.toolName || 'Tool'}
                                                args={step.toolArgs}
                                                status={step.toolStatus as any}
                                                result={step.toolResult}
                                                actionPayload={onStep?.payload}
                                                actionLabel={onStep?.label ?? 'Open Result'}
                                                onAction={onStep?.onAction}
                                                renderAction={onStep?.render}
                                            />
                                        </div>
                                    );
                                }

                                if (step.type === 'sub-agent') {
                                    return (
                                        <SubAgentBlock
                                            key={step.id}
                                            step={step}
                                            handlers={props}
                                        />
                                    );
                                }

                                if (step.type === 'confirm-request') {
                                    return (
                                        <div key={step.id} className="cb-step-confirm">
                                            <ConfirmButtons
                                                toolCallId={step.toolCallId || step.id}
                                                toolName={step.toolName || 'Tool'}
                                                label={step.confirmLabel || step.toolName || 'Confirm Action'}
                                                description={step.confirmDescription}
                                                status={step.confirmStatus || 'pending'}
                                                onConfirm={props.onConfirm || (() => { })}
                                                onReject={props.onReject || (() => { })}
                                            />
                                        </div>
                                    );
                                }

                                if (step.type === 'error') {
                                    return (
                                        <ErrorBlock
                                            key={step.id}
                                            step={step}
                                            onRetry={props.onRetry}
                                            onContinue={props.onContinue}
                                        />
                                    );
                                }

                                if (step.type === 'notice') {
                                    return (
                                        <div key={step.id} className="cb-step-notice" role="status">
                                            <span className="cb-notice-spinner" />
                                            <span>{step.content}</span>
                                        </div>
                                    );
                                }

                                if (step.type === 'text') {
                                    return (
                                        <div key={step.id} className={`cb-message-bubble ${role}`} dir="auto">
                                            <TypewriterText
                                                content={step.content || ''}
                                                shouldAnimate={shouldAnimate && isLast}
                                                onComplete={isLast ? props.onAnimationComplete : undefined}
                                            />
                                            {isLast && props.isWaitingForDeltas && (!step.content || step.content.trim().length === 0) && (
                                                <BlinkingIndicator />
                                            )}
                                        </div>
                                    );
                                }
                                return null;
                            })}
                        </div>
                    )}

                    {hoistedActions.length > 0 && (
                        <div className="cb-turn-action-row">
                            {hoistedActions.map(action => (
                                <ToolActionControl
                                    key={`hoisted-${action.step.id}`}
                                    onAction={action.onAction}
                                    payload={action.payload}
                                    toolName={action.step.toolName || 'Tool'}
                                    label={action.label}
                                    render={action.render}
                                />
                            ))}
                        </div>
                    )}

                    {textContent && !isEditing && (
                        <MessageActions
                            content={textContent}
                            role={role as 'user' | 'assistant'}
                            messageId={props.id}
                            onReply={props.onReply ? () => props.onReply!(props) : undefined}
                            onEdit={props.onEdit && role === 'user'
                                ? () => handleStartEdit(textContent)
                                : undefined}
                        />
                    )}
                </div>

                {selectionPopup && props.onReply && (
                    <div
                        className="cb-selection-reply-popup"
                        style={{ top: selectionPopup.top, left: selectionPopup.left }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            props.onReply!(props, selectionPopup.text);
                            setSelectionPopup(null);
                            window.getSelection()?.removeAllRanges();
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 17 4 12 9 7" />
                            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                        Reply
                    </div>
                )}
            </div>
        );
    }

    // --- LEGACY RENDER PATH (simple content) ---
    return <LegacyMessageBubble {...props} />;
};

// Collapsible Thinking Block
/**
 * One agent's run, rendered inside the turn of the agent that started it.
 *
 * Collapsed by default and labelled with the agent's name: the user addressed
 * one agent, and a specialist's tool calls are working, not conversation. The
 * header stays visible either way so it is never a surprise that another agent
 * was involved.
 */
/** Everything needed to render one step's action control, or nothing. */
interface ResolvedStepAction {
    step: MessageStep;
    onAction: (data: any) => void;
    payload: any;
    label: string;
    render?: ToolActionConfig['render'];
    placement: ToolActionPlacement;
}

/**
 * Work out whether a ``tool-call`` step offers an action, and with what.
 *
 * One function for both placements. The payload choice is the reason it has to
 * be shared: a client tool is re-fired with its **arguments**, a previewed
 * server tool with its **result**, and a hoisted control that guessed
 * differently from the step-level one would hand the host app the wrong half of
 * the same call.
 */
function resolveStepAction(
    step: MessageStep,
    handlers: Pick<MessageProps, 'onToolCall' | 'onToolPreview' | 'toolActions'>,
): ResolvedStepAction | null {
    if (step.type !== 'tool-call' || !step.toolName) return null;

    const config = handlers.toolActions?.[step.toolName];
    if (config?.show === false) return null;

    const previewHandler = handlers.onToolPreview?.[step.toolName];
    const clientHandler = handlers.onToolCall?.[step.toolName];

    let onAction: ((data: any) => void) | undefined;
    let rawPayload: any;
    let label = 'Open Result';
    if (previewHandler) {
        onAction = (data) => { void previewHandler(data, { step_uuid: step.id }); };
        rawPayload = step.toolResult;
        label = 'Open Preview';
    } else if (clientHandler) {
        onAction = (data) => { void clientHandler(data); };
        rawPayload = step.toolArgs;
    }
    if (!onAction) return null;

    // Parsed here, once, for both placements. A tool's `execute` returns a
    // *string*, so `tool_output` reaches the browser as JSON text — the handler
    // expects the object. ToolInvocation had always parsed it on the step-level
    // path; the hoisted row did not, so a control moved to turn level handed the
    // host app a 30KB string and every field it read came back undefined.
    // parseToolOutput is a no-op on anything already decoded, so parsing here
    // and again downstream is harmless.
    const payload = parseToolOutput(rawPayload);

    return {
        step,
        onAction,
        payload,
        label: config?.label ?? label,
        render: config?.render,
        placement: config?.placement ?? 'step',
    };
}

/**
 * Every completed action in this turn that asked to be hoisted, in depth-first
 * order.
 *
 * Recurses into sub-agent blocks, which is the whole point: a tool a sub-agent
 * called renders inside a block that is collapsed by default, so its control is
 * unreachable where it sits. Collecting here and rendering at turn level is what
 * puts it in front of the user.
 */
function collectHoistedActions(
    steps: MessageStep[],
    handlers: Pick<MessageProps, 'onToolCall' | 'onToolPreview' | 'toolActions'>,
    isTurnComplete: boolean,
): ResolvedStepAction[] {
    const found: ResolvedStepAction[] = [];
    for (const step of steps) {
        if (step.subSteps && step.subSteps.length > 0) {
            found.push(...collectHoistedActions(step.subSteps, handlers, isTurnComplete));
        }
        if (step.toolStatus !== 'completed') continue;
        const resolved = resolveStepAction(step, handlers);
        if (!resolved || resolved.placement === 'step') continue;
        if (resolved.placement === 'turn-end' && !isTurnComplete) continue;
        found.push(resolved);
    }
    return found;
}

const SubAgentBlock = ({
    step,
    handlers,
}: {
    step: MessageStep;
    handlers: Pick<MessageProps, 'onToolCall' | 'onToolPreview' | 'toolActions'>;
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const isRunning = step.toolStatus === 'running';
    const failed = step.toolStatus === 'failed';
    const subSteps = step.subSteps ?? [];
    const subStepCount = subSteps.length;

    const state = isRunning ? 'running' : failed ? 'failed' : 'completed';

    // What the sub-agent actually did, for the collapsed header.
    //
    // A delegated agent is not answering the user — the agent that delegated to
    // it is — so surfacing its prose here would put a second voice in the
    // transcript and read as the reply. Naming the tools it ran says what
    // happened without pretending to be the answer, and its own words stay
    // inside the disclosure for anyone who wants them.
    const toolsUsed = React.useMemo(() => {
        const names = new Set<string>();
        const walk = (list: MessageStep[]) => {
            for (const child of list) {
                if (child.type === 'tool-call' && child.toolName) names.add(child.toolName);
                if (child.subSteps) walk(child.subSteps);
            }
        };
        walk(step.subSteps ?? []);
        return [...names];
    }, [step.subSteps]);

    const summary = toolsUsed.length > 0
        ? toolsUsed.join(', ')
        : `${subStepCount} step${subStepCount === 1 ? '' : 's'}`;
    // Anything to reveal at all — steps, or the agent's own account of its work.
    const hasDetail = subStepCount > 0 || Boolean(step.content);

    return (
        <div className={`cb-step-sub-agent is-${state}`}>
            <button
                type="button"
                className="cb-sub-agent-header"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {isRunning ? (
                    <span className="cb-sub-agent-spinner" />
                ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a10 10 0 0 1 10 10c0 5.524-4.476 10-10 10S2 17.524 2 12 6.476 2 12 2z" />
                        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
                    </svg>
                )}

                <span className="cb-sub-agent-name">
                    {step.agentName || 'Sub-agent'}
                    {failed ? ' — failed' : ''}
                    {!isRunning && !failed && (
                        <span className="cb-sub-agent-summary"> · {summary}</span>
                    )}
                </span>

                {hasDetail && (
                    <span className="cb-sub-agent-count">
                        {isOpen ? 'Hide' : 'Show'}
                    </span>
                )}
            </button>

            {isOpen && (subSteps.length > 0 || step.content) && (
                <div className="cb-sub-agent-body">
                    <MessageBubble
                        id={`${step.id}-inner`}
                        role="assistant"
                        steps={subSteps}
                        shouldAnimate={false}
                        embedded
                        // Forwarded so a nested step can render its own control
                        // when its placement is `'step'`. Without these a tool a
                        // sub-agent called had no button at all, at any depth.
                        onToolCall={handlers.onToolCall}
                        onToolPreview={handlers.onToolPreview}
                        toolActions={handlers.toolActions}
                    />

                    {step.content && (
                        <div className="cb-sub-agent-result">
                            <TypewriterText content={step.content} shouldAnimate={false} />
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * A failure the user can do something about.
 *
 * Deliberately a block with a button rather than a sentence appended to the
 * answer: an error in the middle of streamed prose reads as part of the answer,
 * and gives the user nothing to press. Which button appears is decided by the
 * step, not here — only the caller knows whether the turn produced anything.
 */
const ErrorBlock = ({
    step,
    onRetry,
    onContinue,
}: {
    step: MessageStep;
    onRetry?: () => void;
    onContinue?: () => void;
}) => {
    const action = step.recovery === 'continue'
        ? { label: 'Continue', handler: onContinue }
        : step.recovery === 'retry'
            ? { label: 'Retry', handler: onRetry }
            : null;

    return (
        <div className="cb-step-error" role="alert">
            <div className="cb-error-body">
                <svg
                    className="cb-error-icon"
                    width="16" height="16" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" strokeWidth="2"
                    aria-hidden="true"
                >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span className="cb-error-text">{step.content}</span>
            </div>
            {action?.handler && (
                <button
                    type="button"
                    className="cb-error-action"
                    onClick={action.handler}
                >
                    {action.label}
                </button>
            )}
        </div>
    );
};

const ThinkingBlock = ({ step }: { step: MessageStep }) => {
    const [isOpen, setIsOpen] = useState(false);
    const isFinished = step.isFinished;
    const hasContent = step.content && step.content.trim().length > 0;

    return (
        <div className={`cb-step-thinking-block ${isFinished ? 'is-finished' : 'is-running'}`}>
            <button
                type="button"
                className="cb-thinking-header"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                {isFinished ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
                ) : (
                    <span className="cb-sub-agent-spinner" />
                )}

                <span className="cb-sub-agent-name">Thinking</span>

                {hasContent && (
                    <span className="cb-sub-agent-count">
                        {isOpen ? 'Hide' : 'Show'} content
                    </span>
                )}

                <svg
                    width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={isOpen ? 'cb-chevron cb-chevron-open' : 'cb-chevron'}
                >
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>

            {isOpen && hasContent && (
                <div className="cb-thinking-content">
                    <pre className="cb-thinking-text">{step.content}</pre>
                </div>
            )}
        </div>
    );
};

// Typewriter with DUAL-TIMER strategy for background resilience
const TypewriterText = ({ content, shouldAnimate, onComplete }: { content: string, shouldAnimate: boolean, onComplete?: () => void }) => {
    const [displayContent, setDisplayContent] = useState(shouldAnimate ? '' : content);
    const hasFiredCompleteRef = useRef(false);

    useEffect(() => {
        // Reset for new content
        hasFiredCompleteRef.current = false;

        if (!shouldAnimate || !content) {
            setDisplayContent(content);
            if (!hasFiredCompleteRef.current) {
                hasFiredCompleteRef.current = true;
                onComplete?.();
            }
            return;
        }

        let animationFrameId: number;
        let timeoutId: any;
        const startTime = Date.now();
        const speed = 15; // ms per char
        const duration = content.length * speed;

        // 1. VISUAL TIMER (requestAnimationFrame) - Smooth, but pauses in background
        const animate = () => {
            const now = Date.now();
            const elapsed = now - startTime;
            const charsToShow = Math.floor(elapsed / speed);

            if (charsToShow < content.length) {
                setDisplayContent(content.substring(0, charsToShow + 1));
                animationFrameId = requestAnimationFrame(animate);
            } else {
                setDisplayContent(content);
                if (!hasFiredCompleteRef.current) {
                    hasFiredCompleteRef.current = true;
                    onComplete?.();
                }
            }
        };

        animationFrameId = requestAnimationFrame(animate);

        // 2. LOGICAL TIMER (setTimeout) - Throttled in background, but GUARANTEED to run
        timeoutId = setTimeout(() => {
            if (!hasFiredCompleteRef.current) {
                setDisplayContent(content);
                hasFiredCompleteRef.current = true;
                onComplete?.();
            }
        }, duration + 100);

        return () => {
            cancelAnimationFrame(animationFrameId);
            clearTimeout(timeoutId);
        };
    }, [content, shouldAnimate]);

    return (
        // dir="auto" is what makes a mixed-language thread work: the browser
        // resolves each block's direction from its own first strong character,
        // so an Arabic answer reads right-to-left and an English one beside it
        // still reads left-to-right. Set here rather than on the bubble because
        // this is the element that actually contains the text, in every render
        // path — and a per-thread or per-app setting would get one of the two
        // languages wrong.
        <div className="cb-markdown-content" dir="auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent}
            </ReactMarkdown>
            {shouldAnimate && content && displayContent.length < content.length && (
                <span className="cb-cursor">|</span>
            )}
        </div>
    );
};

// Legacy path for simple content without steps
const LegacyMessageBubble: React.FC<MessageProps> = (props) => {
    const { role, content, attachments, toolInvocation, shouldAnimate = true } = props;

    const [displayContent, setDisplayContent] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState('');
    const hasFiredCompleteRef = useRef(false);
    const legacyBubbleRef = useRef<HTMLDivElement>(null);
    const [selectionPopup, setSelectionPopup] = useState<{ text: string; top: number; left: number } | null>(null);

    useEffect(() => {
        const handleMouseUp = () => {
            const selection = window.getSelection();
            if (!selection || !selection.toString().trim()) {
                setSelectionPopup(null);
                return;
            }
            const el = legacyBubbleRef.current;
            if (!el || !selection.anchorNode || !el.contains(selection.anchorNode)) {
                return;
            }
            const range = selection.getRangeAt(0);
            const rect = range.getBoundingClientRect();
            const bubbleRect = el.getBoundingClientRect();
            setSelectionPopup({
                text: selection.toString().trim(),
                top: rect.top - bubbleRect.top - 36,
                left: rect.left - bubbleRect.left + rect.width / 2,
            });
        };

        const handleMouseDown = (e: MouseEvent) => {
            if (selectionPopup && !(e.target as HTMLElement)?.closest?.('.cb-selection-reply-popup')) {
                setSelectionPopup(null);
            }
        };

        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('mousedown', handleMouseDown);
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mousedown', handleMouseDown);
        };
    }, [selectionPopup]);

    useEffect(() => {
        hasFiredCompleteRef.current = false;

        if (role !== 'assistant' || !content || !shouldAnimate) {
            setDisplayContent(content || '');
            if (!hasFiredCompleteRef.current) {
                hasFiredCompleteRef.current = true;
                props.onAnimationComplete?.();
            }
            return;
        }

        let animationFrameId: number;
        let timeoutId: any;
        const startTime = Date.now();
        const speed = 15;
        const duration = content.length * speed;

        const animate = () => {
            const now = Date.now();
            const elapsed = now - startTime;
            const charsToShow = Math.floor(elapsed / speed);

            if (charsToShow < content.length) {
                setDisplayContent(content.substring(0, charsToShow + 1));
                animationFrameId = requestAnimationFrame(animate);
            } else {
                setDisplayContent(content);
                if (!hasFiredCompleteRef.current) {
                    hasFiredCompleteRef.current = true;
                    props.onAnimationComplete?.();
                }
            }
        };

        animationFrameId = requestAnimationFrame(animate);

        timeoutId = setTimeout(() => {
            if (!hasFiredCompleteRef.current) {
                setDisplayContent(content);
                hasFiredCompleteRef.current = true;
                props.onAnimationComplete?.();
            }
        }, duration + 100);

        return () => {
            cancelAnimationFrame(animationFrameId);
            clearTimeout(timeoutId);
        };
    }, [content, role, shouldAnimate]);

    const handleStartEdit = useCallback(() => {
        setEditText(content || '');
        setIsEditing(true);
    }, [content]);

    const handleCancelEdit = useCallback(() => {
        setIsEditing(false);
        setEditText('');
    }, []);

    const handleSaveEdit = useCallback(() => {
        if (editText.trim() && props.onEdit) {
            props.onEdit(props.id, editText.trim());
            setIsEditing(false);
            setEditText('');
        }
    }, [editText, props.onEdit, props.id]);

    const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSaveEdit();
        }
        if (e.key === 'Escape') {
            handleCancelEdit();
        }
    }, [handleSaveEdit, handleCancelEdit]);

    const handlePrevBranch = useCallback(() => {
        if (props.onSwitchBranch && props.branchIds && props.activeBranchIndex != null && props.activeBranchIndex > 0) {
            const parentId = props.parentMessageId;
            if (parentId) {
                props.onSwitchBranch(parentId, props.branchIds[props.activeBranchIndex - 1]);
            }
        }
    }, [props.onSwitchBranch, props.branchIds, props.activeBranchIndex, props.parentMessageId]);

    const handleNextBranch = useCallback(() => {
        if (props.onSwitchBranch && props.branchIds && props.activeBranchIndex != null && props.activeBranchIndex < (props.branchCount || 0) - 1) {
            const parentId = props.parentMessageId;
            if (parentId) {
                props.onSwitchBranch(parentId, props.branchIds[props.activeBranchIndex + 1]);
            }
        }
    }, [props.onSwitchBranch, props.branchIds, props.activeBranchIndex, props.branchCount, props.parentMessageId]);

    if (toolInvocation) {
        return (
            <div className="cb-message-row cb-row-assistant" style={{ marginBottom: '8px' }}>
                <div className="cb-avatar-container">
                    <div className="cb-avatar-assistant cb-avatar-muted">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></svg>
                    </div>
                </div>
                <div className="cb-message-content-wrapper">
                    <ToolInvocation
                        toolName={toolInvocation.toolName}
                        args={toolInvocation.args}
                        status={toolInvocation.status}
                        result={toolInvocation.result}
                    />
                </div>
            </div>
        );
    }

    return (
        <div ref={legacyBubbleRef} className={`cb-message-row ${role === 'user' ? 'cb-row-user' : 'cb-row-assistant'}`}>
            {role === 'assistant' && (
                <div className="cb-avatar-container">
                    <div className="cb-avatar-assistant">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.524-4.476 10-10 10S2 17.524 2 12 6.476 2 12 2z" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                    </div>
                </div>
            )}

            <div className="cb-message-content-wrapper" style={{ position: 'relative' }}>
                {role === 'user' ? null : <div className="cb-sender-name">{props.senderName || 'Assistant'}</div>}

                {props.branchPoint && props.branchCount && props.branchCount > 1 && (
                    <BranchNavigator
                        branchCount={props.branchCount}
                        activeBranchIndex={props.activeBranchIndex ?? 0}
                        onPrevBranch={handlePrevBranch}
                        onNextBranch={handleNextBranch}
                    />
                )}

                {props.replyToContent && (
                    <div className="cb-reply-indicator">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="9 17 4 12 9 7" />
                            <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                        </svg>
                        <span className="cb-reply-indicator-text">
                            {props.replyToContent.length > 80
                                ? props.replyToContent.slice(0, 80) + '...'
                                : props.replyToContent}
                        </span>
                    </div>
                )}

                {attachments && attachments.length > 0 && (
                    <AttachmentList attachments={attachments} />
                )}

                {isEditing && role === 'user' ? (
                    <div className="cb-edit-container">
                        <textarea
                            className="cb-edit-textarea"
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            onKeyDown={handleEditKeyDown}
                            autoFocus
                            rows={3}
                        />
                        <div className="cb-edit-actions">
                            <button className="cb-edit-cancel" onClick={handleCancelEdit}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                                Cancel
                            </button>
                            <button className="cb-edit-save" onClick={handleSaveEdit} disabled={!editText.trim()}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                                Send
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className={`cb-message-bubble ${role}`}>
                <div className="cb-markdown-content" dir="auto">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                {displayContent}
                            </ReactMarkdown>
                            {/* {role === 'assistant' && shouldAnimate && content && displayContent.length < content.length && (
                                <span className="cb-cursor">|</span>
                            )} */}
                            {role === 'assistant' && props.isWaitingForDeltas && (!content || content.trim().length === 0) && (
                                <BlinkingIndicator />
                            )}
                        </div>
                    </div>
                )}

                {content && !isEditing && (
                    <MessageActions
                        content={content}
                        role={role as 'user' | 'assistant'}
                        messageId={props.id}
                        onReply={props.onReply ? () => props.onReply!(props) : undefined}
                        onEdit={props.onEdit && role === 'user'
                            ? handleStartEdit
                            : undefined}
                    />
                )}
            </div>

            {selectionPopup && props.onReply && (
                <div
                    className="cb-selection-reply-popup"
                    style={{ top: selectionPopup.top, left: selectionPopup.left }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                        e.stopPropagation();
                        props.onReply!(props, selectionPopup.text);
                        setSelectionPopup(null);
                        window.getSelection()?.removeAllRanges();
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 17 4 12 9 7" />
                        <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                    </svg>
                    Reply
                </div>
            )}
        </div>
    );
};
