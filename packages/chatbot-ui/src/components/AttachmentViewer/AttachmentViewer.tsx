import React from 'react';
import ReactDOM from 'react-dom';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import './AttachmentViewer.css';
import { netFetch } from '../../common/localNetwork';
import { formatLabel } from '../../common/labels';
import { useAuthenticatedFetch, useIcons, useLabels } from '../../store/hooks';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const { useEffect, useRef, useState } = React;

/**
 * The attachment viewer, shared by the files a user attached to a message and
 * the conversation's files and artifacts panels (4.1). It was part of
 * MessageBubble until the panels needed the same viewer; the behaviour for a
 * message's attachment is unchanged apart from the download button, which is
 * now in the toolbar for every type instead of only for files it cannot show.
 *
 * Since 2026-10-14 its parts are separate: `useAttachmentLoad` fetches the
 * file, `AttachmentPreview` draws it, and `AttachmentViewerModal` is the
 * lightbox around the two. An artifact opened in the Artifacts view uses the
 * first two in place, without the lightbox.
 */

/** One file the viewer can show. `url` is fetched with the session's credentials. */
export interface Attachment {
    id: string;
    type: 'image' | 'file';
    url: string;
    name?: string;
    size?: number;
    contentType?: string;
    localUrl?: string;
}

const SPREADSHEET_TYPES = new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
]);

/** Rows and columns a CSV preview shows; the file itself is the download. */
const CSV_PREVIEW_ROWS = 50;
const CSV_PREVIEW_COLUMNS = 20;

export const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getFileIcon = (contentType?: string): string => {
    if (!contentType) return '\u{1F4CE}';
    if (contentType.startsWith('image/')) return '\u{1F5BC}\u{FE0F}';
    if (contentType === 'application/pdf') return '\u{1F4C4}';
    if (contentType === 'text/csv' || SPREADSHEET_TYPES.has(contentType)) return '\u{1F4CA}';
    if (contentType.startsWith('text/')) return '\u{1F4DD}';
    return '\u{1F4CE}';
};

export const inferContentType = (filename?: string, hint?: string | null): string => {
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
        case 'xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        case 'xls': return 'application/vnd.ms-excel';
        case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        default: return 'application/octet-stream';
    }
};

/**
 * A CSV as rows of cells: quoted fields, doubled quotes, commas and line
 * breaks inside quotes, `\r\n` or `\n`. Enough for a preview of what the
 * application exported, which is the only CSV this sees; stops after
 * `maxRows`, and a byte-order mark is dropped.
 */
export function parseCsv(text: string, maxRows = Number.POSITIVE_INFINITY): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let quoted = false;
    const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quoted) {
            if (char === '"') {
                if (input[index + 1] === '"') {
                    field += '"';
                    index += 1;
                } else {
                    quoted = false;
                }
            } else {
                field += char;
            }
            continue;
        }
        if (char === '"') {
            quoted = true;
        } else if (char === ',') {
            row.push(field);
            field = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && input[index + 1] === '\n') index += 1;
            row.push(field);
            field = '';
            rows.push(row);
            row = [];
            if (rows.length >= maxRows) return rows;
        } else {
            field += char;
        }
    }
    if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/** The first rows of a CSV, header first, with how many rows the file has. */
