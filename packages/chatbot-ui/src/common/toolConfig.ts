import type * as React from 'react';
import { DEFAULT_LABELS, type ChatLabels, type LabelKey } from './labels';

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
     * Optional inline tool definition, so no backend tool row is required —
     * the agent can call the tool purely on the strength of this schema. Omit
     * it for tools already registered in the backend (``run`` still fires on
     * ``client_tool_call``).
     *
     * How the platform learns it depends on the chat's mode:
     *
     *  - **Central mode** (no agent on the client): nothing is sent with the
     *    message. The platform asks this browser for it when the model searches
     *    for a tool or loads one (the host catalogue — platform ADR-018,
     *    "Host catalogue and conversation-scoped loads"), and the client answers
     *    from whatever is registered at that moment. A loaded tool stays loaded
     *    for the conversation until it is compacted.
     *  - **Agent-bound** (``agentId`` on the client): sent as a ``client_tools``
     *    entry on each job, as before.
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
     * Human-readable display name for this tool. Shown in step badges,
     * sub-agent summaries, and group headers in place of the tool slug key —
     * live and in a reloaded conversation, since the name is worked out when a
     * row is drawn. The library does not translate it: pass it in the user's
     * language (and a new `tools` map when the language changes).
     */
    name?: string;
    /** Alias for {@link name}. */
    displayName?: string;
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
    /**
     * What the call returned, parsed — a client tool's `run` result, a server
     * tool's output — or `undefined` before there is one. A control for an
     * action that has already happened reads it to offer the outcome rather
     * than the action: "Open the imported checklist", not a second import.
     */
    result?: any;
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
 * A dynamic ("bring-your-own") client tool definition. The agent sees these
 * like any other tool; there is no backend registration. The registration key
 * (slug) becomes the tool ``name``.
 *
 * An agent-bound chat sends every definition with each job (``client_tools``).
 * A central-mode chat sends none: the platform reads them from this browser
 * when the model searches for or loads a tool (see
 * {@link ClientToolConfig.definition}).
 */
export interface ClientToolDefinition {
    /** Optional display name for the tool. */
    name?: string;
    /** Alias for {@link name}. */
    displayName?: string;
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
    /**
     * Let a **delegated sub-agent** call this tool too (ADR-008).
     *
     * A sub-agent is its own job, and the tools on this request reach only the
     * agent the user is talking to unless they are marked here. Share a tool a
     * worker needs to check its own result (a validator, a lookup) so it can
     * fix its work before handing it up. Leave it off for anything that shows
     * the user something or acts for them: that is the parent's job, and an
     * agent offered a tool will use it.
     *
     * The browser runs a sub-agent's call exactly like its parent's. A handoff
     * sub-agent takes the turn over and receives every tool regardless.
     */
    share_with_sub_agents?: boolean;
    /**
     * @deprecated Meaningless since the host catalogue (platform ADR-018,
     * "Host catalogue and conversation-scoped loads"); drop it.
     *
     * It kept a tool out of the model's context in central mode until
     * ``load_tool`` or ``load_skill`` brought it in, at a time when a
     * central-mode chat sent every definition with each message and loaded the
     * rest from the first step. A central-mode chat now sends none: every host
     * tool is found with ``search_tools`` and loaded on demand, so every tool
     * is "deferred". Still sent with an agent-bound chat's ``client_tools``
     * when set, where the platform has always ignored it (an agent's run
     * offers its whole tool set).
     */
    defer_loading?: boolean;
    /**
     * Slugs of the skills that bring this tool: ``load_skill`` of any of them
     * loads it (ADR-018) — a platform skill, or one of this application's own
     * {@link ClientSkillDefinition client skills}. A platform skill's own tool
     * bindings can only name tools registered on the platform, so a host tool
     * declares its skills from this side. Each must look like a skill slug
     * (``^[a-z0-9][a-z0-9_-]{0,99}$``); at most 16.
     *
     * A tool that names no skill is still reachable: ``search_tools`` finds it
     * by name and description, and ``load_tool`` loads it.
     */
    skills?: string[];
}

