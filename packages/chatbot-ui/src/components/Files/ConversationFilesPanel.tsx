import React from 'react';
import type { BlockRecord, ConversationFile } from '../../api/types';
import type { BlockRenderer } from '../../common/chatbotConfig';
import { formatCount, formatLabel } from '../../common/labels';
import { rendererFor } from '../../common/markdownBlocks';
import { useStableId } from '../../common/useStableId';
import {
    useChatActions,
    useChatEvent,
    useChatRuntime,
    useChatState,
    useIcons,
    useLabels,
    useMarkdownConfig,
} from '../../store/hooks';
import { formatFileSize } from '../AttachmentViewer/AttachmentViewer';
import { BlockDialog, ExpandedBlock } from '../MarkdownBlock/MarkdownBlock';
import {
    CHAT_ROOT,
    DownloadButton,
    FilePreview,
    FileRow,
    FilesPanelShell,
    FilesSkeleton,
    KindThumb,
    ListRow,
    LiveAnnouncement,
    ROW_KIND_LABEL,
    SaveFileButton,
    fileTitle,
    focusRow,
    formatFileDate,
    formatRelativeDate,
    rowKindOf,
    savedStateOf,
    useReadAfterTurnEnds,
    type SavedState,
} from './FilesShared';
import {
    blocksInMessages,
    mergeConversation,
    messageTextOf,
    type ConversationBlock,
    type ConversationItem,
} from './conversationItems';

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

const HTTP_NOT_FOUND = 404;

/** How long a block "Show in chat" went to stays marked. */
const LOCATED_MS = 1600;

type Filter = 'all' | 'visuals' | 'files';

/**
 * The list, and the conversation it is of. A list of another conversation —
 * the one open before a conversation was picked in the inline sidebar beside
 * the panel — is never shown for this one: it reads as loading until this
 * one's read lands, and a failed read of this one does not keep it (review of
 * 2026-10-14: it kept the previous conversation's files, with working Save
 * and Download, under the new one's name).
 */
type LoadState =
    | { status: 'loading' }
    | { status: 'loaded'; conversationId: string | null; files: ConversationFile[]; blocks: BlockRecord[] }
    | { status: 'failed'; conversationId: string | null };

/**
 * A block open in the expanded overlay, drawn live — of the conversation it
 * was opened in, which its Save saves against (review of 2026-10-14).
 */
interface OpenBlock {
    block: ConversationBlock;
    source: string;
    renderer: BlockRenderer;
    conversationId: string | null;
}

/** How many skeleton rows stand in while the list loads. */
const SKELETON_ROWS = 4;

/** An item's Saved / Not saved mark; none for an upload. */
function markOf(item: ConversationItem): SavedState {
    return item.type === 'block' ? (item.block.saved ? 'saved' : 'unsaved') : savedStateOf(item.file);
}

/**
 * "Conversation files": everything of the open conversation, newest first —
 * what the user attached, what the application generated (an export), what
 * the user saved, and every chart, table, KPI card or report the answers drew
 * (2026-10-14) — with a Saved / Not saved mark on each artifact, and filter
 * chips: All · Visuals · Files.
 *
 * - A drawn block opens **drawn live** by the host's renderer in the expanded
 *   overlay — its own Save saves it — and "Show in chat" closes the panel and
 *   goes to it in the transcript.
 * - A generated file nobody saved has a Save button (`saveGeneratedFile`).
 * - Uploads carry no mark: they are the user's, not the agent's.
 *
 * Blocks are the server's index of the conversation's ended turns, together
 * with those in the loaded transcript (the turn under way, and conversations
 * the platform never indexed), one entry per turn and block key. The panel
 * reads the list afresh on each opening, after every save or delete through
 * the chat (`chat.files.changed`), and twice after a turn ends, when the
 * platform has indexed its blocks.
 *
 * Its look (2026-10-14, the user: "fix the design of the artifacts modal …
 * it should be better"): a dialog sized to its list, its header saying the
 * conversation and how many items it has (and how many are saved), the
 * filter a segmented control with counts, and under "All" two sections —
 * Visuals, then Files — newest first in each. A row is a tile tinted by its
 * kind (or the image itself), its title, its mark and a details line (kind,
 * when, size), its actions shown on hover or focus where there is a mouse.
 * Loading shows rows' skeletons; an empty conversation, a block saying what
 * will appear here; an empty filter, its own line.
 *
 * Opened by the header's files button (`useChatActions().openFiles()`).
 * `ChatContainer` renders it; a host with its own layout renders it once
 * anywhere under the provider, inside a positioned element it should cover.
 */
