import React from 'react';

/**
 * Every built-in icon, by the job it does.
 *
 * A host replaces any of them with `config.icons` — e.g.
 * `icons: { sidebarToggle: <MyPanelIcon /> }` — and the rest keep these
 * defaults. Values are plain React nodes, so a font icon, an `<img>` or another
 * icon library's component all work. Each default is drawn at the size it is
 * used at and coloured with `currentColor`, so it follows the theme.
 */
export interface ChatIcons {
    brand: React.ReactNode;
    launcher: React.ReactNode;
    /** Opens the sidebar. One panel drawn twice with {@link sidebarCollapse}, the chevron reversed. */
    sidebarToggle: React.ReactNode;
    /** Closes it: the same panel as {@link sidebarToggle}, so the pair reads as one control. */
    sidebarCollapse: React.ReactNode;
    newChat: React.ReactNode;
    search: React.ReactNode;
    star: React.ReactNode;
    starFilled: React.ReactNode;
    sectionCollapsed: React.ReactNode;
    sectionExpanded: React.ReactNode;
    /** Trails each row of a quick-action category's prompt list. */
    promptRow: React.ReactNode;
    delete: React.ReactNode;
    /** A sidebar row's "Rename". */
    rename: React.ReactNode;
    more: React.ReactNode;
    share: React.ReactNode;
    viewFloating: React.ReactNode;
    viewSidebar: React.ReactNode;
    viewFullscreen: React.ReactNode;
    /** The "Switch view" entry, when no view in the list is the one in effect. */
    switchView: React.ReactNode;
    /** Ticks the view in effect. */
    check: React.ReactNode;
    creditUsage: React.ReactNode;
    copy: React.ReactNode;
    /** "Copy conversation link", when the host builds links (`conversationLink`). */
    link: React.ReactNode;
    close: React.ReactNode;
    attach: React.ReactNode;
    tools: React.ReactNode;
    mic: React.ReactNode;
    send: React.ReactNode;
    stop: React.ReactNode;
    scrollDown: React.ReactNode;
    /** The header's "Conversation files" button. */
    files: React.ReactNode;
    /** The sidebar's "Artifacts" entry. */
    artifacts: React.ReactNode;
    download: React.ReactNode;
    /** A rich block's "Expand". */
    expand: React.ReactNode;
    /** "Open conversation", on an artifact. */
    openConversation: React.ReactNode;
    /**
     * An artifact's "Back to artifacts": an arrow to the start. Drawn pointing
     * left; the library mirrors it in a right-to-left page.
     */
    back: React.ReactNode;
    /** What an artifact is, beside its title — one per `ArtifactKind`. */
    artifactChart: React.ReactNode;
    artifactTable: React.ReactNode;
    artifactKpi: React.ReactNode;
    artifactReport: React.ReactNode;
    artifactFile: React.ReactNode;
    /**
     * What a plain file is, in the files lists' rows, by its type (2026-10-14):
     * an image (until its thumbnail arrives, or when too large for one), a PDF,
     * a spreadsheet (CSV, Excel). Anything else is {@link artifactFile}.
     */
    fileImage: React.ReactNode;
    filePdf: React.ReactNode;
    fileSpreadsheet: React.ReactNode;
    /** The "Saved" mark: a filled bookmark. */
    saved: React.ReactNode;
    /** The "Not saved" mark: an empty, dashed bookmark. */
    notSaved: React.ReactNode;
    /** A not-saved generated file's Save button. */
    save: React.ReactNode;
    /** A block's "Show in chat", in the files panel. */
    showInChat: React.ReactNode;
}

const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
};