/**
 * A skill this application ships itself — a "client skill": instructions the
 * model loads with ``load_skill`` when a conversation needs them, plus every
 * host tool whose {@link ClientToolDefinition.skills} names this slug.
 *
 * Passed to the provider's ``skills`` prop (or `GatewayStreamClient.setSkills`)
 * and never sent with a message. In central mode the platform asks this
 * browser for them: ``search_skills`` ranks them beside the platform's skills
 * (name and description only), and ``load_skill`` fetches the instructions
 * and the member tools — so a skill that changes with a deploy of the host is
 * current on the next load, with no sync step. When a platform skill has the
 * same slug, a user's or tenant's own skill wins over this one, and this one
 * wins over the partner's and the platform's (ADR-018).
 *
 * The platform checks each answer before the model sees it, so an entry
 * outside these bounds is left out rather than failing the turn:
 *
 *  - ``slug``: ``^[a-z0-9][a-z0-9_-]{0,99}$``.
 *  - ``name``, ``description``: non-empty, at most 1000 characters each.
 *  - ``instructions``: 1 to 65 536 characters.
 *
 * Agent-bound chats never load skills (an agent's run offers its whole tool
 * set and has no meta-tools), so there these are simply unused.
 */
export interface ClientSkillDefinition {
    /** The key ``load_skill`` and {@link ClientToolDefinition.skills} name it by. */
    slug: string;
    /** What the model, and the "Loaded skill · …" row, call it. */
    name: string;
    /** When to load it — what ``search_skills`` ranks and shows the model. */
    description: string;
    /** What the model is told once the skill is loaded, as Markdown or plain text. */
    instructions: string;
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

/**
 * The platform's tools, by slug, and the label that names each — matching the
 * ``quota.tools`` seeds in the backend services. Labels, so a host translates
 * them like every other text (`config.translations`); the library's English
 * for each is {@link DEFAULT_TOOL_NAMES}. A host names its own tools — and
 * may rename one of these — with its `tools` entry's `displayName`, which
 * wins over these.
 */
export const TOOL_NAME_LABELS: Readonly<Record<string, LabelKey>> = Object.freeze({
    context_retrieve: 'toolNameContextRetrieve',
    context_upsert: 'toolNameContextUpsert',
    context_upsert_user: 'toolNameContextUpsertUser',
    context_upsert_tenant: 'toolNameContextUpsertTenant',
    context_upsert_partner: 'toolNameContextUpsertPartner',
    web_search: 'toolNameWebSearch',
    search_web: 'toolNameWebSearch',
    fetch_web_page: 'toolNameFetchWebPage',
    generate_checklist: 'toolNameGenerateChecklist',
    read_page_context: 'toolNameReadPageContext',
    capture_page_screenshot: 'toolNameCapturePageScreenshot',
    navigate_app_route: 'toolNameNavigateAppRoute',
    generate_image: 'toolNameGenerateImage',
    get_file_description: 'toolNameGetFileDescription',
    analyze_file: 'toolNameAnalyzeFile',
    file_analyzer: 'toolNameAnalyzeFile',
    ask_user_questions: 'toolNameAskUserQuestions',
    generate_structured_output: 'toolNameGenerateStructuredOutput',
    structured_output: 'toolNameStructuredOutput',
    enhance_texts: 'toolNameEnhanceTexts',
    text_enhancer: 'toolNameTextEnhancer',
    translate_texts: 'toolNameTranslateTexts',
    translator: 'toolNameTranslator',
    preview_property_agent_result: 'toolNamePreviewPropertyAgentResult',
    properties_get_persona: 'toolNamePropertiesGetPersona',
    find_on_page: 'toolNameFindOnPage',
    read_page_diagnostics: 'toolNameReadPageDiagnostics',
    validate_checklist: 'toolNameValidateChecklist',
    // Kept for transcripts from before 4.0, when the host offered this client
    // tool; nothing calls it any more.
    switch_agent: 'toolNameSwitchAgent',
    checklist_read: 'toolNameChecklistRead',
    checklist_apply_suggestions: 'toolNameChecklistApplySuggestions',
    read_translation_context: 'toolNameReadTranslationContext',
    propose_translations: 'toolNameProposeTranslations',
    show_step_output: 'toolNameShowStepOutput',
    find_conversation_artifacts: 'toolNameFindConversationArtifacts',
    get_step_details: 'toolNameGetStepDetails',
    // The platform's meta-tools (central mode). A step of one renders as what
    // it did — "Loaded skill · …" — unless the host names the tool itself; see
    // common/metaTools.ts. These names are what the generic row falls back to.
    search_tools: 'toolNameSearchTools',
    load_tool: 'toolNameLoadTool',
    search_skills: 'toolNameSearchSkills',
    load_skill: 'toolNameLoadSkill',
} satisfies Record<string, LabelKey>);

/**
 * The platform's tool names in the library's English, by slug: the English of
 * {@link TOOL_NAME_LABELS}. Kept for hosts that read it; the chat itself
 * names a tool through the labels, in the chat's language, and no longer
 * reads this map — name a tool with its `tools` entry's `displayName`, or
 * translate its label.
 */
export const DEFAULT_TOOL_NAMES: Record<string, string> = Object.fromEntries(
    Object.entries(TOOL_NAME_LABELS).map(([slug, key]) => [slug, DEFAULT_LABELS[key] as string]),
);

/**
 * Convert a snake_case or kebab-case tool slug into Title Case words.
 * Example: ``custom_data_fetch`` -> ``Custom Data Fetch``
 */
export const formatToolSlug = (slug: string): string => {
    if (!slug) return '';
    return slug
        .split(/[_-]+/)
        .filter(Boolean)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
};

/**
 * Whether the host named this tool itself — a `name` or `displayName` on its
 * entry or on the entry's `definition`. A meta-tool step keeps the host's name
 * in the generic row rather than the built-in summary: a host that renamed it
 * meant that name to be read.
 */
export const hasHostDisplayName = (slug: string, tools?: Record<string, ToolConfig>): boolean => {
    const config = tools?.[slug];
    return Boolean(
        config?.name || config?.displayName || config?.definition?.name || config?.definition?.displayName
    );
};

/** How {@link resolveToolDisplayName} names what the host has not. */
export interface ToolNameOptions {
    /** The labels in force (`useLabels()`): the platform's tools are named in them. Default: the library's English. */
    labels?: Pick<ChatLabels, 'toolName'> & Partial<Record<LabelKey, unknown>>;
    /** The platform's own name for the tool (an event's `tool_name`): used for a slug no label names. */
    rawName?: string | null;
    /** What a call with neither a name nor a slug is called. Default: `labels.toolName`. */
    fallback?: string;
}

/**
 * The name a tool is shown by, worked out when it is drawn — so it follows
 * the host's `tools` and the chat's language, live and in a reloaded
 * conversation alike.
 *
 * Precedence:
 * 1. The host's ``name`` or ``displayName`` on the tool's entry, or on its definition.
 * 2. The platform tool's label ({@link TOOL_NAME_LABELS}) in `labels` — `web_search` → "Web search", or its translation.
 * 3. `rawName`, the platform's own name for it.
 * 4. A name already in words (spaces, no underscores) as it is.
 * 5. The slug in Title Case words (``my_custom_tool`` → ``My Custom Tool``).
 *
 * The third argument may still be a plain fallback text, as before 4.2.
 */
export const resolveToolDisplayName = (
    slugOrName: string,
    tools?: Record<string, ToolConfig>,
    options: string | ToolNameOptions = {},
): string => {
    const { labels = DEFAULT_LABELS, rawName, fallback } = typeof options === 'string' ? { fallback: options } : options;
    const raw = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
    const key = slugOrName || raw;
    if (!key) return fallback ?? labels.toolName ?? DEFAULT_LABELS.toolName;
    const config = tools?.[key] ?? (raw ? tools?.[raw] : undefined);
    if (config?.name) return config.name;
    if (config?.displayName) return config.displayName;
    if (config?.definition?.name) return config.definition.name;
    if (config?.definition?.displayName) return config.definition.displayName;
    const labelKey = Object.prototype.hasOwnProperty.call(TOOL_NAME_LABELS, key) ? TOOL_NAME_LABELS[key] : undefined;
    if (labelKey) {
        const named = (labels as Record<string, unknown>)[labelKey];
        return typeof named === 'string' && named.trim() ? named : DEFAULT_LABELS[labelKey] as string;
    }
    if (raw && raw !== key) return raw;
    // A name already in words, not a slug: as it is.
    if (key.includes(' ') && !key.includes('_')) return key;
    return formatToolSlug(key);
};
