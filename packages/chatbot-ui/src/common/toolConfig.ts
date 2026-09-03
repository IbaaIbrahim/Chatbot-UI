import type * as React from 'react';

/**
 * One tool's whole frontend contract, keyed by slug in ``ChatApp``'s ``tools``
 * prop.
 *
 * A tool call has two ends and a host application can only sit on one of them,
 * decided by the tool's ``quota.tools.dispatch_mode`` — so which handler field
 * an entry carries is what says where that entry lives:
 *
 * | | {@link ClientToolConfig} (`run`) | {@link ServerToolConfig} (`preview`) |
 * |---|---|---|
 * | `quota.tools.dispatch_mode` | `client` | `kafka` / `inline` |
 * | SSE event | `client_tool_call` | `tool_result` |
 * | Receives | the agent's ``tool_input`` | the worker's ``tool_output`` |
 * | Return value | posted back to resume the suspended job | ignored |
 * | Runs on arrival | always — the job is waiting | unless ``autoRun: false`` |
 *
 * The two are **not** interchangeable, and an entry may carry only one of them:
 * a ``kafka``/``inline`` tool emits no ``client_tool_call``, so a ``run``
 * registered for one would never fire, and a ``client`` tool's ``tool_output``
 * is only the ``{ status: 'previewed' }`` ack its own handler produced. Before
 * these were one type that mistake compiled and failed silently; now it does
 * not compile.
 */
export type ToolConfig = ClientToolConfig | ServerToolConfig;

/**
 * A tool that executes in this browser — ``dispatch_mode = 'client'``, or
 * defined inline here via {@link ClientToolConfig.definition}.
 */
export interface ClientToolConfig extends ToolPresentation {
    /**
     * Called when the agent invokes this tool. ``input`` is the raw
     * ``tool_input`` object from the ``client_tool_call`` SSE event.
     *
     * The agent's call suspends the job and the client awaits this before
     * resuming it:
     *  - Return ``undefined`` (or nothing) for a fire-and-forget side effect
     *    (e.g. opening a preview modal). The job is acked immediately with a
     *    ``{ status: 'previewed' }`` placeholder.
     *  - Return a value — or a Promise that resolves once the user has acted
     *    (e.g. submitted a form) — to send that value back to the agent as the
     *    tool result.
     *
     * Always fired on arrival: the run is suspended awaiting the return value,
     * which is why there is no ``autoRun`` on this side of the union.
     */
    run: (input: any, context: ToolCallContext) => any | Promise<any>;
    /**
     * Optional inline tool definition. When present it is sent to the gateway
     * as a dynamic ``client_tools`` entry on each job, so no backend tool row
     * is required — the agent can call it purely on the strength of this
     * schema. Omit it for tools already registered in the backend (``run``
     * still fires on ``client_tool_call``).
     */
    definition?: ClientToolDefinition;
    preview?: never;
    autoRun?: never;
}

/**
 * A tool that executes server-side — ``dispatch_mode`` of ``kafka`` or
 * ``inline``. The host application sees only its output.
 */
export interface ServerToolConfig extends ToolPresentation {
    /**
     * Called with the tool's output. Read-only: the job never suspends for a
     * preview, so nothing is waiting on what this returns.
     *
     * Fired when the ``tool_result`` event arrives (unless
     * {@link ServerToolConfig.autoRun} is ``false``) and again whenever the
     * user clicks the step's action, including after a conversation reload.
     *
     * A JSON-string ``tool_output`` — what a ``BaseTool.execute`` returns —
     * is parsed before the handler sees it; anything unparseable is passed
     * through verbatim.
     */
    preview: (output: any, context: ResultPreviewContext) => void | Promise<void>;
    /**
     * Fire {@link ServerToolConfig.preview} the moment the result arrives.
     * Default ``true``.
     *
     * Set ``false`` to make the preview click-only, which is the right choice
     * for a result that is only meaningful complete, or for a handler that
     * navigates or mutates rather than just displaying. Note that the once-per-
     * step guard against a *resume* replaying old results cannot survive a page
     * reload — the host application's panels are gone by then too — so this is
     * the only way to stop a previewer re-firing when a finished conversation
     * is re-opened.
     *
     * Absent from {@link ClientToolConfig} on purpose: a client tool's run is
     * suspended awaiting its return value and must fire.
     */
    autoRun?: boolean;
    run?: never;
    definition?: never;
}

