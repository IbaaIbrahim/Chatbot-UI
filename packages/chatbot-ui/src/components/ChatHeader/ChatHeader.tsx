import React from 'react';
import './ChatHeader.css';
import { useChatActions, useChatState, useIcons, useLabels } from '../../store/hooks';
import type { ChatViewOption } from '../../common/chatbotConfig';
import { standingContextParts } from '../../common/standingContext';
import { ChatMode, useChatPresentation } from '../ChatContainer/presentation';

const { useState, useRef, useEffect } = React;

const COPIED_FEEDBACK_MS = 2000;

/** Each mode's name and icon share one key: `labels.viewFloating`, `icons.viewFloating`. */
const MODE_VIEW = {
    floating: 'viewFloating',
    sidebar: 'viewSidebar',
    fullscreen: 'viewFullscreen',
} as const satisfies Record<ChatMode, string>;

export interface ChatHeaderProps {
    className?: string;
    style?: React.CSSProperties;
}

/**
 * The bar above the transcript.
 *
 * Every control is decided by two things: `config.header` says whether the host
 * wants it, and the chat's state says whether it can do anything — the share
 * button needs an `onShare`, "Switch view" a view other than the one in effect
 * (`config.header.views`, or the provider's `onSwitchMode` and a second mode),
 * "Credit usage" a client that can read the allowance. Both must hold, so no flag
 * can produce a button that does nothing.
 *
 * "Switch view" is one entry that opens the page's views in place, the one in
 * effect ticked: a narrow floating panel has no room for a submenu beside the
 * menu, and a flat entry per view made the menu as long as the list of views.
 */