export const DEFAULT_ICONS: ChatIcons = {
    brand: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden focusable={false}>
            <path d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8L12 2Z" fill="url(#cb-sparkle-gradient-hdr)" />
            <defs>
                <linearGradient id="cb-sparkle-gradient-hdr" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6366F1" />
                    <stop offset="0.5" stopColor="#38BDF8" />
                    <stop offset="1" stopColor="#F59E0B" />
                </linearGradient>
            </defs>
        </svg>
    ),
    launcher: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden focusable={false}>
            <path d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z" fill="currentColor" />
        </svg>
    ),
    // One panel, its chevron pointing the way the sidebar will move. These were
    // a bare panel and a `«`, two unrelated drawings for one control's two
    // states, side by side in fullscreen.
    sidebarToggle: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={1.8}>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 3v18" />
            <path d="m14 9 3 3-3 3" />
        </svg>
    ),
    sidebarCollapse: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke} strokeWidth={1.8}>
            <rect x="3" y="3" width="18" height="18" rx="3" />
            <path d="M9 3v18" />
            <path d="m16 15-3-3 3-3" />
        </svg>
    ),
    newChat: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z" />
        </svg>
    ),
    search: (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
    ),
    star: (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    ),
    starFilled: (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} fill="currentColor">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
    ),
    sectionCollapsed: (
        <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} strokeWidth={2.5}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    ),
    sectionExpanded: (
        <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} strokeWidth={2.5}>
            <path d="m6 9 6 6 6-6" />
        </svg>
    ),
    promptRow: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="m9 18 6-6-6-6" />
        </svg>
    ),
    delete: (
        <svg width="13" height="13" viewBox="0 0 24 24" {...stroke}>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    ),
    rename: (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke}>
            <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
            <path d="m15 5 4 4" />
        </svg>
    ),
    more: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable={false}>
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
            <circle cx="5" cy="12" r="2" />
        </svg>
    ),
    share: (
        <svg width="17" height="17" viewBox="0 0 24 24" {...stroke}>
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
        </svg>
    ),
    viewFloating: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <polyline points="4 14 10 14 10 20" />
            <polyline points="20 10 14 10 14 4" />
            <line x1="14" y1="10" x2="21" y2="3" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
    ),
    viewSidebar: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M15 3v18" />
        </svg>
    ),
    viewFullscreen: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
    ),
    switchView: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
        </svg>
    ),
    check: (
        <svg width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth={2.5}>
            <polyline points="20 6 9 17 4 12" />
        </svg>
    ),
    creditUsage: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M12 3a9 9 0 1 0 9 9" />
            <path d="M12 3v9h9" />
            <path d="M15 3.5A9 9 0 0 1 20.5 9" />
        </svg>
    ),
    copy: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    ),
    link: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
    ),
    close: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
            <path d="M18 6L6 18M6 6l12 12" />
        </svg>
    ),
    attach: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    ),
    tools: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
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
    ),
    mic: (
        <svg width="18" height="18" viewBox="0 0 24 24" {...stroke}>
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
    ),
    send: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>
    ),
    stop: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden focusable={false}>
            <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
    ),
    scrollDown: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
    ),
    // A folder, not two sheets: two sheets read as "copy" beside the copy icon.
    files: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <path d="M3 10h18" />
        </svg>
    ),
    artifacts: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="m12 2 9 5-9 5-9-5 9-5z" />
            <path d="m3 12 9 5 9-5" />
            <path d="m3 17 9 5 9-5" />
        </svg>
    ),
    download: (
        <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
    ),
    expand: (
        <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
            <polyline points="15 3 21 3 21 9" />
            <polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" />
            <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
    ),
    openConversation: (
        <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <path d="M9 10h6" />
            <path d="m13 8 2 2-2 2" />
        </svg>
    ),
    back: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
        </svg>
    ),
    artifactChart: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M3 3v18h18" />
            <path d="M7 15l4-4 3 3 5-6" />
        </svg>
    ),
    artifactTable: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 10h18" />
            <path d="M3 15h18" />
            <path d="M10 4v16" />
        </svg>
    ),
    artifactKpi: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="3" y="4" width="8" height="7" rx="1.5" />
            <rect x="13" y="4" width="8" height="7" rx="1.5" />
            <rect x="3" y="13" width="8" height="7" rx="1.5" />
            <rect x="13" y="13" width="8" height="7" rx="1.5" />
        </svg>
    ),
    artifactReport: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8" />
            <path d="M8 17h5" />
        </svg>
    ),
    artifactFile: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
    ),
    fileImage: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
        </svg>
    ),
    filePdf: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <rect x="7" y="12" width="10" height="6" rx="1" />
        </svg>
    ),
    fileSpreadsheet: (
        <svg width="16" height="16" viewBox="0 0 24 24" {...stroke}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h2" />
            <path d="M14 13h2" />
            <path d="M8 17h2" />
            <path d="M14 17h2" />
        </svg>
    ),
    saved: (
        <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} fill="currentColor">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
    ),
    notSaved: (
        <svg width="12" height="12" viewBox="0 0 24 24" {...stroke} strokeDasharray="3 3">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
        </svg>
    ),
    save: (
        <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            <path d="M12 7v6" />
            <path d="M9 10h6" />
        </svg>
    ),
    showInChat: (
        <svg width="15" height="15" viewBox="0 0 24 24" {...stroke}>
            <circle cx="12" cy="12" r="7" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M12 2v3" />
            <path d="M12 19v3" />
            <path d="M2 12h3" />
            <path d="M19 12h3" />
        </svg>
    ),
};