export const ConversationFilesPanel: React.FC = () => {
    const isOpen = useChatState(s => s.isFilesPanelOpen);
    // Mounted per opening, so each one starts from the server's list.
    return isOpen ? <ConversationFilesBody /> : null;
};

/** The languages this page draws, as the transcript looks them up. */
function useDrawnLanguages(): { languages: string[]; renderers: Record<string, BlockRenderer> } {
    const { blockRenderers } = useMarkdownConfig();
    return useMemo(() => ({
        languages: Object.keys(blockRenderers).filter(language => rendererFor(blockRenderers, language)).sort(),
        renderers: blockRenderers,
    }), [blockRenderers]);
}

/**
 * Scroll the transcript to a block — the transcript's own scroll view, not
 * every scrollable ancestor (the host's page among them) — and put focus on
 * it, marked for a moment. The block is found by its key and turn; a block in
 * a collapsed sub-agent run is not drawn, so its message is gone to instead.
 * `false` when neither is on screen.
 */
function locateInTranscript(root: Element | null, block: ConversationBlock): boolean {
    if (!root) return false;
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('[data-block-key]'))
        .filter(element => element.dataset.blockKey === block.blockKey
            && (!block.turnJobUuid || element.dataset.jobUuid === block.turnJobUuid));
    const target = candidates[0]
        ?? (block.messageId
            ? Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]'))
                .find(element => element.dataset.messageId === block.messageId)
            : undefined);
    if (!target) return false;
    const view = target.closest<HTMLElement>('.cb-scroll-view');
    if (view && typeof view.scrollTo === 'function') {
        const viewRect = view.getBoundingClientRect();
        const rect = target.getBoundingClientRect();
        const centred = view.scrollTop + (rect.top - viewRect.top) - Math.max(0, (view.clientHeight - rect.height) / 2);
        view.scrollTo({ top: Math.max(0, centred), behavior: 'smooth' });
    } else if (typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'nearest' });
    }
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.classList.add('is-located');
    window.setTimeout(() => target.classList.remove('is-located'), LOCATED_MS);
    return true;
}

