import React from 'react';
import '../ConversationDrawer/ConversationDrawer.css';
import './ConversationSidebar.css';
import { ConversationSummary } from '../../api/types';
import type { ChatIcons } from '../../common/icons';
import type { ChatLabels } from '../../common/labels';
import { useChatActions, useChatState, useIcons, useLabels } from '../../store/hooks';
import { useChatPresentation } from '../ChatContainer/presentation';

const { useEffect, useMemo, useState } = React;

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
    label: string;
    items: ConversationSummary[];
}

function groupByDate(items: ConversationSummary[], labels: ChatLabels): ConversationGroup[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const boundaries = [
        { label: labels.today, from: startOfToday },
        { label: labels.yesterday, from: startOfToday - DAY_MS },
        { label: labels.previous7Days, from: startOfToday - 6 * DAY_MS },
        { label: labels.older, from: Number.NEGATIVE_INFINITY },
    ];
    const groups = boundaries.map(({ label }) => ({ label, items: [] as ConversationSummary[] }));
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
    canDelete: boolean;
    labels: ChatLabels;
    icons: ChatIcons;
    onSelect: (id: string) => void;
    onToggleStar: (conversation: ConversationSummary) => void;
    onDelete: (id: string) => void;
}

const ConversationRow: React.FC<ConversationRowProps> = ({
    conversation,
    isActive,
    canStar,
    canDelete,
    labels,
    icons,
    onSelect,
    onToggleStar,
    onDelete,
}) => {
    const title = conversation.title || labels.untitledConversation;
    const isStarred = Boolean(conversation.starred_at);

    return (
        <div
            className={`cb-conversation-item ${isActive ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            aria-current={isActive ? 'true' : undefined}
            onClick={() => onSelect(conversation.uuid)}
            onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(conversation.uuid);
                }
            }}
            title={title}
        >
            <div className="cb-conversation-title">{title}</div>
            {(canStar || canDelete) && (
                <div className="cb-sidebar-item-actions">
                    {canStar && (
                        <button
                            type="button"
                            className={`cb-sidebar-star-btn${isStarred ? ' is-starred' : ''}`}
                            title={isStarred ? labels.unstar : labels.star}
                            aria-label={isStarred ? labels.unstar : labels.star}
                            aria-pressed={isStarred}
                            onClick={event => {
                                event.stopPropagation();
                                onToggleStar(conversation);
                            }}
                        >
                            {isStarred ? icons.starFilled : icons.star}
                        </button>
                    )}
                    {canDelete && (
                        <button
                            type="button"
                            className="cb-sidebar-delete-btn"
                            title={labels.deleteConversation}
                            aria-label={labels.deleteConversation}
                            onClick={event => {
                                event.stopPropagation();
                                onDelete(conversation.uuid);
                            }}
                        >
                            {icons.delete}
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
 * The conversation sidebar: new chat, the host's navigation entries, starred
 * conversations and recent ones, with search over all of them.
 *
 * Starred appears only when the Gateway reports `starred_at` — on one that does
 * not, starring could not persist — and deleting only when the host enables it
 * in `config.sidebar`, since the AI-EcoSystem Gateway has no delete route.
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
    const activeConversationId = useChatState(s => s.activeConversationId);
    const isLoading = useChatState(s => s.isLoadingConversations);
    const isLoadingMore = useChatState(s => s.isLoadingMore);
    const hasMore = useChatState(s => s.hasMore);
    const search = useChatState(s => s.search);
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

    const startNewChat = () => {
        actions.newChat();
        afterPick();
    };

    const selectConversation = (id: string) => {
        void actions.selectConversation(id);
        afterPick();
    };

    const toggleStar = (conversation: ConversationSummary) => {
        actions.setConversationStarred(conversation.uuid, !conversation.starred_at).catch(error => {
            console.error('[ConversationSidebar] starring failed', error);
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
            isActive={activeConversationId === conversation.uuid}
            canStar={showStarred}
            canDelete={sidebar.deleteConversation}
            labels={labels}
            icons={icons}
            onSelect={selectConversation}
            onToggleStar={toggleStar}
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
                        <div key={group.label} className="cb-drawer-group">
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
                        <span className="cb-sidebar-nav-label">{item.label}</span>
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
