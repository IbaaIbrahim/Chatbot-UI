import React from 'react';
import './ConversationDrawer.css';
import { ConversationSummary } from '../../api/types';

export interface ConversationDrawerProps {
    conversations: ConversationSummary[];
    onSelect: (id: string) => void;
    onNewChat: () => void;
    activeConversationId?: string | null;
    isLoading?: boolean;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
}

const _formatRelativeDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
};

export const ConversationDrawer: React.FC<ConversationDrawerProps> = ({
    conversations,
    onSelect,
    onNewChat,
    activeConversationId,
    isLoading,
    hasMore,
    isLoadingMore,
    onLoadMore,
}) => {
    return (
        <div className="cb-conversation-drawer">
            <div className="cb-drawer-header">
                <h3>Conversations</h3>
                <button className="cb-new-chat-btn" onClick={onNewChat}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    New Chat
                </button>
            </div>

            <div className="cb-conversation-list">
                {isLoading && conversations.length === 0 ? (
                    <div className="cb-drawer-loading">
                        <div className="cb-drawer-spinner" />
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="cb-drawer-empty">
                        <div>No conversations yet</div>
                    </div>
                ) : (
                    <>
                        {conversations.map(conv => (
                            <div
                                key={conv.uuid}
                                className={`cb-conversation-item ${activeConversationId === conv.uuid ? 'active' : ''}`}
                                onClick={() => onSelect(conv.uuid)}
                            >
                                <div className="cb-conversation-title">{conv.title}</div>
                                <div className="cb-conversation-date">{_formatRelativeDate(conv.updated_at)}</div>
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
