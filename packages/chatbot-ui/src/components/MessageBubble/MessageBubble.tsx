import React from 'react';
const { useState, useEffect, useRef, useCallback } = React;
import './MessageBubble.css';
import { parseToolOutput } from '../../api/toolOutput';
import { ToolInvocation, ToolActionControl } from '../ToolInvocation/ToolInvocation';
import { hasHostDisplayName, resolveToolDisplayName, type ToolActionPlacement, type ToolConfig, type ToolPresentation } from '../../common/toolConfig';
import { describeMetaTool, isMetaTool } from '../../common/metaTools';
import { describeLatestActivity, groupActivity, isStepRunning, summarizeActivity, type ActivityLine } from '../../common/activity';
import { ConfirmButtons, ConfirmStatus } from '../ConfirmButtons/ConfirmButtons';
import type { ContextFigures, RunUsage, TreeFigures, UsageFigures } from '../../api/types';
import { AuthenticatedImage } from '../AuthenticatedImage/AuthenticatedImage';
import { BlinkingIndicator } from '../BlinkingIndicator/BlinkingIndicator';
import { MessageActions } from '../MessageActions/MessageActions';
import { BranchNavigator } from '../BranchNavigator/BranchNavigator';
import { useLabels, useMarkdownConfig } from '../../store/hooks';
import type { ChatLabels } from '../../common/labels';
import { toPlainText } from '../../common/markdownBlocks';
import { MarkdownContent } from '../MarkdownContent/MarkdownContent';
import {
    AttachmentViewerModal,
    formatFileSize,
    getFileIcon,
    inferContentType,
    type Attachment,
} from '../AttachmentViewer/AttachmentViewer';

// The attachment shape and its viewer live in ../AttachmentViewer since 4.1,
// shared with the conversation files panel; re-exported here, where the
// package has always exported `Attachment` from.
export type { Attachment } from '../AttachmentViewer/AttachmentViewer';

export type MessageStepType = 'text' | 'thinking' | 'tool-call' | 'confirm-request' | 'sub-agent' | 'error' | 'notice';

