import React from 'react';
import type { ArtifactEntry, ArtifactKind, ArtifactStatus, BlockWithSource, ConversationFile } from '../../api/types';
import {
    ARTIFACT_KINDS,
    MAX_ARTIFACT_PAGE_SIZE,
    MAX_ARTIFACT_SEARCH_CHARS,
    type StorageClient,
} from '../../api/StorageClient';
import { isNothingFocused } from '../../common/focusTrap';
import { formatLabel } from '../../common/labels';
import { rendererFor } from '../../common/markdownBlocks';
import { useStableId } from '../../common/useStableId';
import { useChatActions, useChatEvent, useChatState, useIcons, useLabels, useMarkdownConfig } from '../../store/hooks';
import { AttachmentPreview, useAttachmentLoad } from '../AttachmentViewer/AttachmentViewer';
import { useChatPresentation } from '../ChatContainer/presentation';
import { ExpandedBlock } from '../MarkdownBlock/MarkdownBlock';
import {
    CHAT_ROOT,
    DownloadButton,
    FileRow,
    FilesHeader,
    FilesSkeleton,
    KIND_ICON,
    KIND_LABEL,
    KindThumb,
    ListRow,
    LiveAnnouncement,
    SaveFileButton,
    SavedMark,
    baseDetails,
    fileTitle,
    focusRow,
    formatFileDate,
    placeOf,
    toAttachment,
    useReadAfterTurnEnds,
    type Place,
} from './FilesShared';

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
/** How long a first click on delete waits for the second before it lets go. */
const CONFIRM_DELETE_MS = 4000;

type ListState =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'loaded'; items: ArtifactEntry[]; total: number | null; hasMore: boolean };

/** The saved filter's options, in order. */
const STATUS_OPTIONS: readonly ArtifactStatus[] = ['all', 'saved', 'unsaved'];

/**
 * The first `count()` entries for a search, a kind and a saved state, read in
 * as few pages as the storage API allows (100 at most each). What a read again
 * of the list on screen asks for: everything it showed, not just its first page.
 *
 * `count` is asked again after every page, so a "Load more" clicked while
 * this read is under way is read by it too.
 */
async function readEntries(
    storage: StorageClient,
    filter: { q?: string; kind?: ArtifactKind; status: ArtifactStatus },
    count: () => number,
): Promise<{ items: ArtifactEntry[]; total: number | null; hasMore: boolean }> {
    const items: ArtifactEntry[] = [];
    const known = new Set<string>();
    let total: number | null = null;
    let hasMore = true;
    while (items.length < count() && hasMore) {
        const page = await storage.listArtifactEntries({
            ...filter,
            offset: items.length,
            limit: Math.min(MAX_ARTIFACT_PAGE_SIZE, count() - items.length),
        });
        total = page.total;
        hasMore = page.hasMore;
        const fresh = page.items.filter(item => !known.has(item.id));
        fresh.forEach(item => known.add(item.id));
        items.push(...fresh);
        // A page with nothing new (an empty page the server still calls
        // partial) would loop for ever.
        if (fresh.length === 0) break;
    }
    return { items, total, hasMore };
}

/** The entry a saved file stands for in the list: what a Save turns an entry into. */
function savedEntryOf(file: ConversationFile, from: ArtifactEntry): ArtifactEntry {
    return {
        id: `file:${file.attachment_uuid}`,
        type: 'file',
        saved: true,
        kind: file.artifact_kind ?? from.kind ?? 'file',
        title: file.title ?? from.title ?? file.filename,
        created_at: file.created_at || from.created_at,
        job_uuid: file.job_uuid,
        conversation_uuid: file.conversation_uuid ?? from.conversation_uuid,
        conversation_title: file.conversation_title ?? from.conversation_title,
        file,
        block: null,
    };
}

/**
 * "Artifacts": everything the answers produced — charts, tables, KPI cards,
 * reports, files — across every conversation, newest first, **saved and not
 * saved, told apart** (2026-10-14): a segmented control (All · Saved · Not
 * saved) above the kind chips, and a Saved / Not saved mark on every row.
 *
 * Opened by the sidebar's entry under "New chat"
 * (`useChatActions().openArtifacts()`). Search, the saved filter and the kind
 * filter run on the server (`listArtifactEntries`), a page at a time. Opened:
 *
 * - a saved artifact shows its stored file, and can be downloaded, deleted
 *   (two clicks — only an artifact can be) and its conversation opened;
 * - a block nobody saved is **drawn live** by the host's renderer, in the
 *   column, from its indexed body (`getBlock`) — its own Save saves it, and it
 *   then shows as saved;
 * - a generated file nobody saved shows as a file, with a Save button.
 *
 * A view, not a dialog (2026-10-14): it stands in the chat column in place of
 * the transcript and the composer, and opening an artifact shows the whole of
 * it in that same column, with "Back" to the list. Until then it was a modal
 * panel over the chat, and an artifact opened in a lightbox over that.
 *
 * `ChatContainer` renders it in the transcript's place and hides the
 * transcript and the composer while it shows (they stay mounted, so a draft
 * and the scroll position survive). A host with its own layout renders it
 * where the view belongs — usually instead of its `MainChat` and composer
 * while `isArtifactsPanelOpen` — and it fills that element; it renders
 * nothing while the view is closed.
 */
