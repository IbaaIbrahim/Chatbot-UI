import React from 'react';
import './Files.css';
import type { ArtifactKind, ConversationFile } from '../../api/types';
import { isNothingFocused, trapTab } from '../../common/focusTrap';
import type { ChatIcons } from '../../common/icons';
import type { ChatLabels } from '../../common/labels';
import { useStableId } from '../../common/useStableId';
import { useAuthenticatedFetch, useIcons, useLabels } from '../../store/hooks';
import { AttachmentViewerModal, formatFileSize, inferContentType, type Attachment } from '../AttachmentViewer/AttachmentViewer';

const { useEffect, useLayoutEffect, useRef, useState } = React;

/**
 * What the conversation files panel and the Artifacts view share: the header,
 * the panel, a file's row, its icon and words, and the preview.
 */

export const KIND_ICON = {
    chart: 'artifactChart',
    table: 'artifactTable',
    kpi: 'artifactKpi',
    report: 'artifactReport',
    file: 'artifactFile',
} as const satisfies Record<ArtifactKind, keyof ChatIcons>;

export const KIND_LABEL = {
    chart: 'artifactKindChart',
    table: 'artifactKindTable',
    kpi: 'artifactKindKpi',
    report: 'artifactKindReport',
    file: 'artifactKindFile',
} as const satisfies Record<ArtifactKind, keyof ChatLabels>;

/**
 * What a row shows itself as (2026-10-14): an artifact's kind — or, for a
 * plain file, its type: an image, a PDF, a spreadsheet, or any other file.
 * Its tile is tinted by it (`data-kind`, the `--cb-kind-*` tokens).
 */
export type RowKind = ArtifactKind | 'image' | 'pdf' | 'spreadsheet';

export const ROW_KIND_ICON = {
    ...KIND_ICON,
    image: 'fileImage',
    pdf: 'filePdf',
    spreadsheet: 'fileSpreadsheet',
} as const satisfies Record<RowKind, keyof ChatIcons>;

/** A row's kind in its details line: singular ("Chart"), where the filter chips' are plural. */
export const ROW_KIND_LABEL = {
    chart: 'itemKindChart',
    table: 'itemKindTable',
    kpi: 'itemKindKpi',
    report: 'itemKindReport',
    file: 'itemKindFile',
    image: 'itemKindImage',
    pdf: 'itemKindPdf',
    spreadsheet: 'itemKindSpreadsheet',
} as const satisfies Record<RowKind, keyof ChatLabels>;

const SPREADSHEET_TYPES = new Set([
    'text/csv',
    'text/tab-separated-values',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.spreadsheet',
]);

/** A file's kind: a chart, table, KPI card or report it was saved as, else what its type says. */
export function rowKindOf(file: ConversationFile): RowKind {
    if (file.artifact_kind && file.artifact_kind !== 'file') return file.artifact_kind;
    const contentType = inferContentType(file.filename, file.content_type);
    if (contentType.startsWith('image/')) return 'image';
    if (contentType === 'application/pdf') return 'pdf';
    if (SPREADSHEET_TYPES.has(contentType) || /\.(csv|tsv|xlsx?|xlsm|ods)$/i.test(file.filename)) return 'spreadsheet';
    return 'file';
}

/** The page's language when it states one, so dates read like the rest of the page. */
function pageLocale(): string | undefined {
    return typeof document !== 'undefined' && document.documentElement.lang ? document.documentElement.lang : undefined;
}

export function formatFileDate(iso: string): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    return new Date(time).toLocaleString(pageLocale(), {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * When, as a row of the files panel says it (2026-10-14): relative within
 * the week ("now", "5 minutes ago", "yesterday") in the page's language, a
 * short date after ("Oct 13"; with the year when it is not this one). `''`
 * for no date. A date ahead of the clock (a skewed one) reads as now.
 * Whole units elapsed, rounded down: 59.6 minutes is "59 minutes ago", never
 * "60 minutes ago" where "1 hour ago" comes next, and 23.7 hours "23 hours
 * ago" before "yesterday" (rounded, until the review of 2026-10-14).
 */
export function formatRelativeDate(iso: string, now: number = Date.now()): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    const locale = pageLocale();
    const elapsed = Math.max(0, now - time);
    if (elapsed < 7 * DAY_MS && typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
        try {
            const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
            if (elapsed < MINUTE_MS) return relative.format(0, 'second');
            if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
            if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');
            return relative.format(-Math.floor(elapsed / DAY_MS), 'day');
        } catch {
            // A language the engine cannot format in: the short date below.
        }
    }
    const date = new Date(time);
    try {
        return date.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
        });
    } catch {
        return date.toLocaleDateString();
    }
}

