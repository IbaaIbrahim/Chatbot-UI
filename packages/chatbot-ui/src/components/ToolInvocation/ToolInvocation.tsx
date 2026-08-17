import React from 'react';
const { useState } = React;
import { parseToolOutput } from '../../api/toolOutput';
import './ToolInvocation.css';

export type ToolStatus = 'running' | 'completed' | 'failed';

/** What a custom action control is handed to render itself. */
export interface ToolActionRenderProps {
    /** Fire the registered handler with the payload it expects. */
    onAction: () => void;
    /**
     * The payload `onAction` will pass — the tool's arguments for a client
     * tool, its result for a result previewer. Given so a custom control can
     * label itself from the data ("Open 5S Audit Scorecard") rather than only
     * from the tool slug.
     */
    payload: any;
    toolName: string;
    /** The resolved label, whether the default or one set on the config. */
    label: string;
}

/**
 * How a tool's completed step presents its action, keyed by tool slug.
 *
 * Registering a handler is what makes an action *possible*; this is what decides
 * whether it is *offered*. The two are separate on purpose: a tool like
 * `read_page_context` returns data to the agent and has nothing a user would
 * re-open, while `generate_checklist` produces something they will want to look
 * at again — but both need a handler to work at all.
 */
export interface ToolActionConfig {
    /**
     * Offer the action control on this tool's completed step. Default `true`,
     * which is the behaviour every registered handler had before this existed.
     * Set `false` for tools whose result is not worth re-opening.
     */
    show?: boolean;
    /** Override the button text. Ignored when {@link render} is given. */
    label?: string;
    /**
     * Render your own control in place of the built-in button. Return `null` to
     * render nothing — though `show: false` says that more directly.
     */
    render?: (props: ToolActionRenderProps) => React.ReactNode;
}

export interface ToolInvocationProps {
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
}

export const ToolInvocation: React.FC<ToolInvocationProps> = ({
    toolName,
    status,
    args,
    result,
    onAction,
    renderAction,
    actionLabel = 'Open Result',
    actionPayload,
}) => {
    const [expanded, setExpanded] = useState(false);

    // Resolved once and shared by the built-in button and any custom control,
    // so a custom control cannot pick the wrong end of the call. The registrant
    // decides via ``actionPayload``; the fallback only guesses when nobody said.
    const actionValue = React.useMemo(
        () => parseToolOutput(actionPayload ?? args ?? result),
        [actionPayload, args, result]
    );

    const isWebSearch = toolName === 'web_search' || toolName === 'search_web';

    return (
        <div className={`cb-tool-invocation ${status}`}>
            <div className="cb-tool-header" onClick={() => setExpanded(!expanded)}>
                <div className="cb-tool-icon">
                    {status === 'running' ? (
                        <div className="cb-spinner-sm" />
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="cb-icon-check">
                            <polyline points="20 6 9 17 4 12" />
                        </svg>
                    )}
                </div>
                <span className="cb-tool-name">
                    <span style={{ opacity: 0.7 }}>{status === 'running' ? 'Calling' : 'Used tool'}</span>
                    <strong>{toolName}</strong>
                </span>
                <span className="cb-tool-chevron">
                    <svg
                        width="16" height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)' }}
                    >
                        <path d="M6 9l6 6 6-6" />
                    </svg>
                </span>
            </div>
            {onAction && status === 'completed' && (
                <div className="cb-tool-action-row">
                    {renderAction ? renderAction({
                        onAction: () => onAction(actionValue),
                        payload: actionValue,
                        toolName,
                        label: actionLabel,
                    }) : (
                    <button
                        className="cb-tool-action-btn"
                        onClick={() => onAction(actionValue)}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        {actionLabel}
                    </button>
                    )}
                </div>
            )}
            {expanded && (
                <div className="cb-tool-details">
                    {isWebSearch && result ? (
                        <div className="cb-web-search-results">
                            <div style={{ marginBottom: '8px', opacity: 0.8, fontSize: '12px' }}>Search Results:</div>
                            <div className="cb-markdown-content" style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                            </div>
                        </div>
                    ) : (
                        <div className="cb-code-block">
                            <div style={{ marginBottom: '4px', opacity: 0.5 }}>Arguments:</div>
                            {JSON.stringify(args, null, 2)}
                            {result && (
                                <>
                                    <div style={{ marginTop: '8px', marginBottom: '4px', opacity: 0.5 }}>Result:</div>
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