const CsvPreview: React.FC<{ text: string }> = ({ text }) => {
    const labels = useLabels();
    const all = parseCsv(text);
    const total = Math.max(0, all.length - 1);
    const [header = [], ...body] = all.slice(0, CSV_PREVIEW_ROWS + 1);
    const columns = header.slice(0, CSV_PREVIEW_COLUMNS);
    return (
        <div className="cb-attachment-viewer-csv">
            {total > body.length && (
                <p className="cb-attachment-viewer-note">
                    {formatLabel(labels.previewTruncated, { shown: body.length, total })}
                </p>
            )}
            <div className="cb-attachment-viewer-table-wrap">
                <table className="cb-attachment-viewer-table" dir="auto">
                    <thead>
                        <tr>{columns.map((cell, index) => <th key={index} title={cell}>{cell}</th>)}</tr>
                    </thead>
                    <tbody>
                        {body.map((cells, rowIndex) => (
                            <tr key={rowIndex}>
                                {columns.map((_, index) => (
                                    <td key={index} title={cells[index] ?? ''}>{cells[index] ?? ''}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

/** A file the viewer is showing: fetched yet or not, and what it holds. */
export interface AttachmentLoad {
    state: 'loading' | 'error' | 'ready';
    /** The fetched file, as an object URL; `null` until it has arrived. */
    blobUrl: string | null;
    /** A text file's text (CSV, plain text, Markdown), read from the blob. */
    textContent: string | null;
    errorMsg: string;
}

/**
 * Fetch `attachment` with the session's credentials while `active`, and say
 * how far it has got. Shared by the lightbox and the artifact's full view
 * (`ArtifactsPanel`), which shows the same file in place.
 */
export function useAttachmentLoad(attachment: Attachment | null, active: boolean): AttachmentLoad {
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
    const [errorMsg, setErrorMsg] = useState<string>('');
    const fetchAuthenticatedUrl = useAuthenticatedFetch();
    const labels = useLabels();

    useEffect(() => {
        if (!active || !attachment) return;
        let cancelled = false;

        const load = async () => {
            setState('loading');
            setBlobUrl(null);
            setTextContent(null);
            setErrorMsg('');

            if (!fetchAuthenticatedUrl) {
                setState('error');
                setErrorMsg(labels.attachmentNoAuth);
                return;
            }

            try {
                const url = await fetchAuthenticatedUrl(attachment.url);
                if (cancelled) return;
                setBlobUrl(url);

                const ct = inferContentType(attachment.name, attachment.contentType);
                if (ct.startsWith('text/')) {
                    const text = await netFetch(url).then(r => r.text());
                    if (cancelled) return;
                    setTextContent(text);
                }

                setState('ready');
            } catch (e) {
                if (cancelled) return;
                setState('error');
                setErrorMsg(e instanceof Error ? e.message : labels.attachmentLoadFailed);
            }
        };

        load();
        return () => { cancelled = true; };
    }, [active, attachment, fetchAuthenticatedUrl, labels]);

    return { state, blobUrl, textContent, errorMsg };
}

/** Hand a fetched file to the browser as a download, under `name`. */
export function downloadObjectUrl(url: string, name: string): void {
    if (typeof document === 'undefined') return;
    const link = document.createElement('a');
    link.href = url;
    link.download = name || 'download';
    link.style.display = 'none';
    document.body.appendChild(link);
    try {
        link.click();
    } finally {
        link.remove();
    }
}

/**
 * The width of `element`'s content box in whole px, kept current where
 * ResizeObserver exists; 0 until measured.
 *
 * Takes the element itself (a callback ref's state), not a ref object: the
 * element it measures — the PDF's box — appears only once the file has
 * loaded, after the first render. Until 2026-10-14 it read a ref once, on
 * mount, while the file was still loading, never measured again, and an
 * opened PDF was drawn at its own size, wider than a narrow column.
 */
function useContentWidth(element: HTMLElement | null, enabled: boolean): number {
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!enabled || !element) return undefined;
        setWidth(Math.round(element.clientWidth));
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(entries => {
            setWidth(Math.round(entries[0]?.contentRect?.width ?? element.clientWidth));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, enabled]);
    return width;
}

export interface AttachmentPreviewProps {
    attachment: Attachment;
    load: AttachmentLoad;
    /**
     * Drawn in a column of the chat rather than in the lightbox: the chat's
     * own colours instead of the lightbox's dark, an image as wide as the
     * column (scrolling when taller), and a PDF's page at the column's width.
     */
    inline?: boolean;
    /** The error state's "Close"; without one the error has no button. */
    onClose?: () => void;
}

/**
 * What the viewer shows of a file once asked: a spinner while it loads, why it
 * could not, or the file — an image, a PDF a page at a time, a CSV as a
 * table, text as text, and a card with a download for anything else.
 *
 * The body of the lightbox below, and since 2026-10-14 of an artifact opened
 * in place in the Artifacts view, which has no lightbox around it.
 */
export const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({ attachment, load, inline = false, onClose }) => {
    const labels = useLabels();
    const [pdfPageNumber, setPdfPageNumber] = useState(1);
    const [pdfNumPages, setPdfNumPages] = useState<number | null>(null);
    const [pdfBox, setPdfBox] = useState<HTMLDivElement | null>(null);
    const pdfWidth = useContentWidth(pdfBox, inline);
    const { state, blobUrl, textContent, errorMsg } = load;
    const ct = inferContentType(attachment.name, attachment.contentType);
    const download = () => {
        if (blobUrl) downloadObjectUrl(blobUrl, attachment.name || 'download');
    };

    return (
        <div className={`cb-attachment-preview${inline ? ' is-inline' : ''}`}>
            {state === 'loading' && (
                <div className="cb-attachment-viewer-loading">
                    <span className="cb-att-chip-spinner" aria-hidden />
                </div>
            )}

            {state === 'error' && (
                <div className="cb-attachment-viewer-error" role={inline ? 'alert' : undefined}>
                    <div className="cb-attachment-viewer-error-icon">&#x26A0;</div>
                    <div className="cb-attachment-viewer-error-msg">{errorMsg}</div>
                    {onClose && (
                        <div className="cb-attachment-viewer-actions">
                            <button className="cb-attachment-viewer-action-btn" onClick={onClose}>{labels.close}</button>
                        </div>
                    )}
                </div>
            )}

            {state === 'ready' && blobUrl && (
                <div className="cb-attachment-viewer-content">

                    {ct.startsWith('image/') ? (
                        <img src={blobUrl} alt={attachment.name || 'Attachment'} />
                    ) : ct === 'application/pdf' ? (
                        <div className="cb-pdf-viewer" ref={setPdfBox}>
                            <Document
                                file={blobUrl}
                                onLoadSuccess={({ numPages }) => {
                                    setPdfNumPages(numPages);
                                    setPdfPageNumber(1);
                                }}
                                loading={<div className="cb-attachment-viewer-loading"><span className="cb-att-chip-spinner" aria-hidden /></div>}
                                error={<div className="cb-attachment-viewer-error-msg">{labels.pdfLoadFailed}</div>}
                            >
                                {/* In place, a page as wide as the column; in the lightbox, at its own size. */}
                                <Page pageNumber={pdfPageNumber} width={inline && pdfWidth > 0 ? pdfWidth : undefined} />
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
                    ) : ct === 'text/csv' && textContent != null ? (
                        <CsvPreview text={textContent} />
                    ) : ct.startsWith('text/') && textContent != null ? (
                        <pre>{textContent}</pre>
                    ) : (
                        <div className="cb-attachment-viewer-fallback">
                            <div className="cb-attachment-viewer-fallback-icon">{getFileIcon(ct)}</div>
                            <div className="cb-attachment-viewer-fallback-name" dir="auto">{attachment.name || 'File'}</div>
                            {attachment.size != null && attachment.size > 0 && (
                                <div className="cb-attachment-viewer-fallback-size">{formatFileSize(attachment.size)}</div>
                            )}
                            <div className="cb-attachment-viewer-actions">
                                <button className="cb-attachment-viewer-action-btn primary" onClick={download}>
                                    {labels.downloadFile}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export interface AttachmentViewerProps {
    attachment: Attachment | null;
    isOpen: boolean;
    onClose: () => void;
}

/**
 * A lightbox for one file: an image, a PDF a page at a time, a CSV as a table,
 * text as text, and a download for everything else (a spreadsheet, say). The
 * file is fetched with the session's credentials (`useAuthenticatedFetch`),
 * so it works for the storage API's authenticated routes.
 *
 * Its toolbar is the file's name, then its actions, then the close button —
 * last, as in every header of the chat that has one (see `FilesHeader`).
 */
export const AttachmentViewerModal: React.FC<AttachmentViewerProps> = ({ attachment, isOpen, onClose }) => {
    const load = useAttachmentLoad(attachment, isOpen);
    const labels = useLabels();
    const icons = useIcons();
    const closeRef = useRef<HTMLButtonElement | null>(null);

    // Focus moves in once per opening — not whenever `onClose` is a new
    // function, which a caller's inline arrow is on every render.
    useEffect(() => {
        if (isOpen) closeRef.current?.focus();
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return undefined;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // The panel this was opened from closes on Escape too; this
                // one goes first, and alone.
                e.stopImmediatePropagation();
                onClose();
            }
        };
        // Capture, so it runs before a listener the opening panel registered.
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [isOpen, onClose]);

    if (!isOpen || !attachment) return null;

    const handleDownload = () => {
        if (load.blobUrl) downloadObjectUrl(load.blobUrl, attachment.name || 'download');
    };

    return ReactDOM.createPortal(
        <div className="cb-attachment-viewer-overlay" onClick={onClose}>
            <div
                className="cb-attachment-viewer-inner"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={attachment.name || 'Attachment'}
            >
                <div className="cb-attachment-viewer-toolbar">
                    <span className="cb-attachment-viewer-filename" dir="auto">{attachment.name || 'Attachment'}</span>
                    <div className="cb-attachment-viewer-toolbar-actions">
                        {load.state === 'ready' && load.blobUrl && (
                            <button
                                type="button"
                                className="cb-attachment-viewer-download"
                                onClick={handleDownload}
                                title={labels.downloadFile}
                            >
                                {icons.download}
                                <span>{labels.downloadFile}</span>
                            </button>
                        )}
                        {/* Last: the close button ends the toolbar. */}
                        <button
                            ref={closeRef}
                            type="button"
                            className="cb-attachment-viewer-close"
                            onClick={onClose}
                            title={`${labels.close} (Esc)`}
                            aria-label={labels.closeAttachment}
                        >
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                </div>

                <AttachmentPreview attachment={attachment} load={load} onClose={onClose} />
            </div>
        </div>,
        document.body
    );
};