/**
 * How a tool's completed step presents its action control — shared by both
 * kinds of tool.
 *
 * Having a handler is what makes an action *possible*; this is what decides
 * whether it is *offered*. The two are separate on purpose: a tool like
 * `read_page_context` returns data to the agent and has nothing a user would
 * re-open, while `generate_checklist` produces something they will want to look
 * at again — but both need a handler to work at all.
 */
export interface ToolPresentation {
    /**
     * Offer the action control on this tool's completed step. Default `true`.
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
    /**
     * Where the control appears. Default `'step'`.
     *
     * The default puts it on the step, which is right for a tool the user
     * watched run. It is wrong in two situations, and each has a value here:
     *
     * - `'turn'` — the control moves to a row at the end of the assistant's
     *   message, **outside** any collapsed block it was nested in. A tool called
     *   by a sub-agent renders inside that sub-agent's block, which is collapsed
     *   by default; a button in there is a button nobody clicks. Hoisting is not
     *   a styling preference, it is the difference between reachable and not.
     * - `'turn-end'` — same place, but it waits until the whole turn has
     *   finished. For a result that is only meaningful complete: offering "open
     *   the report" while the agent is still adding to it invites the user to
     *   look at half of it.
     *
     * Declared here, per tool, rather than inferred from context, because only
     * the host application knows whether a given tool's output is worth
     * interrupting the reader for.
     *
     * Governs the *button* only. To stop a preview opening itself mid-turn, pair
     * this with {@link ServerToolConfig.autoRun}.
     */
    placement?: ToolActionPlacement;
}

/** Where a tool's action control is offered. See {@link ToolPresentation.placement}. */
export type ToolActionPlacement = 'step' | 'turn' | 'turn-end';

/** What a custom action control is handed to render itself. */
export interface ToolActionRenderProps {
    /** Fire the registered handler with the payload it expects. */
    onAction: () => void;
    /**
     * The payload `onAction` will pass — the tool's arguments for a client
     * tool, its output for a server tool. Given so a custom control can label
     * itself from the data ("Open 5S Audit Scorecard") rather than only from
     * the tool slug.
     */
    payload: any;
    toolName: string;
    /** The resolved label, whether the default or one set on the config. */
    label: string;
}

/** Which call a handler is being invoked for. */
export interface ToolCallContext {
    /** The slug of the tool being called. */
    tool_slug: string;
    /** The step this call belongs to — stable across a reload. */
    step_uuid: string;
    /** The job that made the call, when the caller knows it. */
    job_uuid?: string;
}

/** Where a server tool's output came from, for handlers that care. */
export interface ResultPreviewContext extends ToolCallContext {
    /** Always ``'completed'`` today; failures are not previewed. */
    status: string;
}

/**
 * A dynamic ("bring-your-own") client tool definition sent to the gateway on
 * job creation. The agent sees these like any other tool; there is no backend
 * registration. The registration key (slug) becomes the tool ``name``.
 */
export interface ClientToolDefinition {
    /** What the tool does — shown to the model to decide when to call it. */
    description: string;
    /** JSON Schema for the tool arguments. Must be ``{ "type": "object", ... }``. */
    input_schema: Record<string, any>;
    /**
     * Ask the user to approve each call before ``run`` fires (ADR-006).
     *
     * The orchestrator holds the call, emits an ``approval_request`` event, and
     * only dispatches it once the user has agreed — so ``run`` never sees a call
     * the user refused, and needs no confirmation of its own.
     *
     * This is how an app gates a tool it declared itself. A **backend-registered**
     * tool is gated by its execution profile instead, per tenant, in the Admin
     * Dashboard; setting it here would have nothing to resolve against, because
     * an app-supplied tool has no ``quota.tools`` row and no policy.
     *
     * Turn it on for anything that spends money, reaches a system outside the
     * platform, or changes what the user is looking at.
     */
    requires_approval?: boolean;
}

/**
 * Which end of the call an entry handles.
 *
 * Written as a ``typeof`` check rather than ``'run' in config``: the opposite
 * variant declares the key as ``?: never``, so ``in`` keeps both members of the
 * union in its true branch and narrows nothing. Every call site goes through
 * these two functions for that reason — inlining the ``in`` test compiles and
 * then leaves the handler possibly-undefined.
 */
export const isClientTool = (config: ToolConfig): config is ClientToolConfig =>
    typeof (config as ClientToolConfig).run === 'function';

/** See {@link isClientTool}. */
export const isServerTool = (config: ToolConfig): config is ServerToolConfig =>
    typeof (config as ServerToolConfig).preview === 'function';
