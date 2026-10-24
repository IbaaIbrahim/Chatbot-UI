import React from 'react';
import '../ConversationDrawer/ConversationDrawer.css';
import './ConversationSidebar.css';
import { ConversationSummary } from '../../api/types';
import type { ChatIcons } from '../../common/icons';
import type { ChatLabels } from '../../common/labels';
import { useChatActions, useChatState, useIcons, useLabels } from '../../store/hooks';
import { useChatPresentation } from '../ChatContainer/presentation';

const { useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

const SEARCH_DEBOUNCE_MS = 250;
const DAY_MS = 86400000;

export interface ConversationSidebarProps {
    /**
     * Rendered by the host as a column of its own rather than inside
     * `ChatContainer`'s drawer: no collapse button, and picking a conversation
     * does not close it.
     */
    embedded?: boolean;
    className?: string;
    style?: React.CSSProperties;
}

interface ConversationGroup {
    /** Stable whatever the language: the group's React key. Two translations may word two groups alike. */
    id: 'today' | 'yesterday' | 'week' | 'older';
    label: string;
    items: ConversationSummary[];
}

function groupByDate(items: ConversationSummary[], labels: ChatLabels): ConversationGroup[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const boundaries: Array<{ id: ConversationGroup['id']; label: string; from: number }> = [
        { id: 'today', label: labels.today, from: startOfToday },
        { id: 'yesterday', label: labels.yesterday, from: startOfToday - DAY_MS },
        { id: 'week', label: labels.previous7Days, from: startOfToday - 6 * DAY_MS },
        { id: 'older', label: labels.older, from: Number.NEGATIVE_INFINITY },
    ];
    const groups: ConversationGroup[] = boundaries.map(({ id, label }) => ({ id, label, items: [] }));
    for (const conversation of items) {
        const time = new Date(conversation.updated_at).getTime();
        const index = boundaries.findIndex(boundary => time >= boundary.from);
        groups[index === -1 ? groups.length - 1 : index].items.push(conversation);
    }
    return groups.filter(group => group.items.length > 0);
}

interface ConversationRowProps {
    conversation: ConversationSummary;
    isActive: boolean;
    canStar: boolean;
    canRename: boolean;
    canDelete: boolean;
    labels: ChatLabels;
    icons: ChatIcons;
    onSelect: (id: string) => void;
    onToggleStar: (conversation: ConversationSummary) => void;
    onRename: (conversation: ConversationSummary, title: string) => void;
    onDelete: (id: string) => void;
}

/** Roughly the open menu's height: less room than this below a row opens it upwards. */
const ROW_MENU_HEIGHT_PX = 140;

/**
 * One conversation in the list, with its actions behind a "more" button.
 *
 * Star, rename and delete share one menu rather than a button each: three
 * icons on hover left the title a few characters in a 260px column.
 *
 * Renaming edits the title in place — Enter or leaving the field saves,
 * Escape cancels. Deleting takes two clicks, the first turning the entry into
 * the question, so a stray click cannot lose a thread.
 */
const ConversationRow: React.FC<ConversationRowProps> = ({
    conversation,
    isActive,
    canStar,
    canRename,
    canDelete,
    labels,
    icons,
    onSelect,
    onToggleStar,
    onRename,
    onDelete,
}) => {
    const title = conversation.title || labels.untitledConversation;
    const isStarred = Boolean(conversation.starred_at);
    const hasActions = canStar || canRename || canDelete;

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [opensUpward, setOpensUpward] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [draft, setDraft] = useState(title);
    const rowRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    // Enter saves and unmounts the field, and a browser may then report the
    // field's blur as well: the second save must find nothing to do.
    const isRenamingRef = useRef(false);

    useEffect(() => {
        if (!isMenuOpen) {
            setIsConfirmingDelete(false);
            return undefined;
        }
        const closeOnOutsidePointer = (event: MouseEvent) => {
            if (rowRef.current && !rowRef.current.contains(event.target as Node)) setIsMenuOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsidePointer);
        return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
    }, [isMenuOpen]);

    useLayoutEffect(() => {
        if (!isRenaming) return;
        inputRef.current?.focus();
        inputRef.current?.select();
    }, [isRenaming]);

    const openMenu = () => {
        const row = rowRef.current;
        const list = row?.closest('.cb-conversation-list');
        if (row && list) {
            const roomBelow = list.getBoundingClientRect().bottom - row.getBoundingClientRect().bottom;
            setOpensUpward(roomBelow < ROW_MENU_HEIGHT_PX);
        }
        setIsMenuOpen(true);
    };

    const startRename = () => {
        setIsMenuOpen(false);
        setDraft(conversation.title || '');
        isRenamingRef.current = true;
        setIsRenaming(true);
    };

    const finishRename = (save: boolean) => {
        if (!isRenamingRef.current) return;
        isRenamingRef.current = false;
        setIsRenaming(false);
        const next = draft.trim();
        if (save && next && next !== conversation.title) onRename(conversation, next);
    };

    const className = [
        'cb-conversation-item',
        isActive ? 'active' : '',
        isMenuOpen ? 'is-menu-open' : '',
        isRenaming ? 'is-renaming' : '',
    ].filter(Boolean).join(' ');

    return (
        <div
            ref={rowRef}
            className={className}
            role="button"
            tabIndex={0}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => {
                if (!isRenaming) onSelect(conversation.uuid);
            }}
            onKeyDown={event => {
                // Escape closes the menu here, before it reaches the chat's own
                // Escape, which would close an overlay sidebar along with it.
                if (event.key === 'Escape' && isMenuOpen) {
                    event.stopPropagation();
                    setIsMenuOpen(false);
                    return;
                }
                // Only the row's own keys: Enter on a menu entry, or a space
                // typed into the rename field, is not "open this conversation".
                if (event.target !== event.currentTarget) return;
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(conversation.uuid);
                }
            }}
            title={isRenaming ? undefined : title}
        >
            {isRenaming ? (
                <input
                    ref={inputRef}
                    className="cb-conversation-rename-input"
                    dir="auto"
                    value={draft}
                    aria-label={labels.conversationTitle}
                    maxLength={200}
                    onChange={event => setDraft(event.target.value)}
                    onClick={event => event.stopPropagation()}
                    onBlur={() => finishRename(true)}
                    onKeyDown={event => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            finishRename(true);
                        } else if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            finishRename(false);
                        }
                    }}
                />
            ) : (
                // Its own direction (2026-10-18): a title in another script
                // than the page keeps its punctuation where it belongs, and is
                // cut short at its own end.
                <div className="cb-conversation-title cb-bidi" dir="auto">{title}</div>
            )}

            {hasActions && !isRenaming && (
                <div className="cb-sidebar-item-actions">
                    <button
                        type="button"
                        className="cb-sidebar-row-menu-btn"
                        title={labels.conversationActions}
                        aria-label={labels.conversationActions}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                        onClick={event => {
                            event.stopPropagation();
                            if (isMenuOpen) setIsMenuOpen(false);
                            else openMenu();
                        }}
                    >
                        {icons.more}
                    </button>
                </div>
            )}

            {isMenuOpen && (
                <div
                    className={`cb-sidebar-row-menu${opensUpward ? ' opens-upward' : ''}`}
                    role="menu"
                    onClick={event => event.stopPropagation()}
                >
                    {canStar && (
                        <button
                            type="button"
                            className={`cb-header-menu-item${isStarred ? ' is-starred' : ''}`}
                            role="menuitem"
                            onClick={() => {
                                setIsMenuOpen(false);
                                onToggleStar(conversation);
                            }}
                        >
                            {isStarred ? icons.starFilled : icons.star}
                            <span>{isStarred ? labels.unstar : labels.star}</span>
                        </button>
                    )}
                    {canRename && (
                        <button type="button" className="cb-header-menu-item" role="menuitem" onClick={startRename}>
                            {icons.rename}
                            <span>{labels.renameConversation}</span>
                        </button>
                    )}
                    {canDelete && (
                        <button
                            type="button"
                            className={`cb-header-menu-item cb-header-menu-item-danger${isConfirmingDelete ? ' is-confirming' : ''}`}
                            role="menuitem"
                            onClick={() => {
                                if (!isConfirmingDelete) {
                                    setIsConfirmingDelete(true);
                                    return;
                                }
                                setIsMenuOpen(false);
                                onDelete(conversation.uuid);
                            }}
                        >
                            {icons.delete}
                            <span>{isConfirmingDelete ? labels.confirmDeleteConversation : labels.deleteConversation}</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const Spinner: React.FC = () => (
    <div className="cb-drawer-loading">
        <div className="cb-drawer-spinner" />
    </div>
);

/**
 * The conversation sidebar: new chat, the user's artifacts, the host's
 * navigation entries, starred conversations and recent ones, with search over
 * all of them.
 *
 * Starred appears only when the Gateway reports `starred_at` — on one that does
 * not, starring could not persist — and renaming only when the client can
 * rename. Artifacts appears only with a storage API to list them from (the
 * provider's `storageApiUrl` and `accessToken`). Each is also a
 * `config.sidebar` flag, as deleting is.
 */
export const ConversationSidebar: React.FC<ConversationSidebarProps> = ({
    embedded = false,
    className = '',
    style,
}) => {
    const sidebar = useChatState(s => s.config.sidebar);
    const conversations = useChatState(s => s.conversations);
    const starredConversations = useChatState(s => s.starredConversations);
    const starringSupported = useChatState(s => s.starringSupported);
    const renamingSupported = useChatState(s => s.renamingSupported);
    const activeConversationId = useChatState(s => s.activeConversationId);
    const isLoading = useChatState(s => s.isLoadingConversations);
    const isLoadingMore = useChatState(s => s.isLoadingMore);
    const hasMore = useChatState(s => s.hasMore);
    const search = useChatState(s => s.search);
    const canUseFiles = useChatState(s => s.storageClient !== null);
    const isArtifactsOpen = useChatState(s => s.isArtifactsPanelOpen);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const { sidebarInline } = useChatPresentation();

    const [query, setQuery] = useState(search.query);
    const [isStarredExpanded, setIsStarredExpanded] = useState(true);

    useEffect(() => {
        const timer = window.setTimeout(() => actions.searchConversations(query), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [query, actions]);

    const recentGroups = useMemo(() => groupByDate(conversations, labels), [conversations, labels]);

    const showStarred = sidebar.starred && starringSupported;
    const isSearchActive = sidebar.search && query.trim().length > 0;
    const isSearchPending = isSearchActive && (query.trim() !== search.query || search.isSearching);
    const hasAnyConversation = conversations.length > 0 || starredConversations.length > 0;

    // An overlay covers the transcript, so it gets out of the way once the
    // user has picked; a column beside the transcript stays where it is.
    const afterPick = () => {
        if (!embedded && !sidebarInline) actions.closeSidebar();
    };

    // "New chat" and a conversation picked leave the Artifacts view for the
    // chat: the actions themselves close it (2026-10-14).
    const startNewChat = () => {
        actions.newChat();
        afterPick();
    };

    const selectConversation = (id: string) => {
        // A conversation picked while the files panel covers the chat is one
        // the user wants to read, not to see behind the panel.
        actions.closeFiles();
        if (isArtifactsOpen && id === activeConversationId) {
            // The conversation behind the Artifacts view: back to it as it
            // was, not loaded again — a load replaces the transcript, cutting
            // off an answer still streaming and losing the scroll position.
            // As the view's own "Open conversation" does (2026-10-14).
            actions.closeArtifacts();
            actions.focusComposer();
        } else {
            void actions.selectConversation(id);
        }
        afterPick();
    };

    // The view takes the chat's place; a drawer closes, as for a conversation.
    // Chosen again while it shows, it goes back to its list.
    const openArtifacts = () => {
        actions.openArtifacts();
        afterPick();
    };

    const toggleStar = (conversation: ConversationSummary) => {
        actions.setConversationStarred(conversation.uuid, !conversation.starred_at).catch(error => {
            console.error('[ConversationSidebar] starring failed', error);
        });
    };

    const renameConversation = (conversation: ConversationSummary, title: string) => {
        actions.renameConversation(conversation.uuid, title).catch(error => {
            console.error('[ConversationSidebar] renaming failed', error);
        });
    };

    const deleteConversation = (id: string) => {
        actions.deleteConversation(id).catch(error => {
            console.error('[ConversationSidebar] deleting failed', error);
        });
    };

    const renderRow = (conversation: ConversationSummary) => (
        <ConversationRow
            key={conversation.uuid}
            conversation={conversation}
            // While the Artifacts view shows, it is the current entry: the
            // open conversation is behind it, not on screen.
            isActive={!isArtifactsOpen && activeConversationId === conversation.uuid}
            canStar={showStarred}
            canRename={sidebar.rename && renamingSupported}
            canDelete={sidebar.deleteConversation}
            labels={labels}
            icons={icons}
            onSelect={selectConversation}
            onToggleStar={toggleStar}
            onRename={renameConversation}
            onDelete={deleteConversation}
        />
    );

    const renderSearchResults = () => {
        if (isSearchPending && search.results.length === 0) return <Spinner />;
        if (search.results.length === 0) return <p className="cb-sidebar-hint">{labels.noSearchResults}</p>;
        return search.results.map(renderRow);
    };

    const renderEmptyHistory = () => (
        <div className="cb-drawer-empty">
            <div className="cb-drawer-empty-illustration" aria-hidden="true">
                <svg width="86" height="86" viewBox="0 0 100 100" fill="none">
                    <rect x="12" y="14" width="54" height="36" rx="12" fill="var(--cb-surface-hover, #e2e8f0)" />
                    <path d="M22 50L14 59V50H22Z" fill="var(--cb-surface-hover, #e2e8f0)" />
                    <circle cx="29" cy="32" r="3" fill="#818cf8" />
                    <circle cx="39" cy="32" r="3" fill="#818cf8" />
                    <circle cx="49" cy="32" r="3" fill="#818cf8" />
                    <rect x="36" y="34" width="54" height="36" rx="12" fill="#6366f1" />
                    <path d="M76 70L84 79V70H76Z" fill="#6366f1" />
                    <circle cx="53" cy="52" r="3" fill="#ffffff" />
                    <circle cx="63" cy="52" r="3" fill="#ffffff" />
                    <circle cx="73" cy="52" r="3" fill="#ffffff" />
                </svg>
            </div>
            <h4 className="cb-empty-title">{labels.noHistoryTitle}</h4>
            <p className="cb-empty-subtitle">{labels.noHistoryBody}</p>
        </div>
    );

    const renderHistory = () => {
        if (isLoading && !hasAnyConversation) return <Spinner />;
        if (!hasAnyConversation && !showStarred) return renderEmptyHistory();
        return (
            <>
                {showStarred && (
                    <section className="cb-sidebar-section">
                        <button
                            type="button"
                            className="cb-sidebar-section-toggle"
                            aria-expanded={isStarredExpanded}
                            onClick={() => setIsStarredExpanded(expanded => !expanded)}
                        >
                            {isStarredExpanded ? icons.sectionExpanded : icons.sectionCollapsed}
                            <span>{labels.starred}</span>
                        </button>
                        {isStarredExpanded && (
                            starredConversations.length > 0
                                ? starredConversations.map(renderRow)
                                : <p className="cb-sidebar-hint">{labels.starredEmpty}</p>
                        )}
                    </section>
                )}

                <section className="cb-sidebar-section">
                    {showStarred && <div className="cb-sidebar-section-title">{labels.recents}</div>}
                    {!hasAnyConversation && renderEmptyHistory()}
                    {recentGroups.map(group => (
                        <div key={group.id} className="cb-drawer-group">
                            <div className="cb-drawer-group-title">{group.label}</div>
                            {group.items.map(renderRow)}
                        </div>
                    ))}
                    {hasMore && (
                        <button
                            type="button"
                            className="cb-load-more-btn"
                            onClick={() => void actions.loadMoreConversations()}
                            disabled={isLoadingMore}
                        >
                            {isLoadingMore ? labels.loading : labels.loadMore}
                        </button>
                    )}
                </section>
            </>
        );
    };

    return (
        <aside
            className={`cb-conversation-drawer cb-sidebar ${embedded ? 'cb-conversation-sidebar-embedded' : ''} ${className}`}
            style={style}
            aria-label={labels.sidebarTitle}
        >
            <div className="cb-drawer-header">
                <h3>{labels.sidebarTitle}</h3>
                {!embedded && (
                    <button
                        type="button"
                        className="cb-drawer-close-btn"
                        onClick={actions.closeSidebar}
                        title={labels.collapseSidebar}
                        aria-label={labels.collapseSidebar}
                    >
                        {icons.sidebarCollapse}
                    </button>
                )}
            </div>

            <nav className="cb-sidebar-nav">
                {sidebar.newChat && (
                    <button type="button" className="cb-sidebar-nav-item cb-sidebar-nav-primary" onClick={startNewChat}>
                        <span className="cb-sidebar-nav-icon">{icons.newChat}</span>
                        <span className="cb-sidebar-nav-label">{labels.newChat}</span>
                    </button>
                )}
                {/* What the user saved, across conversations: the first entry
                    after "New chat", before the host's own. */}
                {sidebar.artifacts && canUseFiles && (
                    <button
                        type="button"
                        className={`cb-sidebar-nav-item cb-sidebar-nav-artifacts${isArtifactsOpen ? ' active' : ''}`}
                        aria-current={isArtifactsOpen ? 'page' : undefined}
                        onClick={openArtifacts}
                    >
                        <span className="cb-sidebar-nav-icon">{icons.artifacts}</span>
                        <span className="cb-sidebar-nav-label">{labels.artifacts}</span>
                    </button>
                )}
                {sidebar.items.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={`cb-sidebar-nav-item${item.active ? ' active' : ''}`}
                        aria-current={item.active ? 'page' : undefined}
                        onClick={() => {
                            item.onSelect();
                            afterPick();
                        }}
                    >
                        {item.icon && <span className="cb-sidebar-nav-icon">{item.icon}</span>}
                        <span className="cb-sidebar-nav-label cb-bidi" dir="auto">{item.label}</span>
                        {item.badge !== undefined && <span className="cb-sidebar-nav-badge">{item.badge}</span>}
                    </button>
                ))}
            </nav>

            {sidebar.search && (
                <div className="cb-drawer-search-wrapper">
                    <div className="cb-drawer-search-inner">
                        <span className="cb-drawer-search-icon">{icons.search}</span>
                        <input
                            type="search"
                            className="cb-drawer-search-input"
                            dir="auto"
                            placeholder={labels.searchPlaceholder}
                            aria-label={labels.searchPlaceholder}
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                        />
                    </div>
                </div>
            )}

            <div className="cb-conversation-list">
                {isSearchActive ? (
                    <section className="cb-sidebar-section">
                        <div className="cb-sidebar-section-title">{labels.searchResults}</div>
                        {renderSearchResults()}
                    </section>
                ) : (
                    renderHistory()
                )}
            </div>
        </aside>
    );
};

export const ConversationsHistory = ConversationSidebar;
