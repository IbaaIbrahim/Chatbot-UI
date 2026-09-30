import * as React from 'react';
import { AgentSidebarItem } from '../AgentSidebar/AgentSidebar';
import './AgentSwitcher.css';

export interface AgentSwitcherProps {
    /** Available agents. Each item's ``onClick`` switches the active agent. */
    agents: AgentSidebarItem[];
    /** Whether the menu opens above or below its trigger. */
    menuPlacement?: 'above' | 'below';
    /** Horizontal alignment of the menu relative to the trigger. Defaults to 'right'. */
    menuAlign?: 'left' | 'right';
    /**
     * Whether to include an "Auto" option for agentless operation.
     * Defaults to true.
     */
    includeAuto?: boolean;
    /** Called when the "Auto" option is selected. */
    onSelectAuto?: () => void;
    /** Current active agent UUID (or null/empty for Auto). If omitted, inferred from agents' `active` flag. */
    activeAgentId?: string | null;
    /** Called when any agent is selected (passes null when Auto is selected). */
    onSelectAgent?: (agentId: string | null) => void;
}

const SparkleIcon: React.FC = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
);

/**
 * Compact agent selector shown alongside the composer.
 *
 * Displays the currently active agent and, on click, opens a menu of all
 * available agents so the user can switch between them without opening the
 * conversation drawer. Selecting an item invokes that agent's ``onClick``.
 */
export const AgentSwitcher: React.FC<AgentSwitcherProps> = ({
    agents,
    menuPlacement = 'below',
    menuAlign = 'right',
    includeAuto = true,
    onSelectAuto,
    activeAgentId,
    onSelectAgent,
}) => {
    const [isOpen, setIsOpen] = React.useState(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const isAutoActive = activeAgentId !== undefined
        ? (activeAgentId === null || activeAgentId === '' || activeAgentId === 'auto')
        : (includeAuto && !agents.some(agent => agent.active));

    const activeAgent = isAutoActive
        ? null
        : (activeAgentId !== undefined
            ? agents.find(agent => agent.id === activeAgentId) ?? null
            : agents.find(agent => agent.active) ?? (includeAuto ? null : agents[0]));

    const displayLabel = isAutoActive
        ? 'Auto'
        : (activeAgent?.label ?? (includeAuto ? 'Auto' : 'Select agent'));

    const displayIcon = isAutoActive
        ? <SparkleIcon />
        : (activeAgent?.icon ?? null);

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

    if (agents.length === 0 && !includeAuto) return null;

    const handleSelectAuto = () => {
        onSelectAuto?.();
        onSelectAgent?.(null);
        setIsOpen(false);
    };

    const handleSelectAgent = (agent: AgentSidebarItem) => {
        agent.onClick?.();
        onSelectAgent?.(agent.id);
        setIsOpen(false);
    };

    const menuClasses = [
        'cb-agent-switcher-menu',
        menuPlacement === 'above' ? 'cb-agent-switcher-menu--above' : '',
        menuAlign === 'right' ? 'cb-agent-switcher-menu--right' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className="cb-agent-switcher" ref={containerRef}>
            <button
                type="button"
                className="cb-agent-switcher-trigger"
                onClick={() => setIsOpen(open => !open)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                title="Switch agent"
            >
                {displayIcon && (
                    <span className="cb-agent-switcher-icon">{displayIcon}</span>
                )}
                <span className="cb-agent-switcher-label">
                    {displayLabel}
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
                <ul className={menuClasses} role="listbox">
                    {includeAuto && (
                        <>
                            <li
                                role="option"
                                aria-selected={isAutoActive}
                                className={`cb-agent-switcher-option${isAutoActive ? ' active' : ''}`}
                                onClick={handleSelectAuto}
                            >
                                <span className="cb-agent-switcher-icon"><SparkleIcon /></span>
                                <span className="cb-agent-switcher-option-label">Auto</span>
                                {isAutoActive && (
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
                            {agents.length > 0 && (
                                <li className="cb-agent-switcher-divider" role="separator" />
                            )}
                        </>
                    )}
                    {agents.map(agent => {
                        const isAgentActive = !isAutoActive && (
                            activeAgentId !== undefined
                                ? agent.id === activeAgentId
                                : (agent.active ?? false)
                        );
                        return (
                            <li
                                key={agent.id}
                                role="option"
                                aria-selected={isAgentActive}
                                className={`cb-agent-switcher-option${isAgentActive ? ' active' : ''}`}
                                onClick={() => handleSelectAgent(agent)}
                            >
                                {agent.icon && (
                                    <span className="cb-agent-switcher-icon">{agent.icon}</span>
                                )}
                                <span className="cb-agent-switcher-option-label">{agent.label}</span>
                                {isAgentActive && (
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
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