/** What a file is called on screen: its title, else its name. */
export function fileTitle(file: ConversationFile): string {
    return file.title || file.filename;
}

/** The file as the attachment viewer takes it. */
export function toAttachment(file: ConversationFile): Attachment {
    const contentType = inferContentType(file.filename, file.content_type);
    return {
        id: file.attachment_uuid,
        type: contentType.startsWith('image/') ? 'image' : 'file',
        url: file.download_url,
        name: file.filename,
        size: file.size_bytes,
        contentType,
    };
}

/**
 * How long after a turn ends the files panel and the Artifacts view read
 * their lists again. The platform indexes a turn's blocks once the turn has
 * ended, a moment after the stream says so (2026-10-14); these reads pick up
 * its rows.
 */
export const TURN_END_REREAD_MS: readonly number[] = [1500, 5000];

/** Calls `onRead` a little after each turn ends — see {@link TURN_END_REREAD_MS}. */
export function useReadAfterTurnEnds(isThinking: boolean, onRead: () => void): void {
    const wasThinking = useRef(isThinking);
    const latest = useRef(onRead);
    latest.current = onRead;
    useEffect(() => {
        const ended = wasThinking.current && !isThinking;
        wasThinking.current = isThinking;
        if (!ended) return undefined;
        const timers = TURN_END_REREAD_MS.map(delay => window.setTimeout(() => latest.current(), delay));
        return () => timers.forEach(timer => window.clearTimeout(timer));
    }, [isThinking]);
}

/** The chat a panel or view belongs to: `ChatContainer`'s frame, or a host layout's `ChatRoot`. */
export const CHAT_ROOT = '.cb-chat-container, .cb-root';

/** Where a key or a click happened, as a panel or view sees it: in it, elsewhere in the chat, or on the host's page. */
export type Place = 'panel' | 'chat' | 'page';

/** Where `target` is relative to `element` and the chat around it. */
export function placeOf(element: HTMLElement | null, target: EventTarget | null): Place {
    if (!element || !(target instanceof Node)) return 'page';
    if (element.contains(target)) return 'panel';
    return element.closest(CHAT_ROOT)?.contains(target) ? 'chat' : 'page';
}

/**
 * The header of the files panel and of the Artifacts view: an optional
 * control before the title (the artifact's "Back"), the icon and the title,
 * the actions, and the close button — always last, after every action. In a
 * right-to-left page that is the left end, as the row follows the page's
 * direction.
 */
export const FilesHeader: React.FC<{
    title: string;
    titleId?: string;
    icon?: React.ReactNode;
    /**
     * A line under the title (the files panel's: its conversation and how
     * many items it has). The title and it are then one block.
     */
    subtitle?: React.ReactNode;
    subtitleId?: string;
    /** Before the icon and the title. */
    start?: React.ReactNode;
    /** After the title, before the close button. */
    actions?: React.ReactNode;
    /** No close button without one. */
    onClose?: () => void;
    closeRef?: React.Ref<HTMLButtonElement>;
    titleRef?: React.Ref<HTMLHeadingElement>;
    /** The title takes focus when the view moves it there (it is not a Tab stop). */
    focusableTitle?: boolean;
    className?: string;
}> = ({ title, titleId, icon, subtitle, subtitleId, start, actions, onClose, closeRef, titleRef, focusableTitle = false, className = '' }) => {
    const labels = useLabels();
    const icons = useIcons();
    const heading = (
        <h2
            id={titleId}
            ref={titleRef}
            className="cb-files-title"
            title={title}
            tabIndex={focusableTitle ? -1 : undefined}
        >
            {/* Its own direction on the text alone — on the heading, an
                English title in a right-to-left page would sit at the far
                end of the row, away from its icon — and on the box that
                cuts it short, so a long title loses its end, not its
                start (Files.css, "The header"). */}
            <span className="cb-files-title-text" dir="auto">{title}</span>
        </h2>
    );
    return (
        <header className={`cb-files-header ${className}`}>
            {start}
            {icon && <span className="cb-files-header-icon" aria-hidden="true">{icon}</span>}
            {subtitle ? (
                <div className="cb-files-heading">
                    {heading}
                    <p className="cb-files-subtitle" id={subtitleId}>{subtitle}</p>
                </div>
            ) : heading}
            {actions && <span className="cb-files-header-actions">{actions}</span>}
            {onClose && (
                <button
                    ref={closeRef}
                    type="button"
                    className="cb-files-icon-btn cb-files-close"
                    onClick={onClose}
                    aria-label={labels.close}
                    title={labels.close}
                >
                    {icons.close}
                </button>
            )}
        </header>
    );
};

