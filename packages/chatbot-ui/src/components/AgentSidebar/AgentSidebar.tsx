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

/** Points down when the section is open, along the row when it is collapsed. */
const SectionChevron: React.FC<{ open: boolean }> = ({ open }) => (
    <svg
        className={`cb-agent-section-chevron${open ? '' : ' collapsed'}`}
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
    >
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

interface CollapsibleSectionProps {
    title: string;
    open: boolean;
    onToggle: () => void;
    className?: string;
    children: React.ReactNode;
}

/**
 * One section of the sidebar, with its heading doubling as a disclosure control.
 *
 * The heading stays a heading rather than being replaced by a button — jumping
 * between "Agents" and "Chats" by heading is how a screen-reader user navigates
 * this list — and carries the button inside it.
 */
const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
    title,
    open,
    onToggle,
    className,
    children,
}) => {
    const bodyId = React.useId();

    return (
        <section className={`cb-agent-section${className ? ` ${className}` : ''}`}>
            <h3 className="cb-agent-section-title">
                <button
                    type="button"
                    className="cb-agent-section-toggle"
                    onClick={onToggle}
                    aria-expanded={open}
                    aria-controls={bodyId}
                >
                    <SectionChevron open={open} />
                    <span>{title}</span>
                </button>
            </h3>
            <div id={bodyId} className="cb-agent-section-body" hidden={!open}>
                {children}
            </div>
        </section>
    );
};

export const AgentSidebar: React.FC<AgentSidebarProps> = ({
    agents,
    chatHistory,
    onNewChat,
    onSearch,
    searchResults,
    isSearching = false,
}) => {
    const [searchQuery, setSearchQuery] = React.useState('');

    // Both open, because a sidebar that starts folded up hides what it is for.
    // Collapsing is the escape hatch for a long list, not the resting state.
    const [isAgentsOpen, setIsAgentsOpen] = React.useState(true);
    const [isChatsOpen, setIsChatsOpen] = React.useState(true);

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

            {/* One scroll region for both sections, deliberately. A scroller per
                section splits a fixed column between them, so a deployment with
                a dozen agents took the whole height and left the chats a few
                pixels tall — the conversations were on screen but unreachable.
                Scrolling the sidebar as a whole lets the sections share the
                space in reading order, and collapsing one hands its room back
                to the other. */}
            <div className="cb-agent-sidebar-scroll">
                {agents.length > 0 && (
                    <CollapsibleSection
                        title="Agents"
                        open={isAgentsOpen}
                        onToggle={() => setIsAgentsOpen(open => !open)}
                    >
                        {agents.map(agent => (
                            <button
                                type="button"
                                key={agent.id}
                                className={`cb-agent-item cb-agent-item--agent${agent.active ? ' active' : ''}`}
                                onClick={agent.onClick}
                                aria-current={agent.active ? 'true' : undefined}
                            >
                                <span className="cb-agent-item-icon" aria-hidden="true">{agent.icon}</span>
                                <span className="cb-agent-item-label">{agent.label}</span>
                            </button>
                        ))}
                    </CollapsibleSection>
                )}

                <CollapsibleSection
                    title="Chats"
                    open={isChatsOpen}
                    onToggle={() => setIsChatsOpen(open => !open)}
                    className="cb-agent-chats-section"
                >
                    {onSearch && (
                        <div className="cb-agent-search">
                            <svg className="cb-agent-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                            </svg>
                            <input
                                type="text"
                                placeholder="Search conversations…"
                                value={searchQuery}
                                onChange={handleSearchChange}
                                className="cb-agent-search-input"
                                aria-label="Search conversations"
                                autoComplete="off"
                            />
                        </div>
                    )}

                    {isSearching && (
                        <p className="cb-agent-note" role="status">Searching…</p>
                    )}

                    {displayItems.map(item => (
                        <button
                            type="button"
                            key={item.id}
                            className={`cb-agent-item cb-agent-item--chat${item.active ? ' active' : ''}`}
                            onClick={item.onClick}
                            aria-current={item.active ? 'true' : undefined}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="cb-agent-item-icon" aria-hidden="true">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                            </svg>
                            <span className="cb-agent-item-label">{item.label}</span>
                        </button>
                    ))}

                    {!isSearching && displayItems.length === 0 && (
                        <p className="cb-agent-note">
                            {searchQuery.trim() ? 'No results found' : 'No conversations yet'}
                        </p>
                    )}
                </CollapsibleSection>
            </div>
        </div>
    );
};
