import React from 'react';
import { EnablableTool } from '../../api/GatewayStreamClient';
import './ToolToggles.css';

export interface ToolTogglesProps {
    /** Tools the caller may switch on, from `listEnablableTools`. */
    tools: EnablableTool[];
    /** UUIDs currently switched on. */
    enabledIds: string[];
    /** Called with the full new selection — not a delta. */
    onChange: (enabledIds: string[]) => void;
    /**
     * Slugs the host application has registered a handler for.
     *
     * A `client`-dispatch tool with no handler is **dropped from the menu**: the
     * orchestrator would suspend the run waiting for a result the app cannot
     * produce, and the user would watch a spinner until the run's TTL expired.
     * Backend tools are unaffected — the platform runs those itself.
     */
    handledSlugs?: string[];
    /** Dismiss the menu. */
    onClose: () => void;
}

/**
 * Per-slug icon, so a row reads at a glance rather than by its label alone.
 *
 * Keyed by slug because that is the stable identifier — `name` is
 * administrator-editable text and would silently lose its icon the first time
 * someone reworded it. An unknown slug gets the generic tool glyph rather than
 * no glyph, which keeps the rows aligned.
 */
const TOOL_ICONS: Record<string, React.ReactNode> = {
    read_page_context: (
        <>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
        </>
    ),
    capture_page_screenshot: (
        <>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
        </>
    ),
    navigate_app_route: (
        <>
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
        </>
    ),
    web_search: (
        <>
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </>
    ),
    research_web: (
        <>
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </>
    ),
    fetch_web_page: (
        <>
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </>
    ),
};

const FALLBACK_ICON = (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
);

/**
 * The tool menu that opens from the composer.
 *
 * Renders the *content* only — the trigger button and the open/closed state
 * belong to the composer, so the button sits in the same row as attach and send
 * rather than in a control strip of its own.
 */
export const ToolToggles: React.FC<ToolTogglesProps> = ({
    tools,
    enabledIds,
    onChange,
    handledSlugs = [],
    onClose,
}) => {
    const handled = React.useMemo(() => new Set(handledSlugs), [handledSlugs]);

    const runnable = React.useMemo(
        () => tools.filter(t => t.dispatch_mode !== 'client' || handled.has(t.slug)),
        [tools, handled]
    );

    const toggle = (tool: EnablableTool) => {
        onChange(
            enabledIds.includes(tool.uuid)
                ? enabledIds.filter(id => id !== tool.uuid)
                : [...enabledIds, tool.uuid]
        );
    };

    // Escape closes, as any menu should. Without it the only way out is the
    // trigger button, which leaves the menu unclosable if that button is ever
    // obscured — and a panel a user cannot dismiss reads as the app being stuck.
    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose]);

    return (
        <>
            {/* A full-viewport scrim is what makes click-outside work. The
                anchored wrapper below is only as big as the menu, so a click
                anywhere else would never reach a handler on it. */}
            <div className="cb-menu-scrim" onClick={onClose} />
            <div className="cb-menu-overlay">
            <div
                className="cb-menu-content cb-tools-menu"
                role="group"
                aria-label="Tools"
            >
                <div className="cb-menu-header">
                    <span>Tools</span>
                </div>
                <div className="cb-menu-section">
                    {runnable.map(tool => {
                        const on = enabledIds.includes(tool.uuid);
                        return (
                            <div
                                key={tool.uuid}
                                className="cb-menu-toggle-item"
                                onClick={() => toggle(tool)}
                                role="switch"
                                aria-checked={on}
                                tabIndex={0}
                                onKeyDown={e => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        toggle(tool);
                                    }
                                }}
                            >
                                <div className="cb-menu-icon-circle">
                                    <svg
                                        width="14"
                                        height="14"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        {TOOL_ICONS[tool.slug] ?? FALLBACK_ICON}
                                    </svg>
                                </div>
                                <div className="cb-menu-info">
                                    <span className="cb-menu-title">{tool.name}</span>
                                    {tool.description && (
                                        <span className="cb-menu-desc">{tool.description}</span>
                                    )}
                                </div>
                                <div className={`cb-toggle ${on ? 'on' : 'off'}`} />
                            </div>
                        );
                    })}
                </div>
            </div>
            </div>
        </>
    );
};

/**
 * Whether the composer should offer the tools button at all.
 *
 * Exported so the composer can decide without duplicating the handler rule: a
 * menu whose every row was filtered out is a button that opens nothing.
 */
export function hasRunnableTools(
    tools: EnablableTool[],
    handledSlugs: string[]
): boolean {
    const handled = new Set(handledSlugs);
    return tools.some(t => t.dispatch_mode !== 'client' || handled.has(t.slug));
}