const ConversationFilesBody: React.FC = () => {
    const { store } = useChatRuntime();
    const storage = useChatState(s => s.storageClient);
    const conversationId = useChatState(s => s.activeConversationId);
    // The open conversation's title, as the sidebar lists it — the panel's subtitle.
    const conversationTitle = useChatState(s => {
        const id = s.activeConversationId;
        if (!id) return null;
        const found = s.conversations.find(conversation => conversation.uuid === id)
            ?? s.starredConversations.find(conversation => conversation.uuid === id);
        return found?.title || null;
    });
    const revision = useChatState(s => s.filesRevision);
    const messages = useChatState(s => s.messages);
    const isThinking = useChatState(s => s.isThinking);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const { languages, renderers } = useDrawnLanguages();
    const [loadState, setState] = useState<LoadState>({ status: 'loading' });
    // Only ever this conversation's list: another's reads as loading.
    const state: LoadState = loadState.status !== 'loading' && loadState.conversationId !== conversationId
        ? { status: 'loading' }
        : loadState;
    const [attempt, setAttempt] = useState(0);
    const [refresh, setRefresh] = useState(0);
    const [filter, setFilter] = useState<Filter>('all');
    const [preview, setPreview] = useState<ConversationFile | null>(null);
    const [openBlock, setOpenBlock] = useState<OpenBlock | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});
    const [busyRows, setBusyRows] = useState<Record<string, boolean>>({});
    // A row's Save that landed: said aloud, and focus on its row — the Save
    // button it was on is gone once the row shows Saved (review of 2026-10-14).
    const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
    const focusAfterSave = useRef<string | null>(null);
    const closePreview = useCallback(() => setPreview(null), []);
    const closeBlock = useCallback(() => setOpenBlock(null), []);
    // Another conversation picked beside the panel closes a block of this one:
    // drawn under the new one, its Save would save against it.
    const shownBlock = openBlock && openBlock.conversationId === conversationId ? openBlock : null;
    useEffect(() => {
        setOpenBlock(current => (current && current.conversationId !== conversationId ? null : current));
    }, [conversationId]);
    const sectionId = useStableId('cb-files-section');
    const bodyRef = useRef<HTMLDivElement>(null);
    const openerRef = useRef<HTMLElement | null>(null);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);

    // `refresh` is a read again in the background: the list on screen stays
    // until it is replaced, and stays if the read fails.
    useEffect(() => {
        if (!storage || !conversationId) {
            setState({ status: 'loaded', conversationId, files: [], blocks: [] });
            return undefined;
        }
        let cancelled = false;
        storage.listConversationFiles(conversationId).then(
            contents => {
                if (!cancelled) setState({ status: 'loaded', conversationId, files: contents.files, blocks: contents.blocks });
            },
            (error: { status?: number }) => {
                if (cancelled) return;
                // A thread whose first turn the platform has not stored yet is
                // unknown to the storage API: it has no files, not an error.
                if (error?.status === HTTP_NOT_FOUND) {
                    setState({ status: 'loaded', conversationId, files: [], blocks: [] });
                } else {
                    // A read again of this conversation that fails keeps its
                    // list; another conversation's list is not kept.
                    setState(previous => (previous.status === 'loaded' && previous.conversationId === conversationId
                        ? previous
                        : { status: 'failed', conversationId }));
                }
            }
        );
        return () => {
            cancelled = true;
        };
    }, [storage, conversationId, revision, attempt, refresh]);

    // A save or a delete through the chat shows at once — the read again it
    // starts (`filesRevision`) then replaces the list with the server's.
    useChatEvent('chat.files.changed', change => {
        setState(previous => {
            if (previous.status !== 'loaded' || previous.conversationId !== conversationId) return previous;
            if (change.change === 'deleted') {
                return { ...previous, files: previous.files.filter(file => file.attachment_uuid !== change.attachmentUuid) };
            }
            const stored = change.file;
            if (!stored || (stored.conversation_uuid && conversationId && stored.conversation_uuid !== conversationId)) {
                return previous;
            }
            const files = previous.files.filter(file => file.attachment_uuid !== stored.attachment_uuid);
            const withCopy = change.savedFromUuid
                ? files.map(file => (file.attachment_uuid === change.savedFromUuid ? { ...file, saved: true } : file))
                : files;
            return { ...previous, files: [stored, ...withCopy] };
        });
    });

    // A turn that ends while the panel is open: its blocks are indexed a
    // moment later. Read again then, twice, so their server rows (saved
    // state, titles) replace the transcript's.
    useReadAfterTurnEnds(isThinking, () => setRefresh(n => n + 1));

    const liveMessageId = isThinking && messages.length > 0 ? messages[messages.length - 1].id : null;
    // What an open block of the transcript reads as its answer: the message's
    // text now, not as it was when the row was clicked — a block of the turn
    // under way is drawn while the rest of its answer arrives.
    const messagesRef = useRef(messages);
    messagesRef.current = messages;
    const transcriptBlocks = useMemo(
        () => blocksInMessages(messages, languages, liveMessageId),
        [messages, languages, liveMessageId]
    );

    const items = useMemo<ConversationItem[] | null>(() => {
        if (state.status !== 'loaded') return null;
        return mergeConversation(state.files, state.blocks, transcriptBlocks);
    }, [state, transcriptBlocks]);

    // Visuals and files apart, each newest first as the list is: the filters'
    // lists, and "All"'s two sections.
    const groups = useMemo(() => {
        if (!items) return null;
        const visuals = items.filter(item => item.visual);
        const files = items.filter(item => !item.visual);
        return { visuals, files, saved: items.filter(item => markOf(item) === 'saved').length };
    }, [items]);

    const shown = useMemo(() => {
        if (!items || !groups) return null;
        if (filter === 'visuals') return groups.visuals;
        if (filter === 'files') return groups.files;
        return items;
    }, [items, groups, filter]);

    // After the render that showed the saved row: focus on it, unless the
    // user has put focus somewhere since.
    useLayoutEffect(() => {
        const id = focusAfterSave.current;
        if (!id) return;
        focusAfterSave.current = null;
        focusRow(bodyRef.current, id);
    });

    const setRowError = (id: string) => (message: string | null) =>
        setRowErrors(previous => ({ ...previous, [id]: message }));
    const setRowBusy = (id: string, busy: boolean) =>
        setBusyRows(previous => ({ ...previous, [id]: busy }));

    /**
     * Open a block drawn live: at once when the transcript holds its body,
     * after fetching it (`getBlock`) otherwise — the row says when that fails.
     *
     * A fetch lands only where it was asked for: the panel still open, on the
     * same conversation (review of 2026-10-14). Read from the store when it
     * lands, not from this render: a conversation picked in the inline
     * sidebar meanwhile opened the block against the new one — drawn under
     * its name, its Save saving it there.
     */
    const openLive = (item: ConversationItem & { type: 'block' }, renderer: BlockRenderer, opener: HTMLButtonElement) => {
        const { block } = item;
        openerRef.current = opener;
        if (block.source !== null) {
            setOpenBlock({ block, source: block.source, renderer, conversationId });
            return;
        }
        if (!storage || !block.serverUuid || busyRows[item.id]) return;
        const askedFor = conversationId;
        const stillHere = () => {
            if (!mounted.current) return false;
            const now = store.getState();
            return now.isFilesPanelOpen && now.activeConversationId === askedFor;
        };
        setRowError(item.id)(null);
        setRowBusy(item.id, true);
        storage.getBlock(block.serverUuid).then(
            record => {
                if (stillHere()) setOpenBlock({ block, source: record.source, renderer, conversationId: askedFor });
            },
            () => {
                if (stillHere()) setRowError(item.id)(labels.blockLoadFailed);
            }
        ).finally(() => {
            if (mounted.current) setRowBusy(item.id, false);
        });
    };

    /** Close the panel and go to the block in the transcript. */
    const showInChat = (block: ConversationBlock) => {
        const root = bodyRef.current?.closest(CHAT_ROOT) ?? null;
        actions.closeFiles();
        // After the commit that closed the panel, and after it gave focus
        // back to where it was opened from.
        window.setTimeout(() => {
            locateInTranscript(root, block);
        }, 0);
    };

    const renderFile = (item: ConversationItem & { type: 'file' }) => {
        const { file } = item;
        const mark = savedStateOf(file);
        // What it is, who made it (an export is "Generated"), when, how big.
        const details = [
            labels[ROW_KIND_LABEL[rowKindOf(file)]],
            file.source === 'generated' ? labels.fileGeneratedBadge : '',
            formatRelativeDate(file.created_at),
            file.size_bytes > 0 ? formatFileSize(file.size_bytes) : '',
        ];
        return (
            <FileRow
                key={item.id}
                itemId={item.id}
                file={file}
                mark={mark}
                details={details}
                detailsTitle={formatFileDate(file.created_at)}
                onPreview={setPreview}
                error={rowErrors[item.id]}
                actions={storage && (
                    <>
                        {file.source === 'generated' && mark === 'unsaved' && (
                            <SaveFileButton
                                title={fileTitle(file)}
                                onSave={() => actions.saveGeneratedFile(file.attachment_uuid).then(() => {
                                    if (!mounted.current) return;
                                    focusAfterSave.current = item.id;
                                    setAnnouncement(previous => ({
                                        text: formatLabel(labels.fileSavedAnnouncement, { title: fileTitle(file) }),
                                        seq: previous.seq + 1,
                                    }));
                                })}
                                onError={setRowError(item.id)}
                            />
                        )}
                        <DownloadButton
                            file={file}
                            onDownload={target => storage.downloadFile(target)}
                            onError={setRowError(item.id)}
                        />
                    </>
                )}
            />
        );
    };

    const renderBlock = (item: ConversationItem & { type: 'block' }) => {
        const { block } = item;
        const renderer = rendererFor(renderers, block.language);
        const label = renderer?.label ?? block.language;
        const title = block.title ?? formatLabel(labels.blockUntitled, { label });
        const canOpen = Boolean(renderer && (block.source !== null || block.serverUuid));
        const inChat = block.messageId !== null;
        const size = block.artifact && block.artifact.size_bytes > 0 ? formatFileSize(block.artifact.size_bytes) : '';
        return (
            <ListRow
                key={item.id}
                itemId={item.id}
                className="cb-file-item-block"
                // A block has no stored picture: its kind's tile.
                picture={<KindThumb kind={block.kind ?? 'file'} />}
                title={title}
                mark={block.saved ? 'saved' : 'unsaved'}
                // The renderer's word for it first ("chart"), as its untitled name says it.
                details={[label, formatRelativeDate(block.createdAt), size]}
                detailsTitle={formatFileDate(block.createdAt)}
                onOpen={canOpen && renderer ? opener => openLive(item, renderer, opener) : undefined}
                busy={Boolean(busyRows[item.id])}
                error={rowErrors[item.id]}
                actions={(
                    <>
                        <button
                            type="button"
                            className="cb-file-action cb-file-action-locate"
                            aria-disabled={!inChat || undefined}
                            aria-label={inChat
                                ? `${labels.showInChat}: ${title}`
                                : `${labels.showInChat}: ${title} — ${labels.showInChatUnavailable}`}
                            title={inChat ? labels.showInChat : labels.showInChatUnavailable}
                            onClick={() => {
                                if (inChat) showInChat(block);
                            }}
                        >
                            {icons.showInChat}
                        </button>
                        {storage && block.artifact && (
                            <DownloadButton
                                file={block.artifact}
                                onDownload={target => storage.downloadFile(target)}
                                onError={setRowError(item.id)}
                            />
                        )}
                    </>
                )}
            />
        );
    };

    const renderItem = (item: ConversationItem) => (item.type === 'file' ? renderFile(item) : renderBlock(item));

    const total = items?.length ?? 0;
    const filters: Array<{ id: Filter; label: string; count: number }> = groups ? [
        { id: 'all', label: labels.filesFilterAll, count: total },
        { id: 'visuals', label: labels.filesFilterVisuals, count: groups.visuals.length },
        { id: 'files', label: labels.filesFilterFiles, count: groups.files.length },
    ] : [];
    const emptyText = filter === 'visuals' ? labels.conversationVisualsEmpty : labels.conversationFilesEmpty;

    // Under the title: the conversation (cut short), then "6 items · 2 saved".
    const countText = groups && total > 0
        ? [
            formatCount(total, labels.filesItemsOne, labels.filesItemsOther),
            groups.saved > 0 ? formatLabel(labels.filesSavedCount, { count: groups.saved }) : '',
        ].filter(Boolean).join(' · ')
        : '';
    const subtitle = conversationTitle || countText ? (
        <>
            {conversationTitle && (
                <span className="cb-files-subtitle-title" dir="auto" title={conversationTitle}>{conversationTitle}</span>
            )}
            {conversationTitle && countText && <span className="cb-files-subtitle-sep" aria-hidden="true">·</span>}
            {/* Its own direction: untranslated counts in a right-to-left page
                would otherwise read "items · 2 saved 7". */}
            {countText && <span className="cb-files-subtitle-counts" dir="auto">{countText}</span>}
        </>
    ) : undefined;

    // "All": Visuals, then Files, each under its heading with its count.
    const sections = filter === 'all' && groups
        ? [
            { id: 'visuals', label: labels.filesFilterVisuals, items: groups.visuals },
            { id: 'files', label: labels.filesFilterFiles, items: groups.files },
        ].filter(section => section.items.length > 0)
        : null;

    return (
        <FilesPanelShell
            title={labels.conversationFiles}
            icon={icons.files}
            subtitle={subtitle}
            onClose={actions.closeFiles}
            className="cb-conversation-files"
            toolbar={state.status === 'loaded' && total > 0 ? (
                <div className="cb-files-segmented cb-files-filter" role="group" aria-label={labels.filesFilter}>
                    {filters.map(option => (
                        <button
                            key={option.id}
                            type="button"
                            className={`cb-files-segment${filter === option.id ? ' is-active' : ''}${option.count === 0 ? ' is-empty' : ''}`}
                            aria-pressed={filter === option.id}
                            onClick={() => setFilter(option.id)}
                        >
                            {/* The space is what a screen reader hears between them ("Visuals 3"); the gap draws it. */}
                            <span className="cb-files-segment-label">{option.label}</span>
                            {' '}
                            <span className="cb-files-segment-count">{option.count}</span>
                        </button>
                    ))}
                </div>
            ) : undefined}
        >
            <div className="cb-files-body-inner" ref={bodyRef}>
                <LiveAnnouncement text={announcement.text} />
                {state.status === 'loading' && <FilesSkeleton variant="rows" count={SKELETON_ROWS} />}
                {state.status === 'failed' && (
                    <div className="cb-files-state cb-files-error" role="alert">
                        <p>{labels.filesLoadFailed}</p>
                        <button type="button" className="cb-files-text-btn" onClick={() => setAttempt(n => n + 1)}>
                            {labels.retry}
                        </button>
                    </div>
                )}
                {items && items.length === 0 && (
                    <div className="cb-files-empty">
                        <span className="cb-files-empty-icon" aria-hidden="true">{icons.files}</span>
                        <h3 className="cb-files-empty-title">{labels.conversationFilesEmptyTitle}</h3>
                        <p className="cb-files-empty-hint">{labels.conversationFilesEmptyHint}</p>
                    </div>
                )}
                {total > 0 && shown && shown.length === 0 && (
                    <p className="cb-files-state cb-files-filter-empty">{emptyText}</p>
                )}
                {sections && sections.map(section => (
                    <div key={section.id} className={`cb-files-section is-${section.id}`}>
                        <h3 className="cb-files-section-title" id={`${sectionId}-${section.id}`}>
                            <span className="cb-files-section-label">{section.label}</span>
                            {' '}
                            <span className="cb-files-section-count">{section.items.length}</span>
                        </h3>
                        <ul className="cb-files-list" aria-labelledby={`${sectionId}-${section.id}`}>
                            {section.items.map(renderItem)}
                        </ul>
                    </div>
                ))}
                {!sections && shown && shown.length > 0 && (
                    <ul className="cb-files-list">
                        {shown.map(renderItem)}
                    </ul>
                )}
            </div>
            <FilePreview file={preview} onClose={closePreview} />
            {shownBlock && (
                <BlockDialog
                    label={shownBlock.block.title ?? (shownBlock.renderer.label ?? shownBlock.block.language)}
                    onClose={closeBlock}
                    returnFocusTo={openerRef}
                >
                    <ExpandedBlock
                        language={shownBlock.block.language}
                        source={shownBlock.source}
                        meta={shownBlock.block.meta}
                        renderer={shownBlock.renderer}
                        // Saved against the turn, whichever job of it drew the block.
                        jobUuid={shownBlock.block.turnJobUuid}
                        conversationId={shownBlock.conversationId}
                        messageId={shownBlock.block.messageId ?? ''}
                        getMessageSource={shownBlock.block.messageText !== null
                            ? () => {
                                const message = messagesRef.current.find(candidate => candidate.id === shownBlock.block.messageId);
                                return message ? messageTextOf(message) : shownBlock.block.messageText ?? shownBlock.source;
                            }
                            : undefined}
                        // A block of the turn under way is told so, as in the
                        // transcript: a report exports, and saves, the whole
                        // answer once it has ended, not the half written so far.
                        streaming={Boolean(shownBlock.block.messageId && shownBlock.block.messageId === liveMessageId)}
                        onClose={closeBlock}
                    />
                </BlockDialog>
            )}
        </FilesPanelShell>
    );
};