export interface MessageStep {
    id: string;
    type: MessageStepType;
    content?: string;
    toolName?: string;
    toolSlug?: string;
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
    /**
     * The job (turn) this message belongs to — the turn a host saves a file or
     * an artifact against. From the job's uuid on a history load, and from the
     * stream's first frame on a live turn; absent until then. A rich block
     * receives it as `jobUuid`.
     */
    jobUuid?: string | null;
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
     * Who produced this message. Defaults to `labels.assistantName`. A
     * conversation can change hands (a handoff), so the label is per message
     * rather than a constant.
     */
    senderName?: string;
    /**
     * Per-tool handlers and presentation, keyed by tool slug.
     *
     * A matching ``tool-call`` step renders an action control that re-fires the
     * entry's handler. Which handler the entry carries decides the payload: a
     * ``run`` entry is replayed with the step's **arguments**, what a
     * ``dispatch_mode='client'`` tool acts on; a ``preview`` entry with the
     * step's **result**, what a ``kafka``/``inline`` tool produced.
     *
     * Having a handler is what makes an action possible; the entry's
     * presentation fields decide whether it is offered and what it looks like.
     * A slug with no entry gets no control.
     */
    tools?: Record<string, ToolConfig>;
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
    /**
     * What this turn has cost so far and where its prompt sits against the
     * model's window. Set from the ``usage`` stream event while the run is live
     * and from the job's totals when a thread is loaded from history. Not
     * rendered on the bubble: the composer's consumption indicator reads it
     * off the messages (``common/usageSummary.ts``). Absent on user messages.
     */
    usage?: UsageFigures | null;
    context?: ContextFigures | null;
    tree?: TreeFigures | null;
    /**
     * The sub-agents this turn started, keyed by their job uuid, each with its
     * own run meter. A turn that delegated costs the root run *plus* these:
     * showing the root run alone read "3 credits" on a turn whose tree had
     * spent 22 (2026-09-05). Filled by the sub-agents' own ``usage`` events
     * live, and from the nested ``sub_agent_jobs`` on a history load.
     */
    subAgentRuns?: Record<string, RunUsage>;
    /** The orchestrator reported the prompt at 90% or more of the window. */
    contextPressure?: boolean;
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

/**
 * What the bubble is given from inside the library, beyond the public props.
 * A nested bubble — one sub-agent's steps — knows its own run's state from
 * `isTurnComplete`; this says whether the turn around it is still in flight,
 * which outlives the sub-agent's run.
 */
interface MessageBubbleViewProps extends MessageProps {
    enclosingTurnInFlight?: boolean;
}

/**
 * The turn this bubble's steps belong to is still in flight: this bubble's
 * own run, or — for a nested bubble — the turn that contains it. What a rich
 * block is told as `streaming`: a reference to one of the turn's steps may not
 * have a result yet.
 */
function isTurnInFlight(props: MessageBubbleViewProps): boolean {
    return props.isTurnComplete === false || Boolean(props.enclosingTurnInFlight);
}

const MessageBubbleView: React.FC<MessageBubbleViewProps> = (props) => {
    const { role, steps, shouldAnimate = true } = props;
    const labels = useLabels();
    const { blockRenderers } = useMarkdownConfig();
    // Rich blocks are how the assistant presents an answer. A user's message
    // stays as they wrote it — a fence they pasted is code, and "Copy" gives
    // their own text back (design §3.4; review of 2026-10-14).
    const drawsBlocks = role === 'assistant';
    const turnInFlight = isTurnInFlight(props);

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

    // The whole message's text, for a rich block that exports its siblings (a
    // report). One stable reader per bubble, so the blocks — memoised on their
    // props — are not re-rendered by text that streams in after them.
    const messageTextRef = useRef('');
    messageTextRef.current = getStepsTextContent();
    const getMessageSource = useCallback(() => messageTextRef.current, []);

    // If steps are present, use steps rendering
    if (steps && steps.length > 0) {
        const textContent = messageTextRef.current;

        // Streamed tokens live on trailing ``'text'`` steps (see
        // useStreamChat.updateAssistantContent) and persisted text arrives as
        // ``'text'`` steps via ``mapSteps`` in useConversations.ts, so the
        // natural ``steps`` array is the source of truth for ordering.
        // Every step is shown, a repeated call and a sub-agent's earlier attempt
        // included. Until 4.0 a `showLastOnly` option (on by default for one
        // slug) hid all but the last call of a tool, and with it whole sub-agent
        // runs — the work, and what it cost, vanished from the transcript. Each
        // action is bound to its own step_uuid, so several cannot be confused.
        //
        // Runs of thinking, tool calls and sub-agents are drawn as one activity
        // section each (common/activity.ts): the working between two pieces of
        // the answer is one row, not one row per step.
        const groupedRenderItems = groupActivity(steps);

        // Collected at this level only. A nested bubble renders the steps of one
        // sub-agent and knows nothing of the turn, so letting it build its own
        // row would put the same control on screen once per nesting level.
        const hoistedActions = props.embedded
            ? []
            : collectHoistedActions(steps, props, props.isTurnComplete !== false, labels);

        return (
            <div
                ref={bubbleRef}
                className={`cb-message-row ${role === 'user' ? 'cb-row-user' : 'cb-row-assistant'}`}
                // What the files panel's "Show in chat" falls back to for a
                // block not drawn (in a collapsed sub-agent run).
                data-message-id={props.embedded ? undefined : props.id}
            >
                {role === 'assistant' && !props.embedded && (
                    <div className="cb-avatar-container">
                        <div className="cb-avatar-assistant">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.524-4.476 10-10 10S2 17.524 2 12 6.476 2 12 2z" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                        </div>
                    </div>
                )}

                <div className="cb-message-content-wrapper" style={{ width: '100%', position: 'relative' }}>
                    {role === 'user' || props.embedded ? null : <div className="cb-sender-name">{props.senderName || labels.assistantName}</div>}

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
                            {groupedRenderItems.map((item, itemIndex) => {
                                if (item.type === 'activity') {
                                    // Live while a step in it runs, or while it is
                                    // the turn's latest item and the turn goes on.
                                    const live = item.steps.some(isStepRunning)
                                        || (props.isTurnComplete === false && itemIndex === groupedRenderItems.length - 1);
                                    return (
                                        <ActivityGroup
                                            key={`activity-${item.steps[0].id}`}
                                            steps={item.steps}
                                            props={props}
                                            live={live}
                                        />
                                    );
                                }

                                const isLast = item.index === steps.length - 1;
                                const step = item.step;

                                if (step.type === 'thinking') {
                                    return (
                                        <ThinkingBlock
                                            key={step.id}
                                            step={step}
                                        />
                                    );
                                }

                                if (step.type === 'tool-call') {
                                    return (
                                        <ModernToolCallRow
                                            key={step.id}
                                            step={step}
                                            props={props}
                                        />
                                    );
                                }

                                if (step.type === 'sub-agent') {
                                    return (
                                        <SubAgentBlock
                                            key={step.id}
                                            step={step}
                                            handlers={props}
                                            jobUuid={props.jobUuid ?? null}
                                            turnInFlight={turnInFlight}
                                        />
                                    );
                                }

                                if (step.type === 'confirm-request') {
                                    return (
                                        <div key={step.id} className="cb-step-confirm">
                                            {(() => {
                                                const toolSlug = step.toolSlug || step.toolName || 'Tool';
                                                const displayName = resolveToolDisplayName(step.toolName || toolSlug, props.tools);
                                                return (
                                                    <ConfirmButtons
                                                        toolCallId={step.toolCallId || step.id}
                                                        toolName={displayName}
                                                        label={step.confirmLabel || displayName || 'Confirm Action'}
                                                        description={step.confirmDescription}
                                                        status={step.confirmStatus || 'pending'}
                                                        onConfirm={props.onConfirm || (() => { })}
                                                        onReject={props.onReject || (() => { })}
                                                    />
                                                );
                                            })()}
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
                                                // Only the last text of a live run can still be
                                                // arriving; every earlier one ended when a step
                                                // came after it. A nested bubble's run is its
                                                // sub-agent's: `isTurnComplete` is `!isRunning`.
                                                streaming={props.isTurnComplete === false && isLast}
                                                turnInFlight={turnInFlight}
                                                messageId={props.id}
                                                jobUuid={props.jobUuid ?? null}
                                                getMessageSource={getMessageSource}
                                                blocks={drawsBlocks}
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
                                    result={action.result}
                                    toolName={resolveToolDisplayName(action.step.toolName || action.step.toolSlug || 'Tool', props.tools)}
                                    label={action.label}
                                    render={action.render}
                                />
                            ))}
                        </div>
                    )}

                    {textContent && !isEditing && (
                        <MessageActions
                            // A copied answer reads as text: each host-drawn
                            // block becomes its plain-text summary, not its JSON.
                            // A user's message drew no blocks, and copies as written.
                            content={drawsBlocks ? toPlainText(textContent, blockRenderers) : textContent}
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

/**
 * Memoised: a streamed token changes only the last message, so in a long
 * thread every earlier bubble — handed the same props — skips re-rendering.
 */
const MemoMessageBubble = React.memo(MessageBubbleView);

/** Typed with the public props only: `enclosingTurnInFlight` is the library's own. */
export const MessageBubble: React.NamedExoticComponent<MessageProps> = MemoMessageBubble;

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
    /** The step's parsed result, so a control can offer what the call did. */
    result: any;
    label: string;
    render?: ToolPresentation['render'];
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
type ActionLabels = Pick<ChatLabels, 'openResult' | 'openPreview'>;

function resolveStepAction(
    step: MessageStep,
    handlers: Pick<MessageProps, 'tools'>,
    labels: ActionLabels,
): ResolvedStepAction | null {
    if (step.type !== 'tool-call') return null;
    const toolSlug = step.toolSlug || step.toolName;
    if (!toolSlug) return null;

    const config = handlers.tools?.[toolSlug] || (step.toolName ? handlers.tools?.[step.toolName] : undefined);
    if (!config || config.show === false) return null;

    // Which half of the union the entry is decides the payload, and an entry can
    // only be one of them — so unlike the three maps this replaced, there is no
    // precedence rule here for a slug to fall on the wrong side of.
    //
    // Tested by truthiness rather than `'preview' in config`: the opposite
    // variant declares the key as `?: never`, so `in` narrows nothing. See
    // isClientTool in common/toolConfig.
    const resolvedSlug = step.toolSlug || toolSlug;
    let onAction: ((data: any) => void) | undefined;
    let rawPayload: any;
    let label = labels.openResult;
    if (config.preview) {
        const preview = config.preview;
        onAction = (data) => {
            void preview(data, { tool_slug: resolvedSlug, step_uuid: step.id, status: 'completed' });
        };
        rawPayload = step.toolResult;
        label = labels.openPreview;
    } else if (config.run) {
        const run = config.run;
        onAction = (data) => {
            void run(data, { tool_slug: resolvedSlug, step_uuid: step.id });
        };
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
        result: parseToolOutput(step.toolResult),
        label: config.label ?? label,
        render: config.render,
        placement: config.placement ?? 'step',
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
    handlers: Pick<MessageProps, 'tools'>,
    isTurnComplete: boolean,
    labels: ActionLabels,
): ResolvedStepAction[] {
    const found: ResolvedStepAction[] = [];

    function collect(list: MessageStep[]) {
        for (const step of list) {
            if (step.subSteps && step.subSteps.length > 0) {
                collect(step.subSteps);
            }
            if (step.toolStatus !== 'completed') continue;
            const resolved = resolveStepAction(step, handlers, labels);
            if (!resolved || resolved.placement === 'step') continue;
            if (resolved.placement === 'turn-end' && !isTurnComplete) continue;

            found.push(resolved);
        }
    }

    collect(steps);
    return found;
}

const SubAgentBlock = ({
    step,
    handlers,
    jobUuid = null,
    turnInFlight = false,
}: {
    step: MessageStep;
    handlers: Pick<MessageProps, 'tools'>;
    /** The turn's job, for the blocks in the sub-agent's answer. */
    jobUuid?: string | null;
    /**
     * The turn that started the sub-agent is still in flight. It outlives
     * the sub-agent's own run, and a block in its answer is told so.
     */
    turnInFlight?: boolean;
}) => {
    const labels = useLabels();
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
                if (child.type === 'tool-call') {
                    const slug = child.toolSlug || child.toolName;
                    if (slug) {
                        names.add(resolveToolDisplayName(child.toolName || slug, handlers.tools));
                    }
                }
                if (child.subSteps) walk(child.subSteps);
            }
        };
        walk(step.subSteps ?? []);
        return [...names];
    }, [step.subSteps, handlers.tools]);

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
                        {isOpen ? labels.hide : labels.show}
                    </span>
                )}
            </button>

            {isOpen && (subSteps.length > 0 || step.content) && (
                <div className="cb-sub-agent-body">
                    <MemoMessageBubble
                        id={`${step.id}-inner`}
                        role="assistant"
                        steps={subSteps}
                        shouldAnimate={false}
                        jobUuid={jobUuid}
                        embedded
                        // The nested bubble's run is the sub-agent's: while it
                        // runs, its last text may still be arriving, and a fence
                        // in it is a skeleton until it closes. Without this the
                        // bubble took its run for finished and handed the host
                        // every prefix of a streaming spec, remounting the block
                        // per token (review of 2026-10-14).
                        isTurnComplete={!isRunning}
                        enclosingTurnInFlight={turnInFlight}
                        // Forwarded so a nested step can render its own control
                        // when its placement is `'step'`. Without this a tool a
                        // sub-agent called had no button at all, at any depth.
                        tools={handlers.tools}
                    />

                    {step.content && (
                        <div className="cb-sub-agent-result">
                            <TypewriterText
                                content={step.content}
                                shouldAnimate={false}
                                streaming={isRunning}
                                turnInFlight={isRunning || turnInFlight}
                                messageId={`${step.id}-result`}
                                jobUuid={jobUuid}
                            />
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
    const labels = useLabels();
    const action = step.recovery === 'continue'
        ? { label: labels.continue, handler: onContinue }
        : step.recovery === 'retry'
            ? { label: labels.retry, handler: onRetry }
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

interface ModernToolCallRowProps {
    step: MessageStep;
    props: MessageProps;
    defaultExpanded?: boolean;
}

const ModernToolCallRow: React.FC<ModernToolCallRowProps> = ({ step, props, defaultExpanded = false }) => {
    const labels = useLabels();
    const [expanded, setExpanded] = useState(defaultExpanded);
    const resolved = resolveStepAction(step, props, labels);
    const onStep = resolved?.placement === 'step' ? resolved : undefined;
    const isRunning = step.toolStatus === 'running';
    const isFailed = step.toolStatus === 'failed';
    const toolSlug = step.toolSlug || step.toolName || 'command';
    const toolName = resolveToolDisplayName(step.toolName || toolSlug, props.tools);
    // A meta-tool step reads as what it did ("Loaded skill · …") rather than
    // "Ran Load skill" — see common/metaTools.ts. Not when the host named the
    // tool itself, and not when the summary has nothing true to say (a failed
    // call, a load with nothing loaded): those keep the generic row.
    const meta = isMetaTool(toolSlug) && !hasHostDisplayName(toolSlug, props.tools)
        ? describeMetaTool(
            toolSlug,
            step.toolStatus ?? 'completed',
            step.toolArgs,
            step.toolResult,
            labels,
            name => resolveToolDisplayName(name, props.tools)
        )
        : null;

    const actionValue = React.useMemo(
        () => parseToolOutput(onStep?.payload ?? step.toolArgs ?? step.toolResult),
        [onStep?.payload, step.toolArgs, step.toolResult]
    );

    const isWebSearch = toolSlug === 'web_search' || toolSlug === 'search_web';

    return (
        <div className={`cb-modern-tool-call ${step.toolStatus || 'completed'}${meta ? ' cb-modern-tool-call--meta' : ''}`}>
            <div className="cb-modern-tool-header-row">
                <button
                    type="button"
                    className="cb-modern-tool-btn"
                    onClick={() => setExpanded(!expanded)}
                    aria-expanded={expanded}
                >
                    <span className="cb-modern-tool-status-icon">
                        {isRunning ? (
                            <span className="cb-spinner-xs" />
                        ) : isFailed ? (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        ) : (
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="cb-modern-tool-check">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        )}
                    </span>
                    {meta ? (
                        <span className="cb-modern-tool-label" title={toolSlug}>
                            <span className="cb-modern-tool-meta-text">{meta.text}</span>
                            {meta.detail && <span className="cb-modern-tool-meta-detail">{meta.detail}</span>}
                        </span>
                    ) : (
                        <span className="cb-modern-tool-label">
                            <span className="cb-modern-tool-verb">
                                {isRunning ? labels.toolRunning : isFailed ? labels.toolFailed : labels.toolRan}
                            </span>
                            <code className="cb-modern-tool-code" title={toolSlug}>{toolName}</code>
                        </span>
                    )}
                    <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={`cb-modern-chevron ${expanded ? 'cb-chevron-open' : ''}`}
                    >
                        <polyline points="9 18 15 12 9 6" />
                    </svg>
                </button>

                {onStep && step.toolStatus === 'completed' && (
                    <div className="cb-modern-tool-action">
                        <ToolActionControl
                            onAction={onStep.onAction}
                            payload={actionValue}
                            result={onStep.result}
                            toolName={toolName}
                            label={onStep.label}
                            render={onStep.render}
                        />
                    </div>
                )}
            </div>

            {expanded && (
                <div className="cb-modern-tool-details">
                    {isWebSearch && step.toolResult ? (
                        <div className="cb-web-search-results">
                            <div className="cb-tool-detail-label">{labels.searchResultsHeading}</div>
                            <div className="cb-markdown-content cb-tool-detail-body">
                                {typeof step.toolResult === 'string' ? step.toolResult : JSON.stringify(step.toolResult, null, 2)}
                            </div>
                        </div>
                    ) : (
                        <div className="cb-code-block">
                            {step.toolArgs && (
                                <>
                                    <div className="cb-tool-detail-key">{labels.toolArguments}</div>
                                    {JSON.stringify(step.toolArgs, null, 2)}
                                </>
                            )}
                            {step.toolResult && (
                                <>
                                    <div className="cb-tool-detail-key cb-tool-detail-key-spaced">{labels.toolResult}</div>
                                    {JSON.stringify(step.toolResult, null, 2)}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * A run of thinking, tool calls and sub-agent runs, as one collapsible row.
 *
 * Closed by default. While the run is live its header is the newest step in
 * words, with a spinner; once done, a count of what happened. Opened, every
 * step renders exactly as it would on its own. See common/activity.ts.
 */
const ActivityGroup: React.FC<{ steps: MessageStep[]; props: MessageBubbleViewProps; live: boolean }> = ({ steps, props, live }) => {
    const labels = useLabels();
    const [open, setOpen] = useState(false);
    const toolName = (name: string) => resolveToolDisplayName(name, props.tools);
    const failed = steps.some(step => step.toolStatus === 'failed');
    const header: ActivityLine = live
        ? describeLatestActivity(steps, labels, toolName)
        : { text: summarizeActivity(steps, labels, toolName) };

    return (
        <div className={`cb-activity ${live ? 'is-running' : 'is-finished'}${failed && !live ? ' has-failed' : ''}`}>
            <button
                type="button"
                className="cb-activity-btn"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
            >
                <span className="cb-activity-icon">
                    {live ? (
                        <span className="cb-spinner-xs" />
                    ) : failed ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                    ) : (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="cb-modern-tool-check">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </span>
                <span className="cb-activity-label" aria-live={live ? 'polite' : undefined}>
                    <span className="cb-activity-text">{header.text}</span>
                    {header.detail && <span className="cb-activity-detail">{header.detail}</span>}
                </span>
                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`cb-modern-chevron ${open ? 'cb-chevron-open' : ''}`}
                >
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>

            {open && (
                <div className="cb-activity-items">
                    {steps.map(step => {
                        if (step.type === 'thinking') return <ThinkingBlock key={step.id} step={step} />;
                        if (step.type === 'sub-agent') {
                            return (
                                <SubAgentBlock
                                    key={step.id}
                                    step={step}
                                    handlers={props}
                                    jobUuid={props.jobUuid ?? null}
                                    turnInFlight={isTurnInFlight(props)}
                                />
                            );
                        }
                        return <ModernToolCallRow key={step.id} step={step} props={props} />;
                    })}
                </div>
            )}
        </div>
    );
};

const ThinkingBlock = ({ step }: { step: MessageStep }) => {
    const labels = useLabels();
    const [isOpen, setIsOpen] = useState(false);
    const isFinished = step.isFinished;
    const hasContent = step.content && step.content.trim().length > 0;

    return (
        <div className={`cb-modern-thinking ${isFinished ? 'is-finished' : 'is-running'}`}>
            <button
                type="button"
                className="cb-modern-thinking-btn"
                onClick={() => setIsOpen(!isOpen)}
                aria-expanded={isOpen}
            >
                <span className="cb-modern-thinking-icon">
                    {isFinished ? (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 2a7 7 0 0 0-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 0 0-7-7zM9 21h6" />
                        </svg>
                    ) : (
                        <span className="cb-spinner-xs" />
                    )}
                </span>

                <span className="cb-modern-thinking-label">
                    {isFinished ? labels.thoughtBriefly : labels.thinking}
                </span>

                <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className={`cb-modern-chevron ${isOpen ? 'cb-chevron-open' : ''}`}
                >
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            </button>

            {isOpen && hasContent && (
                <div className="cb-modern-thinking-content">
                    <pre className="cb-thinking-text">{step.content}</pre>
                </div>
            )}
        </div>
    );
};

interface TypewriterTextProps {
    content: string;
    shouldAnimate: boolean;
    onComplete?: () => void;
    /** This text is still arriving — see `MarkdownContent`'s `streaming`. */
    streaming?: boolean;
    /** The turn is still in flight — what a rich block is told as `streaming`. */
    turnInFlight?: boolean;
    messageId?: string;
    jobUuid?: string | null;
    getMessageSource?: () => string;
    /** Draw the host's rich blocks — `false` for a user's message. Default `true`. */
    blocks?: boolean;
}

// Typewriter with DUAL-TIMER strategy for background resilience
const TypewriterText = ({
    content,
    shouldAnimate,
    onComplete,
    streaming = false,
    turnInFlight,
    messageId,
    jobUuid = null,
    getMessageSource,
    blocks = true,
}: TypewriterTextProps) => {
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
            {/* One renderer for every markdown path, so a host's blocks draw
                wherever an answer appears: here, a sub-agent's result, and the
                legacy bubble below. */}
            <MarkdownContent
                content={displayContent}
                // A typewriter still revealing its text is still "arriving".
                streaming={streaming || displayContent.length < content.length}
                turnInFlight={turnInFlight ?? streaming}
                messageId={messageId}
                jobUuid={jobUuid}
                getMessageSource={getMessageSource}
                blocks={blocks}
            />
            {shouldAnimate && content && displayContent.length < content.length && (
                <span className="cb-cursor">|</span>
            )}
        </div>
    );
};

// Legacy path for simple content without steps
const LegacyMessageBubble: React.FC<MessageProps> = (props) => {
    const { role, content, attachments, toolInvocation, shouldAnimate = true } = props;
    const labels = useLabels();
    const { blockRenderers } = useMarkdownConfig();
    // As in the steps path: blocks are the assistant's; a user's message is
    // drawn and copied as they wrote it.
    const drawsBlocks = role === 'assistant';

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
                        // The slug, not its display name: ToolInvocation resolves
                        // the name itself, and needs the slug to recognise a
                        // meta-tool or a web search.
                        toolName={toolInvocation.toolName}
                        args={toolInvocation.args}
                        status={toolInvocation.status}
                        result={toolInvocation.result}
                        tools={props.tools}
                    />
                </div>
            </div>
        );
    }

    return (
        <div ref={legacyBubbleRef} className={`cb-message-row ${role === 'user' ? 'cb-row-user' : 'cb-row-assistant'}`} data-message-id={props.id}>
            {role === 'assistant' && (
                <div className="cb-avatar-container">
                    <div className="cb-avatar-assistant">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 0 1 10 10c0 5.524-4.476 10-10 10S2 17.524 2 12 6.476 2 12 2z" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                    </div>
                </div>
            )}

            <div className="cb-message-content-wrapper" style={{ position: 'relative' }}>
                {role === 'user' ? null : <div className="cb-sender-name">{props.senderName || labels.assistantName}</div>}

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
                            <MarkdownContent
                                content={displayContent}
                                // One text for the whole turn here (a client that
                                // streams without step sequences), so while the turn
                                // runs, its text is still arriving.
                                streaming={Boolean(props.isWaitingForDeltas)
                                    || props.isTurnComplete === false
                                    || displayContent.length < (content || '').length}
                                turnInFlight={Boolean(props.isWaitingForDeltas) || props.isTurnComplete === false}
                                messageId={props.id}
                                jobUuid={props.jobUuid ?? null}
                                blocks={drawsBlocks}
                            />
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
                        content={drawsBlocks ? toPlainText(content, blockRenderers) : content}
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
