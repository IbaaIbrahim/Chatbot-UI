import * as React from 'react';
import './AgentSidebar.css';

export interface AgentSidebarItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    active?: boolean;
    onClick?: () => void;
}

export interface AgentSidebarProps {
    agents: AgentSidebarItem[];
    chatHistory: AgentSidebarItem[];
    onNewChat: () => void;
    onSearch?: (query: string) => void;
    searchResults?: AgentSidebarItem[];
    isSearching?: boolean;
}

export const AgentSidebar: React.FC<AgentSidebarProps> = ({
    agents,
    chatHistory,
    onNewChat,
    onSearch,
    searchResults,
    isSearching = false,
}) => {
    const [searchQuery, setSearchQuery] = React.useState('');

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchQuery(value);
        onSearch?.(value);
    };

    const displayItems = searchQuery.trim() ? (searchResults || []) : chatHistory;

    return (
        <div className="cb-agent-sidebar">
            <div className="cb-agent-sidebar-header">
                <button className="cb-new-chat-btn" onClick={onNewChat}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    <span>New chat</span>
                </button>
            </div>

            {agents.length > 0 && (
                <div className="cb-agent-section">
                    <h3 className="cb-agent-section-title">Agents</h3>
                    {agents.map(agent => (
                        <div
                            key={agent.id}
                            className={`cb-agent-item${agent.active ? ' active' : ''}`}
                            onClick={agent.onClick}
                        >
                            <span className="cb-agent-item-icon">{agent.icon}</span>
                            <span className="cb-agent-item-label">{agent.label}</span>
                        </div>
                    ))}
                </div>
            )}

            <div className="cb-agent-section cb-agent-chats-section">
                <h3 className="cb-agent-section-title">Chats</h3>

                {onSearch && (
                    <div className="cb-agent-search">
                        <svg className="cb-agent-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                        </svg>
                        <input
                            type="text"
                            placeholder="Search conversations..."
                            value={searchQuery}
                            onChange={handleSearchChange}
                            className="cb-agent-search-input"
                        />
                    </div>
                )}

                {isSearching && (
                    <div className="cb-agent-item cb-agent-item--muted">Searching…</div>
                )}

                {displayItems.map(item => (
                    <div
                        key={item.id}
                        className={`cb-agent-item${item.active ? ' active' : ''}`}
                        onClick={item.onClick}
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cb-agent-item-icon">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="cb-agent-item-label">{item.label}</span>
                    </div>
                ))}

                {!isSearching && displayItems.length === 0 && (
                    <div className="cb-agent-item cb-agent-item--muted">
                        {searchQuery.trim() ? 'No results found' : 'No conversations yet'}
                    </div>
                )}
            </div>
        </div>
    );
};
