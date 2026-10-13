/**
 * Every string the chat shows a user, in one place.
 *
 * A host translates the chat by passing `config.labels` — a partial map; any
 * key it leaves out keeps the English default below. Templates use `{name}`
 * placeholders rather than functions so a label can come straight out of a
 * translation file; fill them with {@link formatLabel}.
 */
export interface ChatLabels {
    // Header
    brandTitle: string;
    openSidebar: string;
    closeSidebar: string;
    newChat: string;
    newChatTitle: string;
    share: string;
    moreOptions: string;
    /** The menu entry that opens the list of views. */
    switchView: string;
    /** Views by name, in that list. */
    viewFloating: string;
    viewSidebar: string;
    viewFullscreen: string;
    /** The menu entry and the dialog's title. */
    creditUsage: string;
    /** Shown instead of the link entry when the host builds no links. */
    copyConversationId: string;
    copiedConversationId: string;
    /** The menu entry when the provider has `conversationLink`. */
    copyConversationLink: string;
    copiedConversationLink: string;
    deleteThread: string;
    /** The same entry after one click, asking for the second. */
    confirmDeleteThread: string;
    closeChat: string;
    openChat: string;

    // Sidebar
    sidebarTitle: string;
    collapseSidebar: string;
    searchPlaceholder: string;
    starred: string;
    starredEmpty: string;
    recents: string;
    searchResults: string;
    noSearchResults: string;
    star: string;
    unstar: string;
    /** A row's menu: the button that opens it, and its entries. */
    conversationActions: string;
    renameConversation: string;
    /** The rename field's accessible name. */
    conversationTitle: string;
    deleteConversation: string;
    /** The delete entry after one click, asking for the second. */
    confirmDeleteConversation: string;
    untitledConversation: string;
    loadMore: string;
    loading: string;
    noHistoryTitle: string;
    noHistoryBody: string;
    today: string;
    yesterday: string;
    previous7Days: string;
    older: string;

    // Transcript area
    scrollToLatest: string;
    staleClientCall: string;
    greetingTitle: string;

    // Composer
    composerPlaceholder: string;
    questionnairePlaceholder: string;
    dropFiles: string;
    addAttachment: string;
    attachmentsUnavailable: string;
    removeAttachment: string;
    uploadingFiles: string;
    unsupportedFileType: string;
    fileTooLarge: string;
    uploadNeedsStorageUrl: string;
    uploadNeedsToken: string;
    uploadFailed: string;
    tools: string;
    voiceInput: string;
    send: string;
    waitingForUploads: string;
    stop: string;
    stopping: string;
    disclaimer: string;

    // Messages
    /**
     * Who a live reply is from. A reloaded turn shows the name of the agent
     * that ran it, from the conversation's history; no stream event names the
     * agent, so the turn in progress shows this instead.
     */
    assistantName: string;
    copy: string;
    copied: string;
    reply: string;
    edit: string;
    retry: string;
    continue: string;
    thinking: string;
    thoughtBriefly: string;
    show: string;
    hide: string;
    toolCalling: string;
    toolUsed: string;
    toolRunning: string;
    toolFailed: string;
    toolRan: string;
    openResult: string;
    openPreview: string;
    toolArguments: string;
    toolResult: string;
    searchResultsHeading: string;
    previousVersion: string;
    nextVersion: string;
    confirm: string;
    cancel: string;
    executingTool: string;
    confirmedExecuting: string;
    cancelled: string;

    // Meta-tool steps: how a central-mode run finds and loads tools and skills.
    // Shown in place of the generic tool row; see `describeMetaTool`.
    metaSearchingTools: string;
    metaSearchedTools: string;
    metaLoadingTools: string;
    /** `{names}`: the loaded tools, comma-separated. */
    metaLoadedTools: string;
    metaSearchingSkills: string;
    metaSearchedSkills: string;
    metaLoadingSkill: string;
    /** `{name}`: the skill's name, else its slug. */
    metaLoadedSkill: string;
    /** `{count}`: tools the platform would not load. Appended in brackets. */
    metaRefused: string;