export const ChatHeader: React.FC<ChatHeaderProps> = ({ className = '', style }) => {
    const header = useChatState(s => s.config.header);
    const sidebarEnabled = useChatState(s => s.config.sidebar.enabled);
    const isSidebarOpen = useChatState(s => s.isSidebarOpen);
    const hasMessages = useChatState(s => s.messages.length > 0);
    const activeConversationId = useChatState(s => s.activeConversationId);
    const canShare = useChatState(s => s.canShare);
    const canCopyLink = useChatState(s => s.canCopyConversationLink);
    const canSwitchMode = useChatState(s => s.canSwitchMode);
    const canShowCredits = useChatState(s => s.canShowCredits);
    const canManageStandingContext = useChatState(s => s.canManageStandingContext);
    const canUseFiles = useChatState(s => s.storageClient !== null);
    const isArtifactsOpen = useChatState(s => s.isArtifactsPanelOpen);
    const hostHandlesOpenChange = useChatState(s => s.hostHandlesOpenChange);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const { mode, allowedModes, embedded, sidebarInline } = useChatPresentation();

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isViewListOpen, setIsViewListOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const moreRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!isMenuOpen) return undefined;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsMenuOpen(false);
            }
        };
        // Escape closes the menu, and only the menu: pressed in it, or with
        // nothing focused (a click on "More options" does not focus it in
        // every browser). Taken in the capture phase and stopped there, before
        // the chat's other Escapes — an overlay sidebar's, the Artifacts
        // view's, which stands below the header (2026-10-14) — see it.
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key !== 'Escape' || !menuRef.current) return;
            const target = e.target;
            const nothingFocused = !target || target === document.body || target === document.documentElement;
            if (!nothingFocused && !(target instanceof Node && menuRef.current.contains(target))) return;
            e.preventDefault();
            e.stopPropagation();
            setIsMenuOpen(false);
            if (!nothingFocused) moreRef.current?.focus();
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape, true);
        };
    }, [isMenuOpen]);

    // The list of views starts folded, and a delete unconfirmed, every time the
    // menu opens.
    useEffect(() => {
        if (!isMenuOpen) {
            setIsViewListOpen(false);
            setIsConfirmingDelete(false);
        }
    }, [isMenuOpen]);

    useEffect(() => {
        if (!copied) return undefined;
        const timer = window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
        return () => window.clearTimeout(timer);
    }, [copied]);

    if (!header.visible) return null;

    // An open inline sidebar carries its own collapse button; a second toggle
    // beside it would be two controls for one thing.
    const showSidebarToggle = header.sidebarToggle && sidebarEnabled && !(sidebarInline && isSidebarOpen);
    // The host's own views when it defines them, otherwise the library's modes.
    const builtInViews: ChatViewOption[] = canSwitchMode
        ? allowedModes.map(viewMode => ({
            id: viewMode,
            label: labels[MODE_VIEW[viewMode]],
            icon: icons[MODE_VIEW[viewMode]],
            active: viewMode === mode,
            onSelect: () => actions.switchMode(viewMode),
        }))
        : [];
    const allowedViews = header.allowedViews;
    const views = header.switchView
        ? (header.views ?? builtInViews).filter(view => !allowedViews || allowedViews.includes(view.id))
        : [];
    const showSwitchView = views.some(view => !view.active);
    const showCreditUsage = header.creditUsage && canShowCredits;
    const standingParts = standingContextParts(header.standingContext);
    const showStandingContext = canManageStandingContext && (standingParts.personal || standingParts.workspace);
    // A conversation's files exist only once it does, and the storage API
    // needs the user's token to list them. Not while the Artifacts view
    // stands in the conversation's place: the conversation the panel would
    // describe is not on screen, and opening it would close the view, with
    // its search and the artifact open in it (2026-10-14).
    const showFiles = header.files && canUseFiles && Boolean(activeConversationId) && !isArtifactsOpen;
    const showCopyId = header.copyConversationId && Boolean(activeConversationId);
    const showDeleteThread = header.deleteConversation && Boolean(activeConversationId);
    const hasOtherMenuItems =
        showCreditUsage || showStandingContext || showCopyId || showDeleteThread || header.menuItems.length > 0;
    const hasMenuItems = showSwitchView || hasOtherMenuItems;
    const canClose = hostHandlesOpenChange || (mode === 'floating' && !embedded);

    const runMenuItem = (action: () => void) => () => {
        setIsMenuOpen(false);
        action();
    };

    const deleteThread = () => {
        if (!activeConversationId) return;
        actions.deleteConversation(activeConversationId).catch(error => {
            console.error('[ChatHeader] deleting the conversation failed', error);
        });
    };

    const brand = header.brand === false ? null : header.brand ?? (
        <div className="cb-brand-wrapper">
            <div className="cb-header-sparkle">{icons.brand}</div>
            <span className="cb-brand">{labels.brandTitle}</span>
        </div>
    );

    return (
        <div className={`cb-chat-header ${className}`} style={style}>
            <div className="cb-header-left">
                {showSidebarToggle && (
                    <button
                        type="button"
                        className="cb-header-btn cb-drawer-toggle-btn"
                        onClick={actions.toggleSidebar}
                        aria-label={isSidebarOpen ? labels.closeSidebar : labels.openSidebar}
                        title={isSidebarOpen ? labels.closeSidebar : labels.openSidebar}
                        aria-expanded={isSidebarOpen}
                    >
                        {isSidebarOpen ? icons.sidebarCollapse : icons.sidebarToggle}
                    </button>
                )}
                {brand}
            </div>

            <div className="cb-actions">
                {header.actions}

                {showFiles && (
                    <button
                        type="button"
                        className="cb-header-btn cb-files-btn"
                        onClick={actions.openFiles}
                        title={labels.conversationFiles}
                        aria-label={labels.conversationFiles}
                        aria-haspopup="dialog"
                    >
                        {icons.files}
                    </button>
                )}

                {header.share && canShare && (
                    <button
                        type="button"
                        className="cb-header-btn cb-share-btn"
                        onClick={actions.share}
                        title={labels.share}
                        aria-label={labels.share}
                    >
                        {icons.share}
                    </button>
                )}

                {header.newChat && hasMessages && (
                    <button
                        type="button"
                        className="cb-header-new-chat-btn"
                        onClick={actions.newChat}
                        title={labels.newChatTitle}
                        aria-label={labels.newChat}
                    >
                        {icons.newChat}
                        <span>{labels.newChat}</span>
                    </button>
                )}

                {header.menu && hasMenuItems && (
                    <div className="cb-header-menu-container" ref={menuRef}>
                        <button
                            ref={moreRef}
                            type="button"
                            className="cb-header-btn cb-more-btn"
                            onClick={() => setIsMenuOpen(open => !open)}
                            aria-label={labels.moreOptions}
                            title={labels.moreOptions}
                            aria-expanded={isMenuOpen}
                        >
                            {icons.more}
                        </button>

                        {isMenuOpen && (
                            <div className="cb-header-dropdown-menu" role="menu">
                                {showSwitchView && (
                                    <button
                                        type="button"
                                        className={`cb-header-menu-item cb-header-switch-view${isViewListOpen ? ' is-open' : ''}`}
                                        onClick={() => setIsViewListOpen(open => !open)}
                                        role="menuitem"
                                        aria-haspopup="true"
                                        aria-expanded={isViewListOpen}
                                    >
                                        {icons.switchView}
                                        <span>{labels.switchView}</span>
                                        <span className="cb-header-menu-chevron" aria-hidden>{icons.sectionExpanded}</span>
                                    </button>
                                )}
                                {showSwitchView && isViewListOpen && (
                                    <div className="cb-header-view-list" role="group" aria-label={labels.switchView}>
                                        {views.map(view => (
                                            <button
                                                key={view.id}
                                                type="button"
                                                className={`cb-header-menu-item cb-header-view-item${view.active ? ' is-active' : ''}`}
                                                onClick={view.active ? () => setIsMenuOpen(false) : runMenuItem(view.onSelect)}
                                                role="menuitemradio"
                                                aria-checked={Boolean(view.active)}
                                            >
                                                {view.icon}
                                                <span>{view.label}</span>
                                                {view.active && <span className="cb-header-view-check" aria-hidden>{icons.check}</span>}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {showSwitchView && hasOtherMenuItems && (
                                    <div className="cb-header-menu-separator" role="separator" />
                                )}

                                {showCreditUsage && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={runMenuItem(actions.openCreditUsage)}
                                        role="menuitem"
                                    >
                                        {icons.creditUsage}
                                        <span>{labels.creditUsage}</span>
                                    </button>
                                )}

                                {showStandingContext && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={runMenuItem(actions.openStandingContext)}
                                        role="menuitem"
                                    >
                                        {icons.standingContext}
                                        <span>{labels.standingContext}</span>
                                    </button>
                                )}

                                {/* The link when the host can build one (`conversationLink`):
                                    an id alone opens nothing, and a link is what gets shared. */}
                                {showCopyId && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={() => {
                                            if (canCopyLink) actions.copyConversationLink();
                                            else actions.copyConversationId();
                                            setCopied(true);
                                        }}
                                        role="menuitem"
                                    >
                                        {canCopyLink ? icons.link : icons.copy}
                                        <span>
                                            {canCopyLink
                                                ? (copied ? labels.copiedConversationLink : labels.copyConversationLink)
                                                : (copied ? labels.copiedConversationId : labels.copyConversationId)}
                                        </span>
                                    </button>
                                )}

                                {header.menuItems.map(item => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        className={`cb-header-menu-item${item.danger ? ' cb-header-menu-item-danger' : ''}`}
                                        onClick={runMenuItem(item.onSelect)}
                                        role="menuitem"
                                    >
                                        {item.icon}
                                        <span>{item.label}</span>
                                    </button>
                                ))}

                                {/* Two clicks: the first asks, in place, and only the second
                                    deletes — a whole thread is not something to lose to a
                                    stray click on a menu. */}
                                {showDeleteThread && (
                                    <button
                                        type="button"
                                        className={`cb-header-menu-item cb-header-menu-item-danger${isConfirmingDelete ? ' is-confirming' : ''}`}
                                        onClick={isConfirmingDelete ? runMenuItem(deleteThread) : () => setIsConfirmingDelete(true)}
                                        role="menuitem"
                                    >
                                        {icons.delete}
                                        <span>{isConfirmingDelete ? labels.confirmDeleteThread : labels.deleteThread}</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {header.close && canClose && (
                    <button
                        type="button"
                        className="cb-minimize-btn"
                        onClick={actions.close}
                        aria-label={labels.closeChat}
                        title={labels.closeChat}
                    >
                        {icons.close}
                    </button>
                )}
            </div>
        </div>
    );
};

export const HeaderBar = ChatHeader;