export const ArtifactsPanel: React.FC = () => {
    const isOpen = useChatState(s => s.isArtifactsPanelOpen);
    return isOpen ? <ArtifactsView /> : null;
};

/**
 * Where focus goes once the view has gone: the sidebar's "Artifacts" entry —
 * the composer when the entry is not on screen (a closed drawer) — or the
 * composer straight away.
 */
type LeaveFocus = 'entry' | 'chat';

/** A modal dialog open in the chat — the files panel, credit usage — or holding focus. */
function modalDialogOpen(root: Element | null): boolean {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    return Boolean(active?.closest('[aria-modal="true"]') || root?.querySelector('[aria-modal="true"]'));
}

function returnFocus(root: Element | null, to: LeaveFocus, focusComposer: () => void): void {
    // After the commit that closed the view: until then the composer is
    // hidden behind it, and a hidden element cannot take focus.
    window.setTimeout(() => {
        // The view closed because a dialog took the column (`openFiles()`):
        // focus is the dialog's. Until 2026-10-14 it went to the composer
        // behind the dialog, outside its Tab trap.
        if (modalDialogOpen(root)) return;
        if (to === 'entry') {
            const entry = root?.querySelector<HTMLElement>('.cb-sidebar-nav-artifacts');
            entry?.focus();
            if (entry && document.activeElement === entry) return;
        }
        focusComposer();
    }, 0);
}

