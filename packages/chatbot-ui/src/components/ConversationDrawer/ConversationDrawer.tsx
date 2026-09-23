import React from 'react';
import './ConversationDrawer.css';
import { ConversationSummary } from '../../api/types';

export interface ConversationDrawerProps {
    conversations: ConversationSummary[];
    onSelect: (id: string) => void;
    onNewChat: () => void;
    onClose?: () => void;
    activeConversationId?: string | null;
    isLoading?: boolean;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
}

interface GroupedConversations {
    label: string;
    items: ConversationSummary[];
}

function groupConversationsByDate(items: ConversationSummary[]): GroupedConversations[] {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOf7Days = startOfToday - 6 * 86400000;

    const today: ConversationSummary[] = [];
    const yesterday: ConversationSummary[] = [];
    const previous7Days: ConversationSummary[] = [];
    const older: ConversationSummary[] = [];

    for (const conv of items) {
        const time = new Date(conv.updated_at).getTime();
        if (time >= startOfToday) {
            today.push(conv);
        } else if (time >= startOfYesterday) {
            yesterday.push(conv);
        } else if (time >= startOf7Days) {
            previous7Days.push(conv);
        } else {
            older.push(conv);
        }
    }

    const groups: GroupedConversations[] = [];
    if (today.length > 0) groups.push({ label: 'Today', items: today });
    if (yesterday.length > 0) groups.push({ label: 'Yesterday', items: yesterday });
    if (previous7Days.length > 0) groups.push({ label: 'Previous 7 Days', items: previous7Days });
    if (older.length > 0) groups.push({ label: 'Older', items: older });

    if (groups.length === 0 && items.length > 0) {
        groups.push({ label: 'Conversations', items });
    }

    return groups;
}

export const ConversationDrawer: React.FC<ConversationDrawerProps> = ({
    conversations,
    onSelect,
    onNewChat,
    onClose,
    activeConversationId,
    isLoading,
    hasMore,
    isLoadingMore,
    onLoadMore,
}) => {
    const [searchQuery, setSearchQuery] = React.useState('');

    const filteredConversations = React.useMemo(() => {
        if (!searchQuery.trim()) return conversations;
        const q = searchQuery.toLowerCase();
        return conversations.filter(c => (c.title || '').toLowerCase().includes(q));
    }, [conversations, searchQuery]);

    const conversationGroups = React.useMemo(() => {
        return groupConversationsByDate(filteredConversations);
    }, [filteredConversations]);

    return (
        <div className="cb-conversation-drawer">
            <div className="cb-drawer-header">
                <h3>Recent chats</h3>
                <div className="cb-drawer-header-actions">
                    {onClose && (
                        <button
                            type="button"
                            className="cb-drawer-close-btn"
                            onClick={onClose}
                            title="Collapse sidebar"
                            aria-label="Collapse sidebar"
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                <rect x="3" y="3" width="18" height="18" rx="3" />
                                <path d="M15 3v18" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <div className="cb-drawer-search-wrapper">
                <div className="cb-drawer-search-inner">
                    <span className="cb-drawer-search-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                    </span>
                    <input
                        type="text"
                        className="cb-drawer-search-input"
                        placeholder="Search"
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>

            <div className="cb-conversation-list">
                {isLoading && conversations.length === 0 ? (
                    <div className="cb-drawer-loading">
                        <div className="cb-drawer-spinner" />
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="cb-drawer-empty">
                        {/* Dual speech bubbles illustration matching Mockup 5 */}
                        <div className="cb-drawer-empty-illustration">
                            <svg width="86" height="86" viewBox="0 0 100 100" fill="none">
                                {/* Back bubble (gray with purple dots) */}
                                <rect x="12" y="14" width="54" height="36" rx="12" fill="var(--cb-surface-hover, #e2e8f0)" />
                                <path d="M22 50L14 59V50H22Z" fill="var(--cb-surface-hover, #e2e8f0)" />
                                <circle cx="29" cy="32" r="3" fill="#818cf8" />
                                <circle cx="39" cy="32" r="3" fill="#818cf8" />
                                <circle cx="49" cy="32" r="3" fill="#818cf8" />

                                {/* Front bubble (purple with white dots) */}
                                <rect x="36" y="34" width="54" height="36" rx="12" fill="#6366f1" />
                                <path d="M76 70L84 79V70H76Z" fill="#6366f1" />
                                <circle cx="53" cy="52" r="3" fill="#ffffff" />
                                <circle cx="63" cy="52" r="3" fill="#ffffff" />
                                <circle cx="73" cy="52" r="3" fill="#ffffff" />
                            </svg>
                        </div>
                        <h4 className="cb-empty-title">No chat history</h4>
                        <p className="cb-empty-subtitle">Start a chat to view your conversations here.</p>
                        <button
                            type="button"
                            className="cb-empty-new-chat-btn"
                            onClick={onNewChat}
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>New chat</span>
                        </button>
                    </div>
                ) : (
                    <>
                        {conversationGroups.map(group => (
                            <div key={group.label} className="cb-drawer-group">
                                <div className="cb-drawer-group-title">{group.label}</div>
                                {group.items.map(conv => (
                                    <div
                                        key={conv.uuid}
                                        className={`cb-conversation-item ${activeConversationId === conv.uuid ? 'active' : ''}`}
                                        onClick={() => onSelect(conv.uuid)}
                                        title={conv.title || 'Untitled conversation'}
                                    >
                                        <div className="cb-conversation-title">{conv.title || 'Untitled conversation'}</div>
                                    </div>
                                ))}
                            </div>
                        ))}
                        {hasMore && (
                            <button
                                className="cb-load-more-btn"
                                onClick={onLoadMore}
                                disabled={isLoadingMore}
                            >
                                {isLoadingMore ? (
                                    <>
                                        <span className="cb-drawer-spinner" style={{ width: 14, height: 14 }} />
                                        Loading...
                                    </>
                                ) : (
                                    'Load more'
                                )}
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