    // The activity section: consecutive thinking, tool calls and sub-agent runs
    // drawn as one collapsible row (`common/activity.ts`). Its finished header
    // joins these phrases with `activitySeparator`, the first letter capitalised,
    // so they are written lower-case: "Thought 4 times · ran List Inspections".
    /** `{count}` thoughts. */
    activityThoughtOne: string;
    activityThoughtOther: string;
    /** `{count}` tool and skill searches. */
    activitySearchedOne: string;
    activitySearchedOther: string;
    /** `{count}` skills loaded. */
    activityLoadedSkillOne: string;
    activityLoadedSkillOther: string;
    /** `{count}` `load_tool` calls. */
    activityLoadedToolsOne: string;
    activityLoadedToolsOther: string;
    /** One call: `{name}`, the tool. */
    activityRanOne: string;
    /** One tool, `{count}` calls: `{name}`, `{count}`. */
    activityRanRepeated: string;
    /** `{count}` calls to several tools. */
    activityRanOther: string;
    /** One sub-agent: `{name}`. */
    activityAgentOne: string;
    /** `{count}` sub-agent runs. */
    activityAgentOther: string;
    /** A sub-agent still running, in the live header: `{name}`. */
    activityAgentWorking: string;
    /** `{count}` failed steps, last. */
    activityFailed: string;
    /** Between the phrases of a finished header. */
    activitySeparator: string;

    // Attachment viewer
    close: string;
    closeAttachment: string;
    attachmentLoadFailed: string;
    attachmentNoAuth: string;
    pdfLoadFailed: string;

    // Questionnaire
    answerPlaceholder: string;
    /** The free-text choice appended to a choice question. */
    otherOption: string;
    customAnswerPlaceholder: string;
    previousQuestion: string;
    nextQuestion: string;
    submit: string;
    submitted: string;

    // Usage
    usageTitle: string;
    usageFootnote: string;
    usageUpdating: string;
    usageTrigger: string;
    usageSummaryWithWindow: string;
    usageSummary: string;
    usageContextWindow: string;
    usageLimitUnknown: string;
    usageLastPromptNote: string;
    usageSubAgentContext: string;
    usageLargestPrompt: string;
    usageOwnContextNote: string;
    usageNearLimit: string;
    usageThisTurn: string;
    usageThisAgent: string;
    usageSubAgents: string;
    usageWholeConversation: string;
    usageFreeCalls: string;
    usageWaived: string;
    usageSubAgentTree: string;
    usageTreeLimitReached: string;
    usageTokens: string;
    /** Counts take a one/other pair: `{count} credit` / `{count} credits`. */
    creditsOne: string;
    creditsOther: string;
    stepsOne: string;
    stepsOther: string;
    turnsOne: string;
    turnsOther: string;

    // Credit usage (the dialog; `creditUsage` above is its title)
    /** The caption under the number left, one/other like the counts above. */
    creditsLeftOne: string;
    creditsLeftOther: string;
    creditsUsedOfCap: string;
    creditGrantPlan: string;
    creditGrantTopUp: string;
    creditGrantLeft: string;
    creditsValidUntil: string;
    creditsNoLimitTitle: string;
    creditsNoLimitBody: string;
    /** `{credits}` is a count, filled from `creditsOne` / `creditsOther`. */
    creditsUsedThisMonth: string;
    creditsBlockedUser: string;
    creditsBlockedOrganization: string;
    creditsBlockedProvider: string;
    creditsBlockedNoPlan: string;
    creditsLoadFailed: string;
    creditsUnavailable: string;
}