/**
 * A panel over the chat: the conversation's files.
 *
 * Its scrim covers the chat column it is rendered in (`position: absolute`
 * against the nearest positioned ancestor — `ChatContainer`'s content
 * column), as the credit usage dialog covers the container. On it, a dialog
 * sized to its content (2026-10-14): centred, rounded, as tall as its list up
 * to a cap, the list scrolling under a fixed header and toolbar; in a narrow
 * chat (the floating card, a docked panel) a sheet at the bottom with small
 * margins. Until then it was a full-height sheet whatever it held — an empty
 * conversation was one grey line at the top of a column of white. A modal
 * dialog over the chat: Tab stays inside it, the scrim closes it, and focus
 * goes back where it was.
 *
 * Escape closes it from anywhere in the chat — the panel, or the inline
 * sidebar beside it — but not from the host's page around the chat, whose
 * Escape is its own. With nothing focused (the row the user deleted is gone)
 * the key belongs where the user last clicked or focused.
 *
 * Until 2026-10-14 it claimed `aria-modal` without keeping Tab inside, and
 * any Escape on the page closed it, wherever focus was. The artifacts list
 * used it too until then; it is now a view in place of the chat
 * (`ArtifactsPanel`), not a dialog over it.
 */
export const FilesPanelShell: React.FC<{
    title: string;
    icon: React.ReactNode;
    /** A line under the title; it also describes the dialog (`aria-describedby`). */
    subtitle?: React.ReactNode;
    onClose: () => void;
    /** Under the title: search, filters. */
    toolbar?: React.ReactNode;
    /** What gets focus on opening; the close button without one. */
    initialFocusRef?: React.RefObject<HTMLElement>;
    className?: string;
    children: React.ReactNode;
}> = ({ title, icon, subtitle, onClose, toolbar, initialFocusRef, className = '', children }) => {
    const titleId = useStableId('cb-files-title');
    const subtitleId = useStableId('cb-files-subtitle');
    const closeRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLElement>(null);
    const latestOnClose = useRef(onClose);
    latestOnClose.current = onClose;

    useEffect(() => {
        const previous = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
        (initialFocusRef?.current ?? closeRef.current)?.focus();

        // Where the user last was, decided when it happened: by the time a key
        // finds nothing focused, the element they used may have left the page.
        let lastPlace: Place = 'panel';
        const notePlace = (event: Event) => {
            lastPlace = placeOf(panelRef.current, event.target);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            const place = isNothingFocused(event.target) ? lastPlace : placeOf(panelRef.current, event.target);
            if (event.key === 'Escape' && place !== 'page') {
                latestOnClose.current();
            } else if (event.key === 'Tab' && place === 'panel') {
                trapTab(event, panelRef.current);
            }
        };
        // Capture for where, so a handler that stops a click cannot hide it;
        // bubble for the keys, so a menu or the viewer inside takes its own
        // Escape first.
        document.addEventListener('focusin', notePlace, true);
        document.addEventListener('mousedown', notePlace, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('focusin', notePlace, true);
            document.removeEventListener('mousedown', notePlace, true);
            document.removeEventListener('keydown', onKeyDown);
            if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
        };
    }, [initialFocusRef]);

    return (
        <div
            className="cb-files-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={panelRef}
                className={`cb-files-panel ${className}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={subtitle ? subtitleId : undefined}
                // Focusable, though not a Tab stop, so a click on its empty
                // space keeps focus in the panel rather than on the page.
                tabIndex={-1}
            >
                <FilesHeader
                    title={title}
                    titleId={titleId}
                    icon={icon}
                    subtitle={subtitle}
                    subtitleId={subtitleId}
                    onClose={onClose}
                    closeRef={closeRef}
                />
                {toolbar && <div className="cb-files-toolbar">{toolbar}</div>}
                <div className="cb-files-body">{children}</div>
            </section>
        </div>
    );
};

/**
 * The largest image drawn as its own thumbnail. A thumbnail is the whole file
 * — the storage API has no smaller rendition — so a photo of several MB shows
 * the kind's icon instead; a saved chart (a PNG of tens of KB) shows itself.
 */
export const THUMBNAIL_MAX_BYTES = 1024 * 1024;

/** How many thumbnails are fetched at once, however many rows a list has. */
const THUMBNAIL_CONCURRENCY = 3;

/**
 * A queue that runs at most `limit` tasks at a time. A task whose row has gone
 * by the time its turn comes is skipped (`isWanted`), so scrolling past a long
 * list does not leave a backlog of fetches nobody will see.
 */
function createLimiter(limit: number) {
    let running = 0;
    const queue: Array<() => void> = [];
    const next = () => {
        if (running >= limit) return;
        const start = queue.shift();
        if (start) start();
    };
    return function schedule<T>(task: () => Promise<T>, isWanted: () => boolean): Promise<T | undefined> {
        return new Promise<T | undefined>((resolve, reject) => {
            queue.push(() => {
                if (!isWanted()) {
                    resolve(undefined);
                    next();
                    return;
                }
                running += 1;
                // Through a promise, so a task that throws at once still frees its slot.
                Promise.resolve().then(task).then(resolve, reject).finally(() => {
                    running -= 1;
                    next();
                });
            });
            next();
        });
    };
}

const scheduleThumbnail = createLimiter(THUMBNAIL_CONCURRENCY);

/** Becomes `true` once the element has come near the visible area, and stays so. */
function useNearViewport(ref: React.RefObject<HTMLElement>): boolean {
    const [near, setNear] = useState(false);
    useEffect(() => {
        const element = ref.current;
        if (near || !element) return undefined;
        // Without IntersectionObserver (old engines, tests) every row is "near".
        if (typeof IntersectionObserver === 'undefined') {
            setNear(true);
            return undefined;
        }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) {
                setNear(true);
                observer.disconnect();
            }
        }, { rootMargin: '120px 0px' });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, near]);
    return near;
}

/**
 * An image file's thumbnail, fetched with the user's token — but only once
 * its row comes near the visible part of the list, a few at a time, and from
 * the provider's cache when it is already there. The kind's icon stands in
 * until then, and if it fails.
 *
 * Until 2026-10-14 every image row fetched its whole file as soon as the list
 * mounted, all at once: a conversation with many saved charts, or a few pages
 * of artifacts, sent one storage request per image and held every blob.
 */
const ThumbnailImage: React.FC<{ src: string; fallback: React.ReactNode }> = ({ src, fallback }) => {
    const fetchAuthenticatedUrl = useAuthenticatedFetch();
    const holderRef = useRef<HTMLSpanElement>(null);
    const near = useNearViewport(holderRef);
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!near || !fetchAuthenticatedUrl) return undefined;
        let wanted = true;
        setFailed(false);
        scheduleThumbnail(() => fetchAuthenticatedUrl(src), () => wanted).then(
            url => {
                if (wanted && url) setImageSrc(url);
            },
            () => {
                if (wanted) setFailed(true);
            }
        );
        return () => {
            wanted = false;
        };
    }, [near, src, fetchAuthenticatedUrl]);

    return (
        <span ref={holderRef} className="cb-file-thumb-image">
            {imageSrc && !failed
                ? <img src={imageSrc} alt="" decoding="async" onError={() => setFailed(true)} />
                : fallback}
        </span>
    );
};

/**
 * A row's tile: its kind's icon on a tile tinted by the kind (`data-kind`,
 * Files.css "Rows"), or `children` — an image's thumbnail — in its place.
 */
export const KindThumb: React.FC<{ kind: RowKind; children?: React.ReactNode }> = ({ kind, children }) => {
    const icons = useIcons();
    return (
        <span className={`cb-file-thumb${children ? ' has-image' : ''}`} data-kind={kind} aria-hidden="true">
            {children ?? icons[ROW_KIND_ICON[kind]]}
        </span>
    );
};

/**
 * The row's picture: the image itself for a small image, the kind's icon
 * otherwise — and always the icon with `thumbnail={false}` (a file nobody
 * saved, in the Artifacts list). A plain file's icon says its type (image,
 * PDF, spreadsheet) since 2026-10-14.
 */
const FileThumb: React.FC<{ file: ConversationFile; thumbnail?: boolean }> = ({ file, thumbnail = true }) => {
    const icons = useIcons();
    const contentType = inferContentType(file.filename, file.content_type);
    const kind = rowKindOf(file);
    // `size_bytes` is 0 when the server did not say; such an image is tried.
    const drawable = thumbnail
        && contentType.startsWith('image/')
        && contentType !== 'image/svg+xml'
        && file.size_bytes <= THUMBNAIL_MAX_BYTES;
    if (drawable) {
        return (
            <KindThumb kind={kind}>
                <ThumbnailImage src={file.download_url} fallback={icons[ROW_KIND_ICON[kind]]} />
            </KindThumb>
        );
    }
    return <KindThumb kind={kind} />;
};

/** Whether a row is kept: `saved`, `unsaved`, or neither (an upload). */
export type SavedState = 'saved' | 'unsaved' | null;

/**
 * The Saved / Not saved mark (2026-10-14): an icon and the word, so it reads
 * without colour and is spoken as part of the row. On every artifact-like
 * row — a drawn block, a generated file, an artifact — and on none of the
 * user's own uploads.
 */
export const SavedMark: React.FC<{ state: 'saved' | 'unsaved'; className?: string }> = ({ state, className = '' }) => {
    const labels = useLabels();
    const icons = useIcons();
    const saved = state === 'saved';
    return (
        <span className={`cb-file-status ${saved ? 'is-saved' : 'is-unsaved'} ${className}`}>
            <span className="cb-file-status-icon" aria-hidden="true">{saved ? icons.saved : icons.notSaved}</span>
            <span className="cb-file-status-text">{saved ? labels.savedBadge : labels.notSavedBadge}</span>
        </span>
    );
};

/**
 * A polite live region, visually hidden: what a list says when a Save from
 * a row lands ("Saved: Q3 report") — the button the user pressed is gone by
 * then (review of 2026-10-14). Rendered from the start, empty, so the first
 * message is announced.
 */
export const LiveAnnouncement: React.FC<{ text: string }> = ({ text }) => (
    <span className="cb-files-announce" role="status" aria-live="polite">{text}</span>
);

/** Where focus goes once a row's Save has removed the button: the row itself, when nothing else took it. */
export function focusRow(container: Element | null, itemId: string): boolean {
    if (!container || typeof document === 'undefined' || !isNothingFocused(document.activeElement)) return false;
    const row = Array.from(container.querySelectorAll<HTMLElement>('.cb-file-item'))
        .find(item => item.dataset.entryId === itemId);
    const main = row?.querySelector<HTMLElement>('.cb-file-main:not(.is-static)');
    if (!main) return false;
    main.focus({ preventScroll: true });
    if (typeof main.scrollIntoView === 'function') main.scrollIntoView({ block: 'nearest' });
    return true;
}

/**
 * One row of a list: its picture, title, Saved / Not saved mark and details,
 * opening it when chosen, with `actions` beside it. A row with nothing to
 * open (a block this page cannot draw) shows the same, not as a button.
 */
export const ListRow: React.FC<{
    /** What the list knows the row by — focus goes back to it by this. */
    itemId: string;
    picture: React.ReactNode;
    title: string;
    mark?: SavedState;
    /** The details line after the mark: kind, size, date, conversation. */
    details: string[];
    /** The details line's tooltip: the full date behind a relative one. */
    detailsTitle?: string;
    onOpen?: (opener: HTMLButtonElement) => void;
    /** The open button's tooltip and the first half of its name. */
    openLabel?: string;
    /** The row is opening (fetching what it shows). */
    busy?: boolean;
    actions?: React.ReactNode;
    error?: string | null;
    /** For a file's row: its uuid, as `data-attachment-uuid`. */
    attachmentUuid?: string;
    className?: string;
}> = ({ itemId, picture, title, mark = null, details, detailsTitle, onOpen, openLabel, busy = false, actions, error, attachmentUuid, className = '' }) => {
    const labels = useLabels();
    const parts = details.filter(Boolean);
    const text = (
        <>
            {picture}
            <span className="cb-file-text">
                <span className="cb-file-title" dir="auto">{title}</span>
                <span className="cb-file-meta">
                    {mark && <SavedMark state={mark} />}
                    {/* "Spreadsheet · Generated · 5 minutes ago · 2.0 KB": each part
                        unbroken, with the dot after it, so where the line may wrap
                        (a narrow files dialog, Files.css) it breaks between parts. */}
                    <span className="cb-file-meta-text" dir="auto" title={detailsTitle || undefined}>
                        {parts.map((part, index) => (
                            <React.Fragment key={index}>
                                {index > 0 && ' '}
                                <span className="cb-file-meta-part">{index < parts.length - 1 ? `${part} ·` : part}</span>
                            </React.Fragment>
                        ))}
                    </span>
                </span>
            </span>
        </>
    );
    return (
        <li className={`cb-file-item ${className}`} data-entry-id={itemId} data-attachment-uuid={attachmentUuid}>
            <div className="cb-file-row">
                {onOpen ? (
                    <button
                        type="button"
                        className="cb-file-main"
                        onClick={event => onOpen(event.currentTarget)}
                        title={`${openLabel ?? labels.previewFile}: ${title}`}
                        aria-busy={busy || undefined}
                    >
                        {text}
                        {busy && <span className="cb-files-spinner cb-file-main-spinner" aria-hidden="true" />}
                    </button>
                ) : (
                    <div className="cb-file-main is-static">{text}</div>
                )}
                {actions && <span className="cb-file-actions">{actions}</span>}
            </div>
            {error && <p className="cb-file-error" role="alert">{error}</p>}
        </li>
    );
};

/**
 * One file: its picture, title, mark and details, opening it when chosen —
 * the preview, or the artifact in full — with `actions` beside it (download,
 * save, open, delete).
 */
export const FileRow: React.FC<{
    file: ConversationFile;
    /** The details line after the mark: size, date, conversation. */
    details: string[];
    /** The details line's tooltip. */
    detailsTitle?: string;
    onPreview: (file: ConversationFile) => void;
    actions: React.ReactNode;
    error?: string | null;
    /** Saved / Not saved; none for an upload. Defaults to what the file says. */
    mark?: SavedState;
    /** What the list knows the row by; the file's uuid by default. */
    itemId?: string;
    /** Draw a small image as itself. Default `true`. */
    thumbnail?: boolean;
}> = ({ file, details, detailsTitle, onPreview, actions, error, mark, itemId, thumbnail = true }) => (
    <ListRow
        itemId={itemId ?? file.attachment_uuid}
        attachmentUuid={file.attachment_uuid}
        picture={<FileThumb file={file} thumbnail={thumbnail} />}
        title={fileTitle(file)}
        mark={mark === undefined ? savedStateOf(file) : mark}
        details={details}
        detailsTitle={detailsTitle}
        onOpen={() => onPreview(file)}
        actions={actions}
        error={error}
    />
);

/** A file's mark: an upload has none; an artifact is saved; a generated file is saved once a copy of it is. */
export function savedStateOf(file: ConversationFile): SavedState {
    if (file.is_artifact || file.source === 'artifact') return 'saved';
    if (file.source === 'generated') return file.saved ? 'saved' : 'unsaved';
    return null;
}

/**
 * A not-saved generated file's Save: keeps it as an artifact
 * (`saveGeneratedFile`), saying beside the row when it failed. Its row then
 * shows "Saved".
 */
export const SaveFileButton: React.FC<{
    title: string;
    onSave: () => Promise<unknown>;
    onError: (message: string | null) => void;
}> = ({ title, onSave, onError }) => {
    const labels = useLabels();
    const icons = useIcons();
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    return (
        <button
            type="button"
            className="cb-file-action cb-file-action-save"
            disabled={busy}
            aria-label={`${labels.saveFile}: ${title}`}
            title={labels.saveFile}
            onClick={() => {
                setBusy(true);
                onError(null);
                onSave()
                    .catch(() => onError(labels.saveFileFailed))
                    .finally(() => {
                        if (mounted.current) setBusy(false);
                    });
            }}
        >
            {busy ? <span className="cb-files-spinner" aria-hidden="true" /> : icons.save}
            <span className="cb-file-action-text">{labels.saveFile}</span>
        </button>
    );
};

/**
 * The details every row starts with: the size and when. The kind is not
 * repeated here — the row's picture is the chart itself, or the kind's icon.
 */
export function baseDetails(file: ConversationFile): string[] {
    return [
        file.size_bytes > 0 ? formatFileSize(file.size_bytes) : '',
        formatFileDate(file.created_at),
    ];
}

/** A download button that says when it failed, beside the row. */
export const DownloadButton: React.FC<{
    file: ConversationFile;
    onDownload: (file: ConversationFile) => Promise<void>;
    onError: (message: string | null) => void;
}> = ({ file, onDownload, onError }) => {
    const labels = useLabels();
    const icons = useIcons();
    const [busy, setBusy] = useState(false);
    const mounted = useRef(true);
    useEffect(() => () => {
        mounted.current = false;
    }, []);
    return (
        <button
            type="button"
            className="cb-file-action"
            disabled={busy}
            aria-label={`${labels.downloadFile}: ${fileTitle(file)}`}
            title={labels.downloadFile}
            onClick={() => {
                setBusy(true);
                onError(null);
                onDownload(file)
                    .catch(() => onError(labels.downloadFailed))
                    .finally(() => {
                        if (mounted.current) setBusy(false);
                    });
            }}
        >
            {busy ? <span className="cb-files-spinner" aria-hidden="true" /> : icons.download}
        </button>
    );
};

/**
 * The preview, for whichever file was chosen. Closing it puts focus back on
 * the row it was opened from — the viewer is a portal outside the panel, and
 * focus left on its removed button would leave the panel's Tab and Escape
 * with nothing to go by.
 */
export const FilePreview: React.FC<{ file: ConversationFile | null; onClose: () => void }> = ({ file, onClose }) => {
    const attachment = React.useMemo(() => (file ? toAttachment(file) : null), [file]);
    // A layout effect, so it reads the row's button before the viewer's own
    // effect moves focus to its close button.
    useLayoutEffect(() => {
        if (!file || typeof document === 'undefined') return undefined;
        const opener = document.activeElement as HTMLElement | null;
        return () => {
            if (opener && opener !== document.body && opener.isConnected && typeof opener.focus === 'function') {
                opener.focus();
            }
        };
    }, [file]);
    return <AttachmentViewerModal attachment={attachment} isOpen={Boolean(attachment)} onClose={onClose} />;
};

/**
 * Placeholder rows while a list loads: three bars — or, `variant="rows"`
 * (the files panel, 2026-10-14), `count` rows shaped as the list's: a tile
 * and two lines.
 */
export const FilesSkeleton: React.FC<{ variant?: 'bars' | 'rows'; count?: number }> = ({ variant = 'bars', count = 3 }) => {
    const labels = useLabels();
    const rows = Array.from({ length: count }, (_, index) => index);
    if (variant === 'rows') {
        return (
            <div className="cb-files-skeleton is-rows" role="status" aria-label={labels.loading}>
                {rows.map(index => (
                    <span key={index} className="cb-files-skeleton-item">
                        <span className="cb-files-skeleton-tile" />
                        <span className="cb-files-skeleton-lines">
                            <span className="cb-files-skeleton-line" />
                            <span className="cb-files-skeleton-line is-short" />
                        </span>
                    </span>
                ))}
            </div>
        );
    }
    return (
        <div className="cb-files-skeleton" role="status" aria-label={labels.loading}>
            {rows.map(index => <span key={index} className="cb-files-skeleton-row" />)}
        </div>
    );
};
