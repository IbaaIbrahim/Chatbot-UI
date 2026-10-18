import React from 'react';
const { useState } = React;
import { parseToolOutput } from '../../api/toolOutput';
// Declared in common/toolConfig, where the whole tool contract lives, and
// imported back here: this component renders a control, it does not own the
// shape of the configuration that asks for one.
import { hasHostDisplayName, resolveToolDisplayName, type ToolActionRenderProps, type ToolConfig } from '../../common/toolConfig';
import { describeMetaTool, isMetaTool } from '../../common/metaTools';
import './ToolInvocation.css';
import { useLabels } from '../../store/hooks';

export type ToolStatus = 'running' | 'completed' | 'failed';

/**
 * The action control itself — a custom render if one was given, the built-in
 * button otherwise.
 *
 * Shared by the step-level row inside {@link ToolInvocation} and the turn-level
 * row in ``MessageBubble`` so a hoisted control is the same control, and a host
 * app's `render` cannot behave differently depending on where it landed.
 */
export const ToolActionControl: React.FC<{
    onAction: (data: any) => void;
    payload: any;
    /** The call's parsed result, for a custom control; see {@link ToolActionRenderProps.result}. */
    result?: any;
    toolName: string;
    label: string;
    render?: (props: ToolActionRenderProps) => React.ReactNode;
}> = ({ onAction, payload, result, toolName, label, render }) => {
    const fire = () => onAction(payload);
    if (render) {
        return <>{render({ onAction: fire, payload, result, toolName, label })}</>;
    }
    return (
        <button className="cb-tool-action-btn" onClick={fire}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            {label}
        </button>
    );
};

export interface ToolInvocationProps {
    /**
     * The tool's slug (a display name also works, but then a meta-tool or a
     * web search is not recognised as one). Resolved to a display name here.
     */
    toolName: string;
    args?: Record<string, any>;
    status: ToolStatus;
    result?: any;
    onAction?: (data: any) => void;
    actionLabel?: string;
    /**
     * Payload passed to {@link onAction} when re-invoking the action, chosen by
     * whoever registered the handler. It has to be explicit because the two
     * kinds of handler want opposite ends of the same tool call:
     *
     *  - a **client tool** (e.g. ``preview_property_agent_result``) acts on its
     *    {@link args}; its {@link result} is only the ``{ status: 'previewed' }``
     *    ack placeholder.
     *  - a **result previewer** (e.g. ``generate_checklist``) acts on the
     *    {@link result} the worker produced; its {@link args} are just the
     *    arguments the model invented.
     *
     * Falls back to ``args ?? result`` when unset, which keeps the historical
     * client-tool behaviour for callers that pass only {@link onAction}.
     */
    actionPayload?: any;
    /**
     * Render a custom control instead of the built-in button. Receives the same
     * click behaviour and payload the button would have used, so a custom
     * control cannot get the client-tool/previewer payload distinction wrong.
     */
    renderAction?: (props: ToolActionRenderProps) => React.ReactNode;
    tools?: Record<string, ToolConfig>;
}

export const ToolInvocation: React.FC<ToolInvocationProps> = ({
    toolName,
    status,
    args,
    result,
    onAction,
    renderAction,
    actionLabel,
    actionPayload,
    tools,
}) => {
    const labels = useLabels();
    const [expanded, setExpanded] = useState(false);

    const displayName = resolveToolDisplayName(toolName, tools);
    // The same compact text the step renderer gives a meta-tool step; see
    // common/metaTools.ts and ModernToolCallRow in MessageBubble.
    const meta = isMetaTool(toolName) && !hasHostDisplayName(toolName, tools)
        ? describeMetaTool(toolName, status, args, result, labels, name => resolveToolDisplayName(name, tools))
        : null;

    // Resolved once and shared by the built-in button and any custom control,
    // so a custom control cannot pick the wrong end of the call. The registrant
    // decides via ``actionPayload``; the fallback only guesses when nobody said.
    const actionValue = React.useMemo(
        () => parseToolOutput(actionPayload ?? args ?? result),
        [actionPayload, args, result]
    );
    const parsedResult = React.useMemo(() => parseToolOutput(result), [result]);

    const isWebSearch = toolName === 'web_search' || toolName === 'search_web';

    return (
        <div className={`cb-tool-invocation ${status}${meta ? ' cb-tool-invocation--meta' : ''}`}>
            <button
                type="button"
                className="cb-tool-header"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
            >
                <div className="cb-tool-icon">
                    {status === 'running' ? (
                        <div className="cb-spinner-sm" />
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="cb-icon-check">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>
                {meta ? (
                    <span className="cb-tool-name" title={toolName}>
                        <span className="cb-tool-meta-text">{meta.text}</span>
                        {meta.detail && <span className="cb-tool-meta-detail">{meta.detail}</span>}
                    </span>
                ) : (
                    <span className="cb-tool-name">
                        <span className="cb-tool-verb">{status === 'running' ? labels.toolCalling : labels.toolUsed}</span>
                        <strong title={toolName}>{displayName}</strong>
                    </span>
                )}
                <span className="cb-tool-chevron">
                    <svg
                        width="16" height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className={expanded ? 'cb-chevron-open' : undefined}
                    >
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                </span>
            </button>
            {onAction && status === 'completed' && (
                <div className="cb-tool-action-row">
                    <ToolActionControl
                        onAction={onAction}
                        payload={actionValue}
                        result={parsedResult}
                        toolName={toolName}
                        label={actionLabel ?? labels.openResult}
                        render={renderAction}
                    />
                </div>
            )}
            {expanded && (
                <div className="cb-tool-details">
                    {isWebSearch && result ? (
                        <div className="cb-web-search-results">
                            <div className="cb-tool-detail-label">{labels.searchResultsHeading}</div>
                            <div className="cb-markdown-content cb-tool-detail-body">
                                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                            </div>
                        </div>
                    ) : (
                        <div className="cb-code-block">
                            <div className="cb-tool-detail-key">{labels.toolArguments}</div>
                            {JSON.stringify(args, null, 2)}
                            {result && (
                                <>
                                    <div className="cb-tool-detail-key cb-tool-detail-key-spaced">{labels.toolResult}</div>
                                    {JSON.stringify(result, null, 2)}
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};