export const DEFAULT_LABELS: ChatLabels = {
    brandTitle: 'AI Assistant',
    openSidebar: 'Open sidebar',
    closeSidebar: 'Close sidebar',
    newChat: 'New chat',
    newChatTitle: 'Start a new chat',
    share: 'Share conversation',
    moreOptions: 'More options',
    switchView: 'Switch view',
    viewFloating: 'Floating chat',
    viewSidebar: 'Side panel',
    viewFullscreen: 'Full screen',
    creditUsage: 'Credit usage',
    copyConversationId: 'Copy conversation ID',
    copiedConversationId: 'Copied ID!',
    copyConversationLink: 'Copy conversation link',
    copiedConversationLink: 'Link copied!',
    deleteThread: 'Delete thread',
    confirmDeleteThread: 'Click again to delete',
    closeChat: 'Close chat',
    openChat: 'Open chat',

    sidebarTitle: 'Chats',
    collapseSidebar: 'Collapse sidebar',
    searchPlaceholder: 'Search',
    starred: 'Starred',
    starredEmpty: 'Click the star on any conversation to add it here for later.',
    recents: 'Recents',
    searchResults: 'Results',
    noSearchResults: 'No conversations match your search.',
    star: 'Star',
    unstar: 'Remove from starred',
    conversationActions: 'Conversation options',
    renameConversation: 'Rename',
    conversationTitle: 'Conversation title',
    deleteConversation: 'Delete',
    confirmDeleteConversation: 'Click again to delete',
    untitledConversation: 'Untitled conversation',
    loadMore: 'Load more',
    loading: 'Loading…',
    noHistoryTitle: 'No chat history',
    noHistoryBody: 'Start a chat to view your conversations here.',
    today: 'Today',
    yesterday: 'Yesterday',
    previous7Days: 'Previous 7 days',
    older: 'Older',

    scrollToLatest: 'Scroll to latest message',
    staleClientCall: 'This turn is waiting on a response from this page that can no longer be delivered.',
    greetingTitle: 'What would you like to do?',

    composerPlaceholder: 'Describe what you want to do…',
    questionnairePlaceholder: 'Answer the questions above…',
    dropFiles: 'Drop files to attach',
    addAttachment: 'Add attachment',
    attachmentsUnavailable: 'Storage URL not configured',
    removeAttachment: 'Remove',
    uploadingFiles: 'Uploading {count} file(s)…',
    unsupportedFileType: 'Unsupported file type: {type}',
    fileTooLarge: 'File too large ({size}). Max: {max}',
    uploadNeedsStorageUrl: 'File upload is unavailable: no storage API URL is configured.',
    uploadNeedsToken: 'File upload is unavailable: no access token is configured.',
    uploadFailed: 'File upload failed',
    tools: 'Tools',
    voiceInput: 'Voice input',
    send: 'Send message',
    waitingForUploads: 'Waiting for uploads…',
    stop: 'Stop generating',
    stopping: 'Stopping…',
    disclaimer: 'This is AI, and can make mistakes. Very results.',

    assistantName: 'Assistant',
    copy: 'Copy',
    copied: 'Copied!',
    reply: 'Reply',
    edit: 'Edit',
    retry: 'Retry',
    continue: 'Continue',
    thinking: 'Thinking…',
    thoughtBriefly: 'Thought for a few seconds',
    show: 'Show',
    hide: 'Hide',
    toolCalling: 'Calling',
    toolUsed: 'Used tool',
    toolRunning: 'Running',
    toolFailed: 'Failed',
    toolRan: 'Ran',
    openResult: 'Open result',
    openPreview: 'Open preview',
    toolArguments: 'Arguments:',
    toolResult: 'Result:',
    searchResultsHeading: 'Search results:',
    previousVersion: 'Previous version',
    nextVersion: 'Next version',
    confirm: 'Confirm',
    cancel: 'Cancel',
    executingTool: 'Executing {name}…',
    confirmedExecuting: 'Confirmed - executing…',
    cancelled: 'Cancelled',

    metaSearchingTools: 'Searching tools…',
    metaSearchedTools: 'Searched tools',
    metaLoadingTools: 'Loading tools…',
    metaLoadedTools: 'Loaded tools · {names}',
    metaSearchingSkills: 'Searching skills…',
    metaSearchedSkills: 'Searched skills',
    metaLoadingSkill: 'Loading skill…',
    metaLoadedSkill: 'Loaded skill · {name}',
    metaRefused: '{count} refused',

    activityThoughtOne: 'thought once',
    activityThoughtOther: 'thought {count} times',
    activitySearchedOne: 'searched once',
    activitySearchedOther: 'searched {count} times',
    activityLoadedSkillOne: 'loaded a skill',
    activityLoadedSkillOther: 'loaded {count} skills',
    activityLoadedToolsOne: 'loaded tools',
    activityLoadedToolsOther: 'loaded tools {count} times',
    activityRanOne: 'ran {name}',
    activityRanRepeated: 'ran {name} {count} times',
    activityRanOther: 'ran {count} tools',
    activityAgentOne: 'used {name}',
    activityAgentOther: 'used {count} agents',
    activityAgentWorking: '{name} is working…',
    activityFailed: '{count} failed',
    activitySeparator: ' · ',

    close: 'Close',
    closeAttachment: 'Close attachment',
    attachmentLoadFailed: 'Failed to load attachment',
    attachmentNoAuth: 'No authentication context available',
    pdfLoadFailed: 'Failed to load PDF.',

    answerPlaceholder: 'Type your answer…',
    otherOption: 'Other',
    customAnswerPlaceholder: 'Enter custom answer',
    previousQuestion: 'Previous question',
    nextQuestion: 'Next question',
    submit: 'Submit',
    submitted: 'Submitted',

    usageTitle: 'Your usage · this conversation',
    usageFootnote: 'Updates after every step. Each step is charged once it completes.',
    usageUpdating: 'updating',
    usageTrigger: 'Consumption. {summary}',
    usageSummaryWithWindow: 'Context window {percent} used; {turnCredits} this turn; {conversationCredits} this conversation.',
    usageSummary: '{turnCredits} this turn; {conversationCredits} this conversation.',
    usageContextWindow: 'Context window',
    usageLimitUnknown: '{tokens} · limit unknown',
    usageLastPromptNote: "this agent's last prompt",
    usageSubAgentContext: 'Sub-agent · {name}',
    usageLargestPrompt: 'largest prompt',
    usageOwnContextNote: 'its own context; ends with the run',
    usageNearLimit: "The conversation is near the model's limit. Start a new one to keep answers reliable.",
    usageThisTurn: 'This turn',
    usageThisAgent: 'This agent',
    usageSubAgents: 'Sub-agents ({count})',
    usageWholeConversation: 'Whole conversation',
    usageFreeCalls: 'Free calls this turn',
    usageWaived: '{credits} waived',
    usageSubAgentTree: 'Sub-agent tree',
    usageTreeLimitReached: 'limit reached — no new sub-agents this turn',
    usageTokens: '{input} in · {output} out · {steps}',
    creditsOne: '{count} credit',
    creditsOther: '{count} credits',
    stepsOne: '{count} step',
    stepsOther: '{count} steps',
    turnsOne: '{count} turn',
    turnsOther: '{count} turns',

    creditsLeftOne: 'credit left',
    creditsLeftOther: 'credits left',
    creditsUsedOfCap: '{used} of {cap} used',
    creditGrantPlan: 'Plan allowance',
    creditGrantTopUp: 'Top-up',
    creditGrantLeft: '{remaining} of {cap} left',
    creditsValidUntil: 'Until {date}',
    creditsNoLimitTitle: 'No personal limit',
    creditsNoLimitBody: "Your organization's allowance is the only limit on your use.",
    creditsUsedThisMonth: '{credits} used this month',
    creditsBlockedUser: "You've used your whole allowance, so new requests can't start until it's raised or renewed.",
    creditsBlockedOrganization: "Your organization's allowance is used up, so new requests can't start.",
    creditsBlockedProvider: "The account behind your organization is out of credits, so new requests can't start.",
    creditsBlockedNoPlan: "Your organization isn't on a plan yet, so requests can't start.",
    creditsLoadFailed: "Couldn't load your credit usage.",
    creditsUnavailable: "Credit usage isn't available on this server.",
};

/**
 * Fill a label's `{name}` placeholders. A placeholder with no value is left as
 * written, so a missing value shows up in the UI instead of vanishing.
 */
/** A count with its noun: `one` for exactly 1, `other` otherwise. */
export function formatCount(count: number, one: string, other: string): string {
    return formatLabel(count === 1 ? one : other, { count });
}

export function formatLabel(template: string, values: Record<string, string | number>): string {
    return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
    );
}