const ArtifactsView: React.FC = () => {
    const storage = useChatState(s => s.storageClient);
    const activeConversationId = useChatState(s => s.activeConversationId);
    const openings = useChatState(s => s.artifactsOpenings);
    const isSidebarOpen = useChatState(s => s.isSidebarOpen);
    const isThinking = useChatState(s => s.isThinking);
    const { sidebarInline } = useChatPresentation();
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const { blockRenderers } = useMarkdownConfig();
    const titleId = useStableId('cb-artifacts-title');
    const viewRef = useRef<HTMLElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);
    const listBodyRef = useRef<HTMLDivElement>(null);

    const [query, setQuery] = useState('');
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState<ArtifactKind | null>(null);
    const [status, setStatus] = useState<ArtifactStatus>('all');
    const [reload, setReload] = useState(0);
    const [list, setList] = useState<ListState>({ status: 'loading' });
    const [isLoadingMore, setLoadingMore] = useState(false);
    // The entry shown in full, in place of the list. The list stays mounted
    // underneath (hidden), so its search, filters and pages are as the user
    // left them when they go back.
    const [selected, setSelected] = useState<ArtifactEntry | null>(null);
    // What the entry open in full is drawn under: the id it was opened as,
    // kept when a Save turns it into the saved copy — so the header changes
    // and the file shown stays, rather than the whole detail mounting again
    // and downloading the file a second time (review of 2026-10-14).
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});
    // The row an entry was opened from and how far the list was scrolled:
    // what "Back" returns to. `focus: 'search'` when "Artifacts" was chosen
    // again in the sidebar: the list, from its top control.
    const returnTo = useRef<{ id: string; openedId: string; scrollTop: number; focus?: 'search' } | null>(null);
    // A Save that landed: said aloud, and where focus goes once the button
    // the user pressed has gone — the saved row (until the list read again
    // after it has applied: it lists the saved copy as a new entry, at the
    // top), or, in an entry open in full, the header's first action.
    const [announcement, setAnnouncement] = useState({ text: '', seq: 0 });
    const followSaved = useRef<{ id: string; untilRead: number } | null>(null);
    const focusDetailAction = useRef(false);
    // Set by the view's own ways out (close, Escape, "Open conversation"); a
    // close from elsewhere — a conversation picked in the sidebar, "New chat"
    // — leaves focus where the user put it.
    const leaveFocus = useRef<LeaveFocus | null>(null);
    // Which read is the current one: a slow page for an old search must not
    // replace the results of the search the user has since typed.
    const requestSeq = useRef(0);
    // The search, kind and saved state the list on screen answers. A read for
    // another one shows the skeleton; a read again for the same one (a save
    // landed, a retry, a refreshed token) keeps the list on screen until the
    // new one replaces it.
    const listedFor = useRef<string | null>(null);
    // How many entries the user has asked to see for that search: a page,
    // plus a page per "Load more" — counted when clicked, so a read again
    // that starts, or is still reading, after a "Load more" reads its page too.
    // Until 2026-10-14 a read again fetched the first page alone and the
    // pages loaded since vanished from under the user.
    const wantedCount = useRef(PAGE_SIZE);
    // Counts the lists started afresh (another search, kind or saved state)
    // and the reads again that replaced the list, so a "Load more" that lands
    // after either knows its page is of another list, or already in this one.
    const listGeneration = useRef(0);
    const appliedReads = useRef(0);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);

    // Opening the view puts focus in its search.
    useEffect(() => {
        searchRef.current?.focus();
    }, []);

    // Closing it gives focus back to the chat when it was in the view — read
    // in a layout effect's cleanup, while the view is still in the document.
    useLayoutEffect(() => {
        const view = viewRef.current;
        const root = view?.closest(CHAT_ROOT) ?? null;
        return () => {
            const active = typeof document !== 'undefined' ? document.activeElement : null;
            const focusWasHere = isNothingFocused(active) || Boolean(view && active && view.contains(active));
            const to = leaveFocus.current ?? (focusWasHere ? 'chat' : null);
            if (to) returnFocus(root, to, actions.focusComposer);
        };
    }, [actions]);

    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(query.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [query]);

    /**
     * Take an artifact off the list (and out of view) once it is deleted — by
     * this view or anyone else. A deleted block's artifact makes the block
     * "Not saved" again, so the list is read again too.
     */
    const dropArtifact = useCallback((attachmentUuid: string) => {
        setList(previous => {
            if (previous.status !== 'loaded' || !previous.items.some(item => item.file?.attachment_uuid === attachmentUuid)) {
                return previous;
            }
            return {
                ...previous,
                items: previous.items.filter(item => item.file?.attachment_uuid !== attachmentUuid),
                total: previous.total === null ? null : Math.max(0, previous.total - 1),
            };
        });
        setSelected(current => (current?.file?.attachment_uuid === attachmentUuid ? null : current));
    }, []);

    // A save anywhere in the chat — a block's, a generated file's — lands in
    // this list (at the top, or as the entry it saved); a delete elsewhere
    // takes the artifact off it. An entry open in full that was just saved
    // shows as saved.
    useChatEvent('chat.files.changed', change => {
        if (change.change === 'deleted') {
            dropArtifact(change.attachmentUuid);
            setReload(n => n + 1);
            return;
        }
        setReload(n => n + 1);
        const stored = change.file;
        if (!stored) return;
        setSelected(current => {
            if (!current || current.saved) return current;
            const block = current.block;
            const savedBlock = block && stored.is_artifact && change.blockKey === block.block_key
                && [block.turn_job_uuid, block.job_uuid].includes(change.jobUuid ?? stored.job_uuid);
            const savedFile = current.file && change.savedFromUuid === current.file.attachment_uuid;
            if (!savedBlock && !savedFile) return current;
            const next = savedEntryOf(stored, current);
            if (returnTo.current?.id === current.id) returnTo.current.id = next.id;
            // A block stays drawn live: it is the same visual, now kept.
            return savedBlock ? { ...current, saved: true, file: stored } : next;
        });
    });

    // A turn that ends while the view shows: its blocks and files are listed
    // a moment later, as "Not saved".
    useReadAfterTurnEnds(isThinking, () => setReload(n => n + 1));

    useEffect(() => {
        if (!storage) return undefined;
        const seq = ++requestSeq.current;
        const queryKey = `${status}\u0001${kind ?? ''}\u0001${search}`;
        const sameQuery = listedFor.current === queryKey;
        listedFor.current = queryKey;
        if (!sameQuery) {
            wantedCount.current = PAGE_SIZE;
            listGeneration.current += 1;
        }
        setList(previous => (sameQuery && previous.status === 'loaded' ? previous : { status: 'loading' }));
        readEntries(storage, { q: search || undefined, kind: kind ?? undefined, status }, () => wantedCount.current).then(
            page => {
                if (seq === requestSeq.current) {
                    appliedReads.current += 1;
                    setList({ status: 'loaded', items: page.items, total: page.total, hasMore: page.hasMore });
                }
            },
            () => {
                if (seq !== requestSeq.current) return;
                // A read again in the background (a save elsewhere, a refreshed
                // token) that fails leaves the list on screen as it was; only a
                // list that has nothing to show says it could not load.
                setList(previous => (sameQuery && previous.status === 'loaded' ? previous : { status: 'failed' }));
            }
        );
        return undefined;
        // `reload` is the point: a save or a retry reads the same span again.
    }, [storage, search, kind, status, reload]);

    useEffect(() => {
        if (!confirmingDelete) return undefined;
        const timer = window.setTimeout(() => setConfirmingDelete(null), CONFIRM_DELETE_MS);
        return () => window.clearTimeout(timer);
    }, [confirmingDelete]);

    /**
     * The next page, after the rows on screen. A read again of the list that
     * starts or finishes meanwhile reads this page too (`wantedCount`), so:
     *
     * - when that read replaced the list first, this page is already in it,
     *   and is dropped rather than added twice;
     * - when this page lands first, it is added, and the read replaces the
     *   whole list with one that has it;
     * - when that read fails, the list on screen stays — with this page added.
     *
     * Another search, kind or saved state meanwhile drops it: it is a page of
     * another list.
     */
    const loadMore = () => {
        if (!storage || list.status !== 'loaded' || !list.hasMore || isLoadingMore) return;
        const generation = listGeneration.current;
        const readsBefore = appliedReads.current;
        wantedCount.current = Math.max(wantedCount.current, list.items.length + PAGE_SIZE);
        setLoadingMore(true);
        storage.listArtifactEntries({
            limit: PAGE_SIZE,
            offset: list.items.length,
            q: search || undefined,
            kind: kind ?? undefined,
            status,
        }).then(
            page => {
                if (generation !== listGeneration.current || readsBefore !== appliedReads.current) return;
                setList(previous => {
                    if (previous.status !== 'loaded') return previous;
                    const known = new Set(previous.items.map(item => item.id));
                    return {
                        status: 'loaded',
                        items: [...previous.items, ...page.items.filter(item => !known.has(item.id))],
                        total: page.total,
                        hasMore: page.hasMore,
                    };
                });
            },
            () => undefined
        ).finally(() => {
            if (mounted.current) setLoadingMore(false);
        });
    };

    const setRowError = useCallback(
        (id: string) => (message: string | null) => setRowErrors(previous => ({ ...previous, [id]: message })),
        []
    );

    const remove = (entry: ArtifactEntry, file: ConversationFile) => {
        if (confirmingDelete !== file.attachment_uuid) {
            setConfirmingDelete(file.attachment_uuid);
            return;
        }
        setConfirmingDelete(null);
        setRowError(entry.id)(null);
        actions.deleteArtifact(file.attachment_uuid).then(
            () => dropArtifact(file.attachment_uuid),
            () => setRowError(entry.id)(labels.artifactDeleteFailed)
        );
    };

    /**
     * Keep a generated file nobody saved: the storage API copies it into an
     * artifact. Open in full, the entry becomes that artifact, saved — its
     * file still on screen, focus on the header's first action. In the list,
     * the row shows Saved where it is, with focus on it, until the list read
     * again lists the copy (at the top: it is a new entry) and focus follows
     * it there. Either way the save is said aloud (review of 2026-10-14).
     */
    const saveGenerated = (entry: ArtifactEntry, file: ConversationFile) =>
        actions.saveGeneratedFile(file.attachment_uuid).then(stored => {
            if (!mounted.current) return;
            const next = savedEntryOf(stored, entry);
            // The chat's `chat.files.changed` may have made it the copy already.
            const open = selectedRef.current;
            if (open && (open.id === entry.id || open.id === next.id)) {
                if (returnTo.current?.id === entry.id) returnTo.current.id = next.id;
                focusDetailAction.current = true;
                setSelected(current => (current && (current.id === entry.id || current.id === next.id) ? next : current));
            } else {
                followSaved.current = { id: next.id, untilRead: appliedReads.current + 1 };
            }
            setList(previous => (previous.status === 'loaded'
                ? { ...previous, items: previous.items.map(item => (item.id === entry.id ? next : item)) }
                : previous));
            setAnnouncement(previous => ({
                text: formatLabel(labels.fileSavedAnnouncement, { title: fileTitle(file) }),
                seq: previous.seq + 1,
            }));
        });

    // Focus after a Save landed (see `saveGenerated`), once the render that
    // removed its button is on screen — only while nothing else has focus.
    useLayoutEffect(() => {
        const follow = followSaved.current;
        if (follow && list.status === 'loaded') {
            const focused = focusRow(listBodyRef.current, follow.id);
            if (appliedReads.current >= follow.untilRead) {
                followSaved.current = null;
                // Gone from this list (the Not saved filter): its search.
                const listed = list.items.some(item => item.id === follow.id);
                if (!focused && !listed && isNothingFocused(document.activeElement)) searchRef.current?.focus();
            }
        }
        if (focusDetailAction.current && selected) {
            focusDetailAction.current = false;
            const first = viewRef.current?.querySelector<HTMLElement>(
                '.cb-artifact-detail-header .cb-files-header-actions button:not(:disabled)'
            );
            if (first && isNothingFocused(document.activeElement)) first.focus();
        }
    });

    /** Back to the chat: the view's close button, and Escape on the list. */
    const leave = useCallback(() => {
        leaveFocus.current = 'entry';
        actions.closeArtifacts();
    }, [actions]);

    const openConversation = (entry: ArtifactEntry) => {
        const conversationId = entry.conversation_uuid;
        leaveFocus.current = 'chat';
        actions.closeArtifacts();
        if (conversationId && conversationId !== activeConversationId) {
            void actions.selectConversation(conversationId);
        }
    };

    const openEntry = (entry: ArtifactEntry) => {
        returnTo.current = { id: entry.id, openedId: entry.id, scrollTop: listBodyRef.current?.scrollTop ?? 0 };
        setSelectedKey(entry.id);
        setSelected(entry);
    };
    const closeEntry = useCallback(() => setSelected(null), []);

    // "Artifacts" chosen again while the view shows (`openArtifacts()`): the
    // list, as it was, with focus in its search — and, from a drawer that has
    // just closed, focus out of it. Until 2026-10-14 nothing happened: an
    // open artifact stayed, and focus stayed in the closed drawer.
    const openingsSeen = useRef(openings);
    const isShowingEntry = useRef(false);
    isShowingEntry.current = selected !== null;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    useEffect(() => {
        if (openings === openingsSeen.current) return;
        openingsSeen.current = openings;
        if (isShowingEntry.current) {
            if (returnTo.current) returnTo.current.focus = 'search';
            setSelected(null);
        } else {
            searchRef.current?.focus();
        }
    }, [openings]);

    // Back on the list: where it was scrolled to, focus on the row the entry
    // was opened from (or the artifact it was saved as) — or on the search,
    // when that row is gone or "Artifacts" was chosen again.
    const showedEntry = useRef(false);
    useLayoutEffect(() => {
        if (selected) {
            showedEntry.current = true;
            return;
        }
        if (!showedEntry.current) return;
        showedEntry.current = false;
        const back = returnTo.current;
        returnTo.current = null;
        const body = listBodyRef.current;
        if (body && back) body.scrollTop = back.scrollTop;
        const row = back && body
            ? Array.from(body.querySelectorAll<HTMLElement>('.cb-file-item'))
                .find(item => item.dataset.entryId === back.id)
            : undefined;
        const rowButton = back?.focus !== 'search' ? row?.querySelector<HTMLElement>('.cb-file-main:not(.is-static)') : null;
        const target = rowButton || searchRef.current;
        target?.focus({ preventScroll: true });
        // The entry was saved meanwhile: focus is on its saved copy, a new
        // entry — at the top, not where the list was scrolled to. Bring it
        // into view (review of 2026-10-14: focus landed on a row off screen).
        if (rowButton && back && back.id !== back.openedId && typeof rowButton.scrollIntoView === 'function') {
            rowButton.scrollIntoView({ block: 'nearest' });
        }
    }, [selected]);

    // Escape steps back — from an entry to the list, from the list to the
    // chat — when it was pressed in the chat: in the view, or in the inline
    // sidebar beside it. Not from the host's page around the chat, whose
    // Escape is its own, nor while another dialog or an overlay sidebar is
    // open, which close on theirs — wherever focus is: on the header's
    // sidebar toggle, or nowhere after a click on a dialog's text. With
    // nothing focused (the row the user deleted is gone) the key belongs
    // where the user last clicked or focused.
    //
    // Until 2026-10-14 the dialog and the drawer were told apart only by
    // where focus was, so with focus elsewhere one Escape closed the drawer
    // or the dialog and left the view as well.
    const escape = useRef<() => void>(() => undefined);
    escape.current = selected ? closeEntry : leave;
    const overlaySidebar = useRef(false);
    overlaySidebar.current = isSidebarOpen && !sidebarInline;
    useEffect(() => {
        // Where the user last was, decided when it happened — by the time a
        // key finds nothing focused, the element they used may have left the
        // page — and the element, for the dialog it is in.
        let lastPlace: Place = 'panel';
        let lastTarget: Element | null = null;
        const notePlace = (event: Event) => {
            lastPlace = placeOf(viewRef.current, event.target);
            lastTarget = event.target instanceof Element ? event.target : null;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            const root = viewRef.current?.closest(CHAT_ROOT) ?? null;
            // `ChatContainer`'s drawer, open over the chat: its Escape.
            if (overlaySidebar.current && root?.querySelector('.cb-drawer-wrapper.open')) return;
            const nothingFocused = isNothingFocused(event.target);
            const place = nothingFocused ? lastPlace : placeOf(viewRef.current, event.target);
            if (place === 'page') return;
            const target = nothingFocused ? lastTarget : event.target instanceof Element ? event.target : null;
            // A dialog the user last clicked in that has since closed (it
            // left the page with the element) no longer holds the key.
            if ((target?.isConnected && target.closest('[aria-modal="true"]')) || modalDialogOpen(root)) return;
            escape.current();
        };
        // Capture for where, so a handler that stops a click cannot hide it;
        // bubble for the key, so a control inside takes its own Escape first.
        document.addEventListener('focusin', notePlace, true);
        document.addEventListener('mousedown', notePlace, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('focusin', notePlace, true);
            document.removeEventListener('mousedown', notePlace, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, []);

    // What an empty list says: the search typed, else the kind chip, else the
    // saved filter — never "your search" when nothing was typed (review of
    // 2026-10-14).
    const emptyText = search
        ? labels.noArtifactResults
        : kind !== null ? labels.noArtifactFilterResults
            : status === 'saved' ? labels.artifactsSavedEmpty
                : status === 'unsaved' ? labels.artifactsUnsavedEmpty
                    : labels.artifactsEmpty;

    /**
     * An entry's actions, on its row and in its full view alike: Save (a
     * generated file nobody saved), download (anything stored), open its
     * conversation, and delete (an artifact — only those can be).
     */
    const entryActions = (entry: ArtifactEntry, title: string) => {
        const file = entry.file;
        const deletable = entry.saved && file !== null && file.is_artifact;
        const confirming = deletable && confirmingDelete === file.attachment_uuid;
        return (
            <>
                {file && !entry.saved && file.source === 'generated' && (
                    <SaveFileButton
                        title={title}
                        onSave={() => saveGenerated(entry, file)}
                        onError={setRowError(entry.id)}
                    />
                )}
                {storage && file && (
                    <DownloadButton
                        file={file}
                        onDownload={target => storage.downloadFile(target)}
                        onError={setRowError(entry.id)}
                    />
                )}
                {entry.conversation_uuid && (
                    <button
                        type="button"
                        className="cb-file-action"
                        onClick={() => openConversation(entry)}
                        aria-label={`${labels.openConversation}: ${entry.conversation_title || entry.conversation_uuid}`}
                        title={labels.openConversation}
                    >
                        {icons.openConversation}
                    </button>
                )}
                {deletable && (
                    <button
                        type="button"
                        className={`cb-file-action cb-file-action-danger${confirming ? ' is-confirming' : ''}`}
                        onClick={() => remove(entry, file)}
                        aria-label={confirming ? labels.confirmDeleteArtifact : `${labels.deleteArtifact}: ${title}`}
                        title={confirming ? labels.confirmDeleteArtifact : labels.deleteArtifact}
                    >
                        {/* Armed: its question in words — and, in a narrow
                            header (Files.css), the icon in a red ring, the
                            words left to its name and tooltip, so the close
                            button stays in the column. */}
                        {confirming ? (
                            <>
                                <span className="cb-file-action-confirm-icon" aria-hidden="true">{icons.delete}</span>
                                <span className="cb-file-action-text">{labels.confirmDeleteArtifact}</span>
                            </>
                        ) : icons.delete}
                    </button>
                )}
            </>
        );
    };

    /** What a block is called: its title, else "Untitled chart". */
    const blockTitle = (entry: ArtifactEntry): string => {
        const language = entry.block?.language ?? '';
        const label = rendererFor(blockRenderers, language)?.label ?? language;
        return entry.title ?? formatLabel(labels.blockUntitled, { label });
    };

    const renderRow = (entry: ArtifactEntry) => {
        const mark = entry.saved ? 'saved' : 'unsaved';
        if (entry.file) {
            const file = entry.file;
            return (
                <FileRow
                    key={entry.id}
                    itemId={entry.id}
                    file={file}
                    mark={mark}
                    // A file nobody saved shows its kind's icon, not itself.
                    thumbnail={entry.saved}
                    // Which conversation first: across conversations, it is
                    // what tells two charts of the same name apart.
                    details={[entry.conversation_title ?? '', ...baseDetails(file).reverse()]}
                    onPreview={() => openEntry(entry)}
                    error={rowErrors[entry.id]}
                    actions={entryActions(entry, fileTitle(file))}
                />
            );
        }
        const title = blockTitle(entry);
        return (
            <ListRow
                key={entry.id}
                itemId={entry.id}
                className="cb-file-item-block"
                // A block nobody saved has no stored picture: its kind's tile.
                picture={<KindThumb kind={entry.kind ?? 'file'} />}
                title={title}
                mark={mark}
                details={[entry.conversation_title ?? '', formatFileDate(entry.created_at)]}
                onOpen={() => openEntry(entry)}
                error={rowErrors[entry.id]}
                actions={entryActions(entry, title)}
            />
        );
    };

    return (
        <section
            ref={viewRef}
            className="cb-artifacts-view cb-artifacts-panel"
            role="region"
            aria-label={labels.artifacts}
        >
            <div className="cb-artifacts-list-pane" hidden={selected !== null}>
                <FilesHeader title={labels.artifacts} titleId={titleId} icon={icons.artifacts} onClose={leave} />
                <div className="cb-files-toolbar">
                    <div className="cb-files-search">
                        <span className="cb-files-search-icon" aria-hidden="true">{icons.search}</span>
                        <input
                            ref={searchRef}
                            type="search"
                            className="cb-files-search-input"
                            placeholder={labels.searchArtifacts}
                            aria-label={labels.searchArtifacts}
                            // The storage API's limit; StorageClient cuts a longer one too.
                            maxLength={MAX_ARTIFACT_SEARCH_CHARS}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                    </div>
                    <div className="cb-files-segmented" role="group" aria-label={labels.artifactStatus}>
                        {STATUS_OPTIONS.map(option => (
                            <button
                                key={option}
                                type="button"
                                className={`cb-files-segment${status === option ? ' is-active' : ''}`}
                                aria-pressed={status === option}
                                onClick={() => setStatus(option)}
                            >
                                {option === 'all'
                                    ? labels.artifactStatusAll
                                    : option === 'saved' ? labels.artifactStatusSaved : labels.artifactStatusUnsaved}
                            </button>
                        ))}
                    </div>
                    {/* Named for what it filters — not "Artifacts", the view's own name. */}
                    <div className="cb-files-chips" role="group" aria-label={labels.artifactKindFilter}>
                        {[null, ...ARTIFACT_KINDS].map(option => (
                            <button
                                key={option ?? 'all'}
                                type="button"
                                className={`cb-files-chip${kind === option ? ' is-active' : ''}`}
                                aria-pressed={kind === option}
                                onClick={() => setKind(option)}
                            >
                                {option ? labels[KIND_LABEL[option]] : labels.artifactKindAll}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="cb-files-body" ref={listBodyRef}>
                    <LiveAnnouncement text={announcement.text} />
                    {list.status === 'loading' && <FilesSkeleton />}
                    {list.status === 'failed' && (
                        <div className="cb-files-state" role="alert">
                            <p>{labels.artifactsLoadFailed}</p>
                            <button type="button" className="cb-files-text-btn" onClick={() => setReload(n => n + 1)}>
                                {labels.retry}
                            </button>
                        </div>
                    )}
                    {list.status === 'loaded' && list.items.length === 0 && (
                        <p className="cb-files-state">{emptyText}</p>
                    )}
                    {list.status === 'loaded' && list.items.length > 0 && (
                        <>
                            <ul className="cb-files-list">
                                {list.items.map(renderRow)}
                            </ul>
                            {list.hasMore && (
                                <button
                                    type="button"
                                    className="cb-files-load-more"
                                    onClick={loadMore}
                                    disabled={isLoadingMore}
                                >
                                    {isLoadingMore ? labels.loading : labels.loadMore}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
            {selected && selected.type === 'block' && selected.block && (
                <BlockDetail
                    key={selected.block.uuid}
                    entry={selected}
                    title={blockTitle(selected)}
                    onBack={closeEntry}
                    onClose={leave}
                    actions={entryActions(selected, blockTitle(selected))}
                    error={rowErrors[selected.id]}
                />
            )}
            {selected && selected.type === 'file' && selected.file && (
                <FileDetail
                    key={selectedKey ?? selected.id}
                    entry={selected}
                    file={selected.file}
                    onBack={closeEntry}
                    onClose={leave}
                    actions={entryActions(selected, fileTitle(selected.file))}
                    error={rowErrors[selected.id]}
                />
            )}
        </section>
    );
};

/**
 * What an entry open in full shares: "Back to artifacts" at the start of its
 * header, its kind and title, its Saved / Not saved mark and its actions, and
 * the close button last; below, its conversation, date and size, a failed
 * action's message, then `children` — the file, or the block drawn live.
 */
const EntryDetail: React.FC<{
    entry: ArtifactEntry;
    title: string;
    details: string[];
    onBack: () => void;
    onClose: () => void;
    actions: React.ReactNode;
    error?: string | null;
    className?: string;
    children: React.ReactNode;
}> = ({ entry, title, details, onBack, onClose, actions, error, className = '', children }) => {
    const labels = useLabels();
    const icons = useIcons();
    const titleRef = useRef<HTMLHeadingElement>(null);
    const shown = details.filter(Boolean);

    // Focus on its title, so a screen reader says which artifact this is.
    useEffect(() => {
        titleRef.current?.focus();
    }, []);

    return (
        <div className={`cb-artifact-detail ${className}`}>
            <FilesHeader
                className="cb-artifact-detail-header"
                start={(
                    <button
                        type="button"
                        className="cb-files-icon-btn cb-artifact-back"
                        onClick={onBack}
                        aria-label={labels.backToArtifacts}
                        title={labels.backToArtifacts}
                    >
                        {icons.back}
                    </button>
                )}
                icon={icons[KIND_ICON[entry.kind ?? 'file']]}
                title={title}
                titleRef={titleRef}
                focusableTitle
                actions={(
                    <>
                        <SavedMark state={entry.saved ? 'saved' : 'unsaved'} className="cb-artifact-detail-status" />
                        {actions}
                    </>
                )}
                onClose={onClose}
            />
            {shown.length > 0 && (
                <p className="cb-artifact-detail-meta">
                    <span className="cb-artifact-detail-meta-text" dir="auto">{shown.join(' · ')}</span>
                </p>
            )}
            {error && <p className="cb-file-error cb-artifact-detail-error" role="alert">{error}</p>}
            <div className="cb-artifact-detail-body">{children}</div>
        </div>
    );
};

/**
 * A stored file in full, in the column the list was in — a saved artifact,
 * or a generated file nobody saved (with Save among its actions): the
 * attachment viewer's rendering without its lightbox — an image as wide as
 * the column, a PDF a page at a time at the column's width, a CSV as a
 * table, text as text, anything else as a card with a download.
 */
const FileDetail: React.FC<{
    entry: ArtifactEntry;
    file: ConversationFile;
    onBack: () => void;
    onClose: () => void;
    actions: React.ReactNode;
    error?: string | null;
}> = ({ entry, file, onBack, onClose, actions, error }) => {
    // The file first shown: a Save makes `file` the saved copy (another uuid,
    // the same bytes), which must not download it again.
    const [shownFile] = useState(file);
    const attachment = useMemo(() => toAttachment(shownFile), [shownFile]);
    const load = useAttachmentLoad(attachment, true);
    return (
        <EntryDetail
            entry={entry}
            title={fileTitle(file)}
            details={[entry.conversation_title ?? '', ...baseDetails(file).reverse()]}
            onBack={onBack}
            onClose={onClose}
            actions={actions}
            error={error}
        >
            <AttachmentPreview attachment={attachment} load={load} inline />
        </EntryDetail>
    );
};

type BlockLoad =
    | { status: 'loading' }
    | { status: 'failed' }
    | { status: 'loaded'; block: BlockWithSource };

/**
 * A block nobody saved, **drawn live** in the column by the host's renderer —
 * expanded, not streaming, against its turn (`turn_job_uuid`) and its
 * conversation — from the body the platform indexed (`getBlock`). Its own
 * Save saves it; the view then marks it Saved. A language this page has no
 * renderer for shows its source instead.
 */
const BlockDetail: React.FC<{
    entry: ArtifactEntry;
    title: string;
    onBack: () => void;
    onClose: () => void;
    actions: React.ReactNode;
    error?: string | null;
}> = ({ entry, title, onBack, onClose, actions, error }) => {
    const storage = useChatState(s => s.storageClient);
    const labels = useLabels();
    const { blockRenderers } = useMarkdownConfig();
    const record = entry.block!;
    const [load, setLoad] = useState<BlockLoad>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!storage) {
            setLoad({ status: 'failed' });
            return undefined;
        }
        let cancelled = false;
        setLoad({ status: 'loading' });
        storage.getBlock(record.uuid).then(
            block => {
                if (!cancelled) setLoad({ status: 'loaded', block });
            },
            () => {
                if (!cancelled) setLoad({ status: 'failed' });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [storage, record.uuid, attempt]);

    const renderer = rendererFor(blockRenderers, record.language);
    const label = renderer?.label ?? record.language;

    let body: React.ReactNode;
    if (load.status === 'loading') {
        body = <FilesSkeleton />;
    } else if (load.status === 'failed') {
        body = (
            <div className="cb-files-state" role="alert">
                <p>{labels.blockLoadFailed}</p>
                <button type="button" className="cb-files-text-btn" onClick={() => setAttempt(n => n + 1)}>
                    {labels.retry}
                </button>
            </div>
        );
    } else if (!renderer) {
        body = (
            <div className="cb-artifact-detail-unrenderable">
                <p className="cb-files-state">{formatLabel(labels.blockNoRenderer, { label })}</p>
                <details className="cb-md-block-source">
                    <summary>{labels.blockShowSource}</summary>
                    <pre dir="ltr"><code>{load.block.source}</code></pre>
                </details>
            </div>
        );
    } else {
        body = (
            <ExpandedBlock
                language={load.block.language}
                source={load.block.source}
                renderer={renderer}
                // Saved against the turn, whichever job of it drew the block.
                jobUuid={load.block.turn_job_uuid}
                conversationId={load.block.conversation_uuid}
            />
        );
    }

    return (
        <EntryDetail
            entry={entry}
            title={title}
            details={[entry.conversation_title ?? '', formatFileDate(entry.created_at)]}
            onBack={onBack}
            onClose={onClose}
            actions={actions}
            error={error}
            className="cb-artifact-detail-live"
        >
            {body}
        </EntryDetail>
    );
};
