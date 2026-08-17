import * as React from 'react';
import { AgentSidebarItem } from '../AgentSidebar/AgentSidebar';
import './AgentSwitcher.css';

export interface AgentSwitcherProps {
    /** Available agents. Each item's ``onClick`` switches the active agent. */
    agents: AgentSidebarItem[];
}

/**
 * Compact agent selector shown in the chat header.
 *
 * Displays the currently active agent and, on click, opens a menu of all
 * available agents so the user can switch between them without opening the
 * conversation drawer. Selecting an item invokes that agent's ``onClick``.
 */
export const AgentSwitcher: React.FC<AgentSwitcherProps> = ({ agents }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const activeAgent = agents.find(agent => agent.active) ?? agents[0];

    // Close the menu when clicking outside of it or pressing Escape.
    React.useEffect(() => {
        if (!isOpen) return;

        const handlePointerDown = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsOpen(false);
        };

        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen]);

    if (agents.length === 0) return null;

    const handleSelect = (agent: AgentSidebarItem) => {
        agent.onClick?.();
        setIsOpen(false);
    };

    return (
        <div className="cb-agent-switcher" ref={containerRef}>
            <button
                type="button"
                className="cb-agent-switcher-trigger"
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
            >
                {activeAgent?.icon && (
                    <span className="cb-agent-switcher-icon">{activeAgent.icon}</span>
                )}
                <span className="cb-agent-switcher-label">
                    {activeAgent?.label ?? 'Select agent'}
                </span>
                <svg
                    className={`cb-agent-switcher-chevron${isOpen ? ' open' : ''}`}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>

            {isOpen && (
                <ul className="cb-agent-switcher-menu" role="listbox">
                    {agents.map(agent => (
                        <li
                            key={agent.id}
                            role="option"
                            aria-selected={agent.active ?? false}
                            className={`cb-agent-switcher-option${agent.active ? ' active' : ''}`}
                            onClick={() => handleSelect(agent)}
                        >
                            {agent.icon && (
                                <span className="cb-agent-switcher-icon">{agent.icon}</span>
                            )}
                            <span className="cb-agent-switcher-option-label">{agent.label}</span>
                            {agent.active && (
                                <svg
                                    className="cb-agent-switcher-check"
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                >
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};
