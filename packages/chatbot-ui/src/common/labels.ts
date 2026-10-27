/**
 * Every string the chat shows a user, in one place.
 *
 * The library ships English only: {@link DEFAULT_LABELS}. A host translates
 * the chat with `config.translations` — a partial map of these keys per
 * language — and says which language is in force with `config.language`; any
 * key a language leaves out falls back to its base language ("de-AT" → "de"),
 * then to `translations.en`, then to this English. `config.labels` still
 * overrides a key whatever the language (see `resolveLabels` in
 * common/i18n.ts, and the README's "Internationalisation").
 *
 * Templates use `{name}` placeholders rather than functions so a label can
 * come straight out of a translation file; fill them with {@link formatLabel}.
 * A label that counts something is a {@link PluralLabel} — one text per CLDR
 * plural category, chosen for the chat's language by {@link formatPlural} — so
 * Arabic, Russian or Polish can say "3 files" the way they do.
 */

/** The CLDR plural categories `Intl.PluralRules` chooses among. */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/** The order the categories are listed in, `other` last. */
export const PLURAL_CATEGORIES: readonly PluralCategory[] = Object.freeze(['zero', 'one', 'two', 'few', 'many', 'other']);

/**
 * A text per plural category, chosen with `Intl.PluralRules` for the chat's
 * language: `{ one: '{count} file', other: '{count} files' }` in English,
 * `{ zero, one, two, few, many, other }` in Arabic. A category the label does
 * not name uses `other`, which every plural label has.
 *
 * The categories are CLDR's, not numbers: in English `one` is 1 only, in
 * French it is 0 and 1, in Russian it is 1, 21, 31… — so a form says
 * `{count}` unless the language's category holds one number only.
 */
export interface PluralLabel {
    zero?: string;
    one?: string;
    two?: string;
    few?: string;
    many?: string;
    other: string;
}

/** What a host may give a label: a text, or — for a counting label — plural forms. A text is every form. */
export type LabelValue = string | PluralLabel;

/**
 * Every label, resolved for the language in force — what `useLabels()`
 * returns. A counting label is always plural forms here (a text given for one
 * becomes `{ other: text }`); read it with {@link formatPlural}.
 *
 * The 4.1 names of the counting labels ({@link DeprecatedLabels}) can still be
 * read from it, as texts: a 4.1 host's `formatCount(n, labels.creditsOne,
 * labels.creditsOther)` keeps working. They are not among {@link LABEL_KEYS}
 * and are not enumerable, so a loop over the labels never meets them.
 */
export interface ChatLabels extends DeprecatedLabels {
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
    /** `{count}` files on their way. */
    uploadingFiles: PluralLabel;
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
    /** `{count}`: tools the platform would not load. Appended in brackets ({@link ChatLabels.parenthetical}). */
    metaRefused: PluralLabel;

    // The activity section: consecutive thinking, tool calls and sub-agent runs
    // drawn as one collapsible row (`common/activity.ts`). Its finished header
    // joins these phrases with `activitySeparator`, the first letter capitalised,
    // so they are written lower-case: "Thought 4 times · ran List Inspections".
    // The counts are plural labels since 4.2 (see {@link PluralLabel}); the
    // 4.1 one/other pairs are deprecated aliases ({@link DEPRECATED_LABEL_ALIASES}).
    /** `{count}` thoughts. Was `activityThoughtOne` / `activityThoughtOther`. */
    activityThoughts: PluralLabel;
    /** `{count}` tool and skill searches. Was `activitySearchedOne` / `activitySearchedOther`. */
    activitySearches: PluralLabel;
    /** `{count}` skills loaded. Was `activityLoadedSkillOne` / `activityLoadedSkillOther`. */
    activitySkillLoads: PluralLabel;
    /** `{count}` `load_tool` calls. Was `activityLoadedToolsOne` / `activityLoadedToolsOther`. */
    activityToolLoads: PluralLabel;
    /** One call to one tool: `{name}`. Was `activityRanOne`. */
    activityRanTool: string;
    /** One tool, `{count}` calls (two or more): `{name}`, `{count}`. Was `activityRanRepeated`. */
    activityRanToolTimes: PluralLabel;
    /** `{count}` calls to several tools. Was `activityRanOther`. */
    activityRanTools: PluralLabel;
    /** One sub-agent: `{name}` — also a finished one in the live header. Was `activityAgentOne`. */
    activityUsedAgent: string;
    /** `{count}` sub-agent runs (two or more). Was `activityAgentOther`. */
    activityUsedAgents: PluralLabel;
    /** A sub-agent still running, in the live header: `{name}`. */
    activityAgentWorking: string;
    /** `{count}` failed steps, last. */
    activityFailed: PluralLabel;
    /** Between the phrases of a finished header. */
    activitySeparator: string;

    // Rich blocks: fences a host draws (`config.markdown.blockRenderers`).
    // `{label}` is the renderer's word for the block ("chart", "table").
    /** The skeleton while the fence streams. */
    blockPreparing: string;
    /** The fallback's first line; the reason follows after a colon. */
    blockFailed: string;
    blockShowSource: string;
    blockExpand: string;
    /** The block's "more actions" menu button. */
    blockMore: string;
    blockCopySource: string;
    /** Closes the expanded overlay. */
    blockClose: string;

    // Attachment viewer
    close: string;
    closeAttachment: string;
    attachmentLoadFailed: string;
    /** The storage API refused the file: `{status}`. Since 4.2. */
    attachmentLoadFailedStatus: string;
    attachmentNoAuth: string;
    pdfLoadFailed: string;
    /** The viewer's download button, and every file row's. */
    downloadFile: string;
    downloadFailed: string;
    /** Above a CSV preview cut short: `{shown}` of `{total}` rows, chosen by `{total}`. */
    previewTruncated: PluralLabel;

    // Conversation files (the header's files button) and artifacts (the
    // sidebar's entry): what a conversation has stored, and what the user saved.
    conversationFiles: string;
    conversationFilesEmpty: string;
    filesLoadFailed: string;
    /** The badge on a saved artifact. */
    fileArtifactBadge: string;
    /** The badge on a file the application produced (an export). */
    fileGeneratedBadge: string;
    previewFile: string;
    artifacts: string;
    artifactsEmpty: string;
    artifactsLoadFailed: string;
    searchArtifacts: string;
    /** The Artifacts view with nothing for the search typed. */
    noArtifactResults: string;
    /** The Artifacts view with nothing for a kind chip, nothing typed (2026-10-14). */
    noArtifactFilterResults: string;
    /** The kind chips' group, as a screen reader names it (2026-10-14). */
    artifactKindFilter: string;
    /** The kind filter's first chip. */
    artifactKindAll: string;
    artifactKindChart: string;
    artifactKindTable: string;
    artifactKindKpi: string;
    artifactKindReport: string;
    artifactKindFile: string;
    openConversation: string;
    /** An opened artifact's way back to the list (2026-10-14). */
    backToArtifacts: string;
    deleteArtifact: string;
    /** The delete entry after one click, asking for the second. */
    confirmDeleteArtifact: string;
    artifactDeleteFailed: string;

    // Saved and not saved (2026-10-14): everything the agent drew or
    // generated is an artifact; Save keeps it.
    /** The mark on a kept artifact — a block, a generated file, an artifact. */
    savedBadge: string;
    /** The mark on one drawn or generated and never saved. */
    notSavedBadge: string;
    /** A not-saved generated file's Save button. */
    saveFile: string;
    saveFileFailed: string;
    /** Said (a polite live region) when a Save from a list lands: `{title}` is the file's. */
    fileSavedAnnouncement: string;
    /** A block's "take me there" in the files panel. */
    showInChat: string;
    /** Why "Show in chat" is off: the answer is not in the transcript on screen. */
    showInChatUnavailable: string;
    /** A block without a title: `{label}` is its renderer's word ("chart"). */
    blockUntitled: string;
    /** A block whose language this page has no renderer for. */
    blockNoRenderer: string;
    blockLoadFailed: string;
    /** The files panel's filter: its group's name, then its chips. */
    filesFilter: string;
    filesFilterAll: string;
    filesFilterVisuals: string;
    filesFilterFiles: string;
    /** The files panel's Visuals filter with nothing in it. */
    conversationVisualsEmpty: string;
    /**
     * The files panel of a conversation with nothing in it (2026-10-14): a
     * heading, and a line saying what will appear. `conversationFilesEmpty`
     * is now the Files filter's empty message.
     */
    conversationFilesEmptyTitle: string;
    conversationFilesEmptyHint: string;
    /** The files panel's subtitle: `{count}` items, then `{count}` saved. `filesItems` was `filesItemsOne` / `filesItemsOther`. */
    filesItems: PluralLabel;
    filesSavedCount: PluralLabel;
    /** What a row is, first in its details line — one per kind of file or visual. */
    itemKindChart: string;
    itemKindTable: string;
    itemKindKpi: string;
    itemKindReport: string;
    itemKindFile: string;
    itemKindImage: string;
    itemKindPdf: string;
    itemKindSpreadsheet: string;
    /** The Artifacts view's saved filter: its group's name, then its options. */
    artifactStatus: string;
    artifactStatusAll: string;
    artifactStatusSaved: string;
    artifactStatusUnsaved: string;
    /** The Artifacts view with nothing saved yet (the Saved filter). */
    artifactsSavedEmpty: string;
    /**
     * The Artifacts view with nothing listed as not saved (the Not saved
     * filter). Not a claim that everything is saved: the platform lists a
     * turn's visuals only once it has ended, and never indexed turns from
     * before 4.1.
     */
    artifactsUnsavedEmpty: string;

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
    /** `{count}` sub-agents. */
    usageSubAgents: PluralLabel;
    usageWholeConversation: string;
    usageFreeCalls: string;
    usageWaived: string;
    usageSubAgentTree: string;
    usageTreeLimitReached: string;
    usageTokens: string;
    /**
     * Counts: `{count} credit` / `{count} credits`. Plural labels since 4.2;
     * were the pairs `creditsOne` / `creditsOther`, `stepsOne` / `stepsOther`,
     * `turnsOne` / `turnsOther`.
     */
    credits: PluralLabel;
    steps: PluralLabel;
    turns: PluralLabel;

    // Credit usage (the dialog; `creditUsage` above is its title)
    /** The caption under the number left, chosen by that number. Was `creditsLeftOne` / `creditsLeftOther`. */
    creditsLeft: PluralLabel;
    creditsUsedOfCap: string;
    creditGrantPlan: string;
    creditGrantTopUp: string;
    creditGrantLeft: string;
    creditsValidUntil: string;
    creditsNoLimitTitle: string;
    creditsNoLimitBody: string;
    /** `{credits}` is a count, filled from `credits`. */
    creditsUsedThisMonth: string;
    creditsBlockedUser: string;
    creditsBlockedOrganization: string;
    creditsBlockedProvider: string;
    creditsBlockedNoPlan: string;
    creditsLoadFailed: string;
    creditsUnavailable: string;
    /**
     * The composer's notice once a warning threshold is passed (since 4.3):
     * `{percent}` of the allowance used, `{credits}` the count left (filled
     * from `credits`). Out of credits, the notice says `creditsBlocked*`.
     */
    creditsWarning: string;
    /** The notice's button that opens the "Credit usage" dialog. Since 4.3. */
    creditsViewUsage: string;

    // "Memory & instructions" (since 4.4, ADR-021): the standing context every
    // conversation of the user is told. `standingContext` is the dialog's
    // title and the header menu's entry.
    standingContext: string;
    standingContextIntro: string;
    standingInstructions: string;
    standingInstructionsHint: string;
    standingMemories: string;
    standingMemoriesHint: string;
    /** The organisation's entries, which the user sees and cannot change. */
    standingOrganization: string;
    standingOrganizationHint: string;
    /** The organisation's section with nothing in force, when the dialog shows only it (since 4.5). */
    standingNoOrganization: string;
    /** The dialog's tabs, when it shows both parts (since 4.5): the user's own, and the organisation's. */
    standingTabPersonal: string;
    standingTabOrganization: string;
    standingNoInstructions: string;
    standingNoMemories: string;
    standingAddInstruction: string;
    standingAddMemory: string;
    standingInstructionPlaceholder: string;
    standingMemoryPlaceholder: string;
    /**
     * Under the text box: what saving does to its lines. Since 4.5 the Gateway
     * keeps them (the key's name is from 4.4, when it made one line).
     */
    standingOneLine: string;
    /** The end-date field's label. */
    standingUntilLabel: string;
    /** An entry's end date: `{date}`, written for the chat's language. */
    standingUntil: string;
    standingExpired: string;
    /** Removes an entry's end date. */
    standingNoEndDate: string;
    standingSavedByAssistant: string;
    standingSave: string;
    /** Characters written against the limit: `{count}`, `{limit}`. */
    standingCharacters: string;
    /** `{used}` of `{limit}` characters, all the user's instructions together. */
    standingInstructionsUsed: string;
    /** `{used}` of `{limit}` memories. */
    standingMemoriesUsed: string;
    standingDelete: string;
    standingConfirmDelete: string;
    standingErrorEmpty: string;
    /** `{limit}`: characters in one memory. */
    standingErrorMemoryTooLong: string;
    /** `{limit}`: characters of all the user's instructions together. */
    standingErrorInstructionsFull: string;
    /** `{limit}`: how many memories the user may keep. */
    standingErrorMemoriesFull: string;
    standingErrorExpiry: string;
    standingErrorGone: string;
    standingErrorSave: string;
    standingErrorDelete: string;
    standingLoadFailed: string;
    standingUnavailable: string;

    // --- Since 4.2 (2026-10-18): what the components and the hooks wrote in
    // English until then. Every user-visible text is a label now
    // (common/hardcodedText.test.ts keeps it so).

    // How a label and a name are put together, so a language orders and
    // punctuates them its own way.
    /** A control's name with what it acts on: "Download: Q3 report". `{action}`, `{item}`. */
    actionOnItem: string;
    /** The same, and why it cannot act now: `{action}`, `{item}`, `{reason}`. */
    actionOnItemUnavailable: string;
    /** A detail in brackets after a text — "Loaded tools · a (1 refused)": `{text}`, `{detail}`. */
    parenthetical: string;
    /** Words quoted as someone wrote them — a search's query: `{text}`. */
    quotedText: string;
    /** Where one is among several — a message's versions, a questionnaire's questions: `{current}` of `{total}`. */
    positionOf: string;
    /** A PDF's pages: `{page}` of `{total}`. */
    pageOf: string;
    /** A figure against its limit, with the share used: `{used}`, `{limit}`, `{percent}`. */
    usageOfLimit: string;

    // Units. `{size}`, `{value}`, `{seconds}` and `{minutes}` are numbers
    // already written for the chat's language ("2.0", "2,0").
    fileSizeBytes: string;
    fileSizeKilobytes: string;
    fileSizeMegabytes: string;
    /** A token count in thousands: "12k". */
    tokensThousands: string;
    /** A token count in millions: "1.5M". */
    tokensMillions: string;
    /** How long the agent has worked, under a minute. */
    durationSeconds: string;
    /** How long the agent has worked, a minute or more. */
    durationMinutes: string;

    // Names for what has none.
    /** Fills `{name}` in the greeting when the provider has no `userName`. */
    defaultUserName: string;
    /** A sub-agent the platform did not name. */
    subAgentName: string;
    /** A tool call with neither a name nor a slug. */
    toolName: string;
    /** An attachment without a file name: the viewer's title and an image's text alternative. */
    attachmentName: string;
    /** A file without a name, in a message's chip and the viewer. */
    fileName: string;
    /** The name a download is saved under when the file has none. */
    downloadFileName: string;
    /** An image's text alternative when nothing better is known. */
    imageAlt: string;
    /** An attachment image that could not be loaded. */
    imageUnavailable: string;
    /** An approval card for a call with no tool name. */
    confirmAction: string;

    // Messages and the viewer.
    /** Editing a sent message: the button that sends it again. */
    editSend: string;
    /** A sub-agent's block when its run failed: `{name}`. */
    subAgentFailed: string;
    /** The attachment viewer's close button, as its tooltip says it. */
    closeWithShortcut: string;
    previousPage: string;
    nextPage: string;
    /** A block that could not be drawn, and why: `{label}`, `{reason}`. */
    blockFailedReason: string;

    // What the chat writes into a turn itself. Written when it happens, in the
    // language then in force.
    /** After an answer the user stopped (shown in italics). */
    stoppedNotice: string;
    /** A turn still running that this page can no longer follow. */
    staleTurnNotice: string;
    /** What "Continue" sends to the agent when the run it would resume has ended. */
    continuePrompt: string;
    /** The run is waiting for capacity. */
    waitingForCapacity: string;
    /** The same, with `{seconds}` until it resumes. */
    waitingForCapacityIn: string;
    /** A check-in's question (the agent has worked for a while). */
    checkInTitle: string;
    /** `{duration}` worked so far. */
    checkInBody: string;
    /** `{duration}` worked and `{credits}` used (a count, filled from `credits`). */
    checkInBodyWithCredits: string;
    /** A check-in reloaded from history: `{duration}`. */
    checkInRecorded: string;
    /** A held call to a tool that runs in this app: `{tool}`. */
    approvalInApp: string;
    /** A held call to a tool that runs on the server: `{tool}`. */
    approvalOnServer: string;
    /** The same with its arguments, which follow on the next lines: `{tool}`. */
    approvalInAppWith: string;
    approvalOnServerWith: string;
    /** A turn that failed with no reason given. */
    errorGeneric: string;
    /** After a reason a retry may fix, on a line of its own. */
    errorTryAgain: string;
    errorGatewayUnreachable: string;
    errorRateLimited: string;
    errorServiceUnavailable: string;
    /** `{status}`: the HTTP status. */
    errorRequestRefused: string;
    errorStreamLost: string;
    errorStreamFailed: string;
    errorNoStream: string;
    errorNoStreamBody: string;
    /** A plain `StreamClient`'s failed request: `{status}`, `{statusText}`. */
    errorHttpStatus: string;
    errorNoResponseBody: string;
    /** An upload the storage API refused without a reason: `{status}`. */
    uploadFailedStatus: string;
    uploadMissingFileId: string;

    // The pictures on the welcome screen's feature cards (no `image` given).
    featureCardAgentPrimary: string;
    featureCardAgentSecondary: string;
    featureCardQuestion: string;
    featureCardSource: string;

    // --- Since 4.2 too: what a review of the first pass found still in English.

    // The viewer's PDF pages, and a PDF it will not open.
    /** A page of a PDF that could not be drawn. */
    pdfPageLoadFailed: string;
    /** The PDF viewer given no file. */
    pdfNoFile: string;
    /** The PDF viewer given no page. */
    pdfNoPage: string;
    /** A PDF that needs a password: the viewer asks for none, and says so. */
    pdfPasswordProtected: string;

    // An answer's footnotes (GFM `[^1]`).
    /** The heading over an answer's footnotes, read by screen readers. */
    footnotes: string;
    /** A footnote's link back to where it is cited: `{reference}` is its number ("1", or "1-2" for a second citation). */
    footnoteBack: string;

    // The storage API's failures, as `StorageRequestError.labelKey` names them
    // (and `describeLabelledError` writes them) — what a host shows when a
    // save, a delete or a read it asked for fails.
    /** The provider has no `storageApiUrl` or no `accessToken`. */
    storageNotConfigured: string;
    storageUnreachable: string;
    /** `{status}`: the HTTP status. */
    storageRequestFailed: string;
    /** The storage API answered, but not with what was asked for. */
    storageBadResponse: string;

    // The platform's tools by name — what a tool row, an approval card and the
    // activity header call a tool the host has not named itself
    // (`TOOL_NAME_LABELS` in common/toolConfig.ts maps each slug to its label).
    // A tool none of these name shows the platform's own name for it, else its
    // slug in words; a host names its own tools with `displayName`.
    /** `context_retrieve`. */
    toolNameContextRetrieve: string;
    /** `context_upsert`. */
    toolNameContextUpsert: string;
    /** `context_upsert_user`. */
    toolNameContextUpsertUser: string;
    /** `context_upsert_tenant`. */
    toolNameContextUpsertTenant: string;
    /** `context_upsert_partner`. */
    toolNameContextUpsertPartner: string;
    /** `web_search, search_web`. */
    toolNameWebSearch: string;
    /** `fetch_web_page`. */
    toolNameFetchWebPage: string;
    /** `generate_checklist`. */
    toolNameGenerateChecklist: string;
    /** `read_page_context`. */
    toolNameReadPageContext: string;
    /** `capture_page_screenshot`. */
    toolNameCapturePageScreenshot: string;
    /** `navigate_app_route`. */
    toolNameNavigateAppRoute: string;
    /** `generate_image`. */
    toolNameGenerateImage: string;
    /** `get_file_description`. */
    toolNameGetFileDescription: string;
    /** `analyze_file, file_analyzer`. */
    toolNameAnalyzeFile: string;
    /** `ask_user_questions`. */
    toolNameAskUserQuestions: string;
    /** `generate_structured_output`. */
    toolNameGenerateStructuredOutput: string;
    /** `structured_output`. */
    toolNameStructuredOutput: string;
    /** `enhance_texts`. */
    toolNameEnhanceTexts: string;
    /** `text_enhancer`. */
    toolNameTextEnhancer: string;
    /** `translate_texts`. */
    toolNameTranslateTexts: string;
    /** `translator`. */
    toolNameTranslator: string;
    /** `preview_property_agent_result`. */
    toolNamePreviewPropertyAgentResult: string;
    /** `properties_get_persona`. */
    toolNamePropertiesGetPersona: string;
    /** `find_on_page`. */
    toolNameFindOnPage: string;
    /** `read_page_diagnostics`. */
    toolNameReadPageDiagnostics: string;
    /** `validate_checklist`. */
    toolNameValidateChecklist: string;
    /** `switch_agent`. */
    toolNameSwitchAgent: string;
    /** `checklist_read`. */
    toolNameChecklistRead: string;
    /** `checklist_apply_suggestions`. */
    toolNameChecklistApplySuggestions: string;
    /** `read_translation_context`. */
    toolNameReadTranslationContext: string;
    /** `propose_translations`. */
    toolNameProposeTranslations: string;
    /** `show_step_output`. */
    toolNameShowStepOutput: string;
    /** `find_conversation_artifacts`. */
    toolNameFindConversationArtifacts: string;
    /** `get_step_details`. */
    toolNameGetStepDetails: string;
    /** `search_tools`. */
    toolNameSearchTools: string;
    /** `load_tool`. */
    toolNameLoadTool: string;
    /** `search_skills`. */
    toolNameSearchSkills: string;
    /** `load_skill`. */
    toolNameLoadSkill: string;
}

/** The labels by their current names: {@link ChatLabels} without the deprecated ones. */
export type ChatLabelTexts = Omit<ChatLabels, DeprecatedLabelKey>;

/** The library's English, by the current names; {@link DEFAULT_LABELS} adds the deprecated ones. */
const ENGLISH_LABELS: ChatLabelTexts = {
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
    uploadingFiles: { one: 'Uploading {count} file…', other: 'Uploading {count} files…' },
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
    disclaimer: 'This is AI, and can make mistakes. Verify results.',

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
    metaRefused: { other: '{count} refused' },

    activityThoughts: { one: 'thought once', other: 'thought {count} times' },
    activitySearches: { one: 'searched once', other: 'searched {count} times' },
    activitySkillLoads: { one: 'loaded a skill', other: 'loaded {count} skills' },
    activityToolLoads: { one: 'loaded tools', other: 'loaded tools {count} times' },
    activityRanTool: 'ran {name}',
    activityRanToolTimes: { other: 'ran {name} {count} times' },
    activityRanTools: { other: 'ran {count} tools' },
    activityUsedAgent: 'used {name}',
    activityUsedAgents: { other: 'used {count} agents' },
    activityAgentWorking: '{name} is working…',
    activityFailed: { other: '{count} failed' },
    activitySeparator: ' · ',

    blockPreparing: 'Preparing {label}…',
    blockFailed: "Couldn't display this {label}",
    blockShowSource: 'Show source',
    blockExpand: 'Expand',
    blockMore: 'More actions',
    blockCopySource: 'Copy source',
    blockClose: 'Close',

    close: 'Close',
    closeAttachment: 'Close attachment',
    attachmentLoadFailed: 'Failed to load attachment',
    attachmentLoadFailedStatus: 'Failed to load attachment ({status})',
    attachmentNoAuth: 'No authentication context available',
    pdfLoadFailed: 'Failed to load PDF.',
    downloadFile: 'Download',
    downloadFailed: "Couldn't download the file.",
    previewTruncated: { other: 'First {shown} of {total} rows' },

    conversationFiles: 'Conversation files',
    conversationFilesEmpty: 'No files in this conversation yet.',
    filesLoadFailed: "Couldn't load the files.",
    fileArtifactBadge: 'Artifact',
    fileGeneratedBadge: 'Generated',
    previewFile: 'Preview',
    artifacts: 'Artifacts',
    artifactsEmpty: 'Nothing here yet. Charts, tables, reports and files from your answers appear here.',
    artifactsLoadFailed: "Couldn't load your artifacts.",
    searchArtifacts: 'Search artifacts',
    noArtifactResults: 'No artifacts match your search.',
    noArtifactFilterResults: 'Nothing matches these filters.',
    artifactKindFilter: 'Kind',
    artifactKindAll: 'All',
    artifactKindChart: 'Charts',
    artifactKindTable: 'Tables',
    artifactKindKpi: 'KPIs',
    artifactKindReport: 'Reports',
    artifactKindFile: 'Files',
    openConversation: 'Open conversation',
    backToArtifacts: 'Back to artifacts',
    deleteArtifact: 'Delete',
    confirmDeleteArtifact: 'Click again to delete',
    artifactDeleteFailed: "Couldn't delete the artifact.",

    savedBadge: 'Saved',
    notSavedBadge: 'Not saved',
    saveFile: 'Save',
    saveFileFailed: "Couldn't save the file.",
    fileSavedAnnouncement: 'Saved: {title}',
    showInChat: 'Show in chat',
    showInChatUnavailable: "This answer isn't in the chat on screen.",
    blockUntitled: 'Untitled {label}',
    blockNoRenderer: "This {label} can't be drawn here.",
    blockLoadFailed: "Couldn't load this visual.",
    filesFilter: 'Show',
    filesFilterAll: 'All',
    filesFilterVisuals: 'Visuals',
    filesFilterFiles: 'Files',
    conversationVisualsEmpty: 'No charts, tables or reports in this conversation yet.',
    conversationFilesEmptyTitle: 'No files yet',
    conversationFilesEmptyHint: 'Charts, tables and files the assistant creates here — and files you attach — will appear in this list.',
    filesItems: { one: '{count} item', other: '{count} items' },
    filesSavedCount: { other: '{count} saved' },
    itemKindChart: 'Chart',
    itemKindTable: 'Table',
    itemKindKpi: 'KPI card',
    itemKindReport: 'Report',
    itemKindFile: 'File',
    itemKindImage: 'Image',
    itemKindPdf: 'PDF',
    itemKindSpreadsheet: 'Spreadsheet',
    artifactStatus: 'Saved or not',
    artifactStatusAll: 'All',
    artifactStatusSaved: 'Saved',
    artifactStatusUnsaved: 'Not saved',
    artifactsSavedEmpty: 'Nothing saved yet. Save a chart, table or report from an answer and it appears here.',
    artifactsUnsavedEmpty: "Nothing unsaved to show. Charts, tables and files you haven't saved appear here.",

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
    usageSubAgents: { other: 'Sub-agents ({count})' },
    usageWholeConversation: 'Whole conversation',
    usageFreeCalls: 'Free calls this turn',
    usageWaived: '{credits} waived',
    usageSubAgentTree: 'Sub-agent tree',
    usageTreeLimitReached: 'limit reached — no new sub-agents this turn',
    usageTokens: '{input} in · {output} out · {steps}',
    credits: { one: '{count} credit', other: '{count} credits' },
    steps: { one: '{count} step', other: '{count} steps' },
    turns: { one: '{count} turn', other: '{count} turns' },

    creditsLeft: { one: 'credit left', other: 'credits left' },
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
    creditsWarning: "You've used {percent} of your credits — {credits} left.",
    creditsViewUsage: 'View usage',

    standingContext: 'Memory & instructions',
    standingContextIntro: 'The assistant is told these in every conversation.',
    standingInstructions: 'Your instructions',
    standingInstructionsHint: 'How the assistant should work for you.',
    standingMemories: 'What the assistant remembers',
    standingMemoriesHint: 'Facts about you it keeps in mind.',
    standingOrganization: 'From your organization',
    standingOrganizationHint: 'Set by your administrators, for everyone.',
    standingNoOrganization: 'Nothing from your organization yet.',
    standingTabPersonal: 'Personal',
    standingTabOrganization: 'Organization',
    standingNoInstructions: 'No instructions yet.',
    standingNoMemories: 'Nothing remembered yet.',
    standingAddInstruction: 'Add an instruction',
    standingAddMemory: 'Add a memory',
    standingInstructionPlaceholder: 'Answer in German, and keep it short.',
    standingMemoryPlaceholder: 'I manage the Hamburg site.',
    standingOneLine: 'Line breaks are kept; extra spaces are tidied.',
    standingUntilLabel: 'Applies until (optional)',
    standingUntil: 'Until {date}',
    standingExpired: 'Expired',
    standingNoEndDate: 'No end date',
    standingSavedByAssistant: 'Saved by the assistant',
    standingSave: 'Save',
    standingCharacters: '{count} / {limit}',
    standingInstructionsUsed: '{used} of {limit} characters used',
    standingMemoriesUsed: '{used} of {limit} memories',
    standingDelete: 'Delete',
    standingConfirmDelete: 'Click again to delete',
    standingErrorEmpty: 'Write something first.',
    standingErrorMemoryTooLong: 'A memory can be at most {limit} characters.',
    standingErrorInstructionsFull: 'Your instructions can be at most {limit} characters in all. Shorten or remove one first.',
    standingErrorMemoriesFull: 'You already have {limit} memories. Remove one first.',
    standingErrorExpiry: 'Choose today or a later date.',
    standingErrorGone: 'This was already removed.',
    standingErrorSave: "Couldn't save. Try again.",
    standingErrorDelete: "Couldn't delete. Try again.",
    standingLoadFailed: "Couldn't load your memory and instructions.",
    standingUnavailable: "Memory and instructions aren't available on this server.",

    actionOnItem: '{action}: {item}',
    actionOnItemUnavailable: '{action}: {item} — {reason}',
    parenthetical: '{text} ({detail})',
    quotedText: '“{text}”',
    positionOf: '{current} / {total}',
    pageOf: '{page} / {total}',
    usageOfLimit: '{used} / {limit} ({percent})',

    fileSizeBytes: '{size} B',
    fileSizeKilobytes: '{size} KB',
    fileSizeMegabytes: '{size} MB',
    tokensThousands: '{value}k',
    tokensMillions: '{value}M',
    durationSeconds: '{seconds} s',
    durationMinutes: '{minutes} min {seconds} s',

    defaultUserName: 'User',
    subAgentName: 'Sub-agent',
    toolName: 'Tool',
    attachmentName: 'Attachment',
    fileName: 'File',
    downloadFileName: 'download',
    imageAlt: 'Image',
    imageUnavailable: 'Image unavailable',
    confirmAction: 'Confirm Action',

    editSend: 'Send',
    subAgentFailed: '{name} — failed',
    closeWithShortcut: 'Close (Esc)',
    previousPage: 'Previous page',
    nextPage: 'Next page',
    blockFailedReason: "Couldn't display this {label}: {reason}",

    stoppedNotice: 'Stopped.',
    staleTurnNotice: 'This turn is still running, but this page can no longer follow it live. '
        + 'Reload once it has finished to see the rest.',
    continuePrompt: 'Please continue from where you stopped.',
    waitingForCapacity: 'Waiting for capacity…',
    waitingForCapacityIn: 'Waiting for capacity — resuming in {seconds}s…',
    checkInTitle: 'Continue working?',
    checkInBody: 'The agent has been working for {duration}. Continue?',
    checkInBodyWithCredits: 'The agent has been working for {duration} and used {credits}. Continue?',
    checkInRecorded: 'The agent had been working for {duration} and paused to ask whether to continue.',
    approvalInApp: 'The assistant wants to run {tool} in this app.',
    approvalOnServer: 'The assistant wants to run {tool} on the server.',
    approvalInAppWith: 'The assistant wants to run {tool} in this app with:',
    approvalOnServerWith: 'The assistant wants to run {tool} on the server with:',
    errorGeneric: 'Something went wrong. Please try again.',
    errorTryAgain: 'Please try again.',
    errorGatewayUnreachable: 'Gateway unreachable',
    errorRateLimited: 'Too many requests just now. Please try again shortly.',
    errorServiceUnavailable: 'The service is unavailable right now.',
    errorRequestRefused: 'The request was refused ({status}).',
    errorStreamLost: 'Stream connection lost',
    errorStreamFailed: 'Stream error',
    errorNoStream: 'Gateway response missing stream_url',
    errorNoStreamBody: 'No stream body',
    errorHttpStatus: 'HTTP {status}: {statusText}',
    errorNoResponseBody: 'No response body',
    uploadFailedStatus: 'Upload failed ({status})',
    uploadMissingFileId: 'Upload succeeded but server response is missing a valid file_id',

    featureCardAgentPrimary: 'Daily Briefing Agent',
    featureCardAgentSecondary: 'Problem Site Identifier',
    featureCardQuestion: 'Does FSANZ 3.2.2A apply?',
    featureCardSource: 'foodstandards.gov',

    pdfPageLoadFailed: "Couldn't show this page.",
    pdfNoFile: 'There is no PDF to show.',
    pdfNoPage: 'There is no page to show.',
    pdfPasswordProtected: "This PDF is protected by a password, so it can't be previewed here. Download it to open it.",

    footnotes: 'Footnotes',
    footnoteBack: 'Back to reference {reference}',

    storageNotConfigured: "Files can't be stored from this chat: it has no file storage set up.",
    storageUnreachable: "Couldn't reach the file storage. Check your connection and try again.",
    storageRequestFailed: 'The file storage refused the request ({status}).',
    storageBadResponse: "The file storage sent an answer the chat couldn't read.",

    toolNameContextRetrieve: 'Retrieve saved context',
    toolNameContextUpsert: 'Save context',
    toolNameContextUpsertUser: 'Save private context',
    toolNameContextUpsertTenant: 'Save organisation context',
    toolNameContextUpsertPartner: 'Save platform-wide context',
    toolNameWebSearch: 'Web search',
    toolNameFetchWebPage: 'Fetch web page',
    toolNameGenerateChecklist: 'Checklist Generator',
    toolNameReadPageContext: 'Read page context',
    toolNameCapturePageScreenshot: 'Capture page screenshot',
    toolNameNavigateAppRoute: 'Navigate app route',
    toolNameGenerateImage: 'Generate image',
    toolNameGetFileDescription: 'Get file description',
    toolNameAnalyzeFile: 'Analyze file',
    toolNameAskUserQuestions: 'Ask user questions',
    toolNameGenerateStructuredOutput: 'Generate structured output',
    toolNameStructuredOutput: 'Structured output',
    toolNameEnhanceTexts: 'Enhance texts',
    toolNameTextEnhancer: 'Text enhancer',
    toolNameTranslateTexts: 'Translate texts',
    toolNameTranslator: 'Translator',
    toolNamePreviewPropertyAgentResult: 'Preview investment recommendation',
    toolNamePropertiesGetPersona: 'Get user persona',
    toolNameFindOnPage: 'Find on page',
    toolNameReadPageDiagnostics: 'Read page diagnostics',
    toolNameValidateChecklist: 'Validate checklist',
    toolNameSwitchAgent: 'Switch agent',
    toolNameChecklistRead: 'Read checklist',
    toolNameChecklistApplySuggestions: 'Apply checklist suggestions',
    toolNameReadTranslationContext: 'Read translation context',
    toolNameProposeTranslations: 'Propose translations',
    toolNameShowStepOutput: 'Action Execution',
    toolNameFindConversationArtifacts: 'Search Conversation Artifacts',
    toolNameGetStepDetails: 'Step Details',
    toolNameSearchTools: 'Search tools',
    toolNameLoadTool: 'Load tools',
    toolNameSearchSkills: 'Search skills',
    toolNameLoadSkill: 'Load skill',
};

/** A label's name. The deprecated 4.1 names ({@link DeprecatedLabelKey}) are not label names. */
export type LabelKey = keyof ChatLabelTexts;

/** The labels that count something: their value is a {@link PluralLabel}. */
export type PluralLabelKey = {
    [Key in LabelKey]: ChatLabels[Key] extends PluralLabel ? Key : never;
}[LabelKey];

/**
 * The 4.1 names of the labels that became plural labels (or were renamed) in
 * 4.2. They keep working both ways:
 *
 * - **given** — in `config.labels` or in a translation ({@link DeprecatedLabelInputs}):
 *   each fills its {@link DEPRECATED_LABEL_ALIASES} target, a pair's `…One`
 *   the `one` form and its `…Other` the `other`, laid over the forms found
 *   beneath it — so `creditsOther` alone keeps the `one` form ("1 credit"). A
 *   key's new name, given beside them in the same map, wins over them; in a
 *   later configuration layer, they win over the new name of an earlier one.
 * - **read** — from `useLabels()` or {@link DEFAULT_LABELS}, as the text 4.1
 *   had: `creditsOne` is `credits.one` (else `.other`), `creditsOther` is
 *   `credits.other`, `activityRanRepeated` is `activityRanToolTimes.other`.
 */
export interface DeprecatedLabels {
    /** @deprecated Use `credits` (`{ one, other }`). */
    readonly creditsOne: string;
    /** @deprecated Use `credits` (`{ one, other }`). */
    readonly creditsOther: string;
    /** @deprecated Use `steps`. */
    readonly stepsOne: string;
    /** @deprecated Use `steps`. */
    readonly stepsOther: string;
    /** @deprecated Use `turns`. */
    readonly turnsOne: string;
    /** @deprecated Use `turns`. */
    readonly turnsOther: string;
    /** @deprecated Use `creditsLeft`. */
    readonly creditsLeftOne: string;
    /** @deprecated Use `creditsLeft`. */
    readonly creditsLeftOther: string;
    /** @deprecated Use `filesItems`. */
    readonly filesItemsOne: string;
    /** @deprecated Use `filesItems`. */
    readonly filesItemsOther: string;
    /** @deprecated Use `activityThoughts`. */
    readonly activityThoughtOne: string;
    /** @deprecated Use `activityThoughts`. */
    readonly activityThoughtOther: string;
    /** @deprecated Use `activitySearches`. */
    readonly activitySearchedOne: string;
    /** @deprecated Use `activitySearches`. */
    readonly activitySearchedOther: string;
    /** @deprecated Use `activitySkillLoads`. */
    readonly activityLoadedSkillOne: string;
    /** @deprecated Use `activitySkillLoads`. */
    readonly activityLoadedSkillOther: string;
    /** @deprecated Use `activityToolLoads`. */
    readonly activityLoadedToolsOne: string;
    /** @deprecated Use `activityToolLoads`. */
    readonly activityLoadedToolsOther: string;
    /** @deprecated Use `activityRanTool`. */
    readonly activityRanOne: string;
    /** @deprecated Use `activityRanToolTimes`. */
    readonly activityRanRepeated: string;
    /** @deprecated Use `activityRanTools`. */
    readonly activityRanOther: string;
    /** @deprecated Use `activityUsedAgent`. */
    readonly activityAgentOne: string;
    /** @deprecated Use `activityUsedAgents`. */
    readonly activityAgentOther: string;
}

/**
 * The deprecated names as a host may give them: every one optional.
 * {@link ChatLabelInputs} includes them.
 */
export type DeprecatedLabelInputs = { -readonly [Key in keyof DeprecatedLabels]?: DeprecatedLabels[Key] };

/** A deprecated label's name. */
export type DeprecatedLabelKey = keyof DeprecatedLabels;

/**
 * Where each deprecated label goes: its new key, and — for one of a one/other
 * pair — the plural form it fills. One without a form is the whole value.
 */
export const DEPRECATED_LABEL_ALIASES: Readonly<Record<DeprecatedLabelKey, { key: LabelKey; form?: PluralCategory }>> = Object.freeze({
    creditsOne: { key: 'credits', form: 'one' },
    creditsOther: { key: 'credits', form: 'other' },
    stepsOne: { key: 'steps', form: 'one' },
    stepsOther: { key: 'steps', form: 'other' },
    turnsOne: { key: 'turns', form: 'one' },
    turnsOther: { key: 'turns', form: 'other' },
    creditsLeftOne: { key: 'creditsLeft', form: 'one' },
    creditsLeftOther: { key: 'creditsLeft', form: 'other' },
    filesItemsOne: { key: 'filesItems', form: 'one' },
    filesItemsOther: { key: 'filesItems', form: 'other' },
    activityThoughtOne: { key: 'activityThoughts', form: 'one' },
    activityThoughtOther: { key: 'activityThoughts', form: 'other' },
    activitySearchedOne: { key: 'activitySearches', form: 'one' },
    activitySearchedOther: { key: 'activitySearches', form: 'other' },
    activityLoadedSkillOne: { key: 'activitySkillLoads', form: 'one' },
    activityLoadedSkillOther: { key: 'activitySkillLoads', form: 'other' },
    activityLoadedToolsOne: { key: 'activityToolLoads', form: 'one' },
    activityLoadedToolsOther: { key: 'activityToolLoads', form: 'other' },
    activityRanOne: { key: 'activityRanTool' },
    activityRanRepeated: { key: 'activityRanToolTimes' },
    activityRanOther: { key: 'activityRanTools' },
    activityAgentOne: { key: 'activityUsedAgent' },
    activityAgentOther: { key: 'activityUsedAgents' },
});

/**
 * What a host may give for each label: a text, or plural forms for a counting
 * one — and the deprecated 4.1 names. `config.labels` and each language of
 * `config.translations` are partial maps of it.
 */
export type ChatLabelInputs = {
    [Key in LabelKey]: ChatLabels[Key] extends PluralLabel ? LabelValue : string;
} & DeprecatedLabelInputs;

/**
 * The host's translations: per language tag (BCP 47 — `'ar'`, `'de'`,
 * `'de-AT'`; matched without regard to case), a partial map of labels. A key
 * a language leaves out — or gives as `''` — falls back to the language's
 * base (`'de-AT'` → `'de'`), then to `translations.en`, then to the library's
 * English. `translations.en` rewords the English.
 */
export type ChatTranslations = Record<string, Partial<ChatLabelInputs>>;

/** A deprecated name's text, read from its new key's value as 4.1 had it. */
function deprecatedText(value: LabelValue | undefined, form: PluralCategory | undefined): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    const forms = value as PluralLabel;
    if (form && form !== 'other' && typeof forms[form] === 'string' && forms[form] !== '') return forms[form] as string;
    return forms.other;
}

/**
 * `labels`, readable by the deprecated 4.1 names too ({@link DeprecatedLabels}):
 * each defined on the object itself as a getter of its new key's text, not
 * enumerable — `Object.keys`, a spread and `JSON.stringify` see only the
 * current names. Returns `labels`.
 */
export function withDeprecatedNames<Labels extends object>(labels: Labels): Labels & DeprecatedLabels {
    (Object.entries(DEPRECATED_LABEL_ALIASES) as Array<[DeprecatedLabelKey, { key: LabelKey; form?: PluralCategory }]>)
        .forEach(([alias, { key, form }]) => {
            Object.defineProperty(labels, alias, {
                configurable: true,
                enumerable: false,
                get: () => deprecatedText((labels as Record<string, LabelValue | undefined>)[key], form),
            });
        });
    return labels as Labels & DeprecatedLabels;
}

/**
 * The library's English: every label a host does not translate shows this.
 * Readable by the deprecated 4.1 names as well (see {@link ChatLabels}).
 */
export const DEFAULT_LABELS: ChatLabels = withDeprecatedNames(ENGLISH_LABELS);

/** Every label's name, in the order of {@link DEFAULT_LABELS}. The deprecated names are not among them. */
export const LABEL_KEYS: readonly LabelKey[] = Object.freeze(Object.keys(ENGLISH_LABELS) as LabelKey[]);

/**
 * `labels` with the current name of every label a helper reads filled in
 * from its deprecated 4.1 names where only those are given — for the helpers a
 * host may call with a hand-made 4.1 label object (`summarizeActivity`,
 * `describeLatestActivity`). A pair's lone form is laid over the library's
 * English, as resolution does; a current name given wins. `labels` itself when
 * nothing was missing.
 */
export function withCurrentNames<Labels extends object>(labels: Labels, keys: readonly LabelKey[]): Labels & Pick<ChatLabels, LabelKey> {
    const given = labels as Record<string, unknown>;
    const aliases = Object.entries(DEPRECATED_LABEL_ALIASES) as Array<[DeprecatedLabelKey, { key: LabelKey; form?: PluralCategory }]>;
    const upgraded: Record<string, unknown> = {};
    let changed = false;
    for (const key of keys) {
        if (given[key] !== undefined && given[key] !== null) continue;
        let value: LabelValue | undefined = undefined as LabelValue | undefined;
        for (const [alias, target] of aliases) {
            const text = given[alias];
            if (target.key !== key || typeof text !== 'string' || text.trim() === '') continue;
            if (!target.form) {
                value = value ?? text;
                continue;
            }
            const base: PluralLabel = typeof value === 'object' ? value : { ...(ENGLISH_LABELS[key] as PluralLabel) };
            value = { ...base, [target.form]: text };
        }
        upgraded[key] = value ?? ENGLISH_LABELS[key];
        changed = true;
    }
    return (changed ? { ...given, ...upgraded } : labels) as Labels & Pick<ChatLabels, LabelKey>;
}

/** The labels that count something (plural labels). */
export const PLURAL_LABEL_KEYS: readonly PluralLabelKey[] = Object.freeze(
    LABEL_KEYS.filter(key => typeof ENGLISH_LABELS[key] !== 'string') as PluralLabelKey[]
);

/** Whether a value is plural forms rather than a text. */
export function isPluralLabel(value: unknown): value is PluralLabel {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The language whose plural rules choose among a resolved label's forms —
 * the language the forms were written in. Kept beside the object rather than
 * on it, so a label stays the plain `{ one, other }` a host wrote.
 */
const pluralLocales = new WeakMap<object, string>();

/** Note the language a plural label's forms are written in (see `resolveLabels`). */
export function setPluralLocale<Label extends PluralLabel>(label: Label, locale: string | undefined): Label {
    if (locale) pluralLocales.set(label, locale);
    return label;
}

PLURAL_LABEL_KEYS.forEach(key => setPluralLocale(ENGLISH_LABELS[key] as PluralLabel, 'en'));

const canonicalTags = new Map<string, string>();

/**
 * A language tag as `Intl` and the `lang` attribute take it: `_` read as `-`
 * (`'ru_RU'` → `'ru-RU'`), then canonicalised (`'DE-at'` → `'de-AT'`). A tag
 * `Intl` refuses is returned with only the `_` replaced; `undefined` for none.
 */
export function canonicalLanguage(tag: string | null | undefined): string | undefined {
    if (typeof tag !== 'string') return undefined;
    const trimmed = tag.trim();
    if (!trimmed) return undefined;
    let canonical = canonicalTags.get(trimmed);
    if (canonical === undefined) {
        const dashed = trimmed.replace(/_/g, '-');
        try {
            const getCanonicalLocales = (Intl as unknown as { getCanonicalLocales?: (tag: string) => string[] }).getCanonicalLocales;
            canonical = (getCanonicalLocales ? getCanonicalLocales(dashed)[0] : undefined) ?? dashed;
        } catch {
            canonical = dashed;
        }
        canonicalTags.set(trimmed, canonical);
    }
    return canonical;
}

const pluralRules = new Map<string, Intl.PluralRules | null>();

/** The plural category of `count` in `locale` — `one`/`other` by English rules where `Intl.PluralRules` cannot say. */
export function pluralCategory(count: number, locale?: string): PluralCategory {
    const key = locale ?? '';
    let rules = pluralRules.get(key);
    if (rules === undefined) {
        try {
            rules = typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function'
                ? new Intl.PluralRules(canonicalLanguage(locale))
                : null;
        } catch {
            // A tag the engine does not know.
            rules = null;
        }
        pluralRules.set(key, rules);
    }
    if (rules) return rules.select(count) as PluralCategory;
    return count === 1 ? 'one' : 'other';
}

const numberFormats = new Map<string, Intl.NumberFormat | null>();

/** `value` written for `locale` (the runtime's own language without one); plain digits where `Intl` cannot. */
export function formatNumber(value: number, locale?: string, options?: Intl.NumberFormatOptions): string {
    const key = `${locale ?? ''}\u0001${options ? JSON.stringify(options) : ''}`;
    let format = numberFormats.get(key);
    if (format === undefined) {
        try {
            format = new Intl.NumberFormat(canonicalLanguage(locale), options);
        } catch {
            format = null;
        }
        numberFormats.set(key, format);
    }
    return format ? format.format(value) : String(value);
}

/**
 * Fill a label's `{name}` placeholders. A placeholder with no value is left as
 * written, so a missing value shows up in the UI instead of vanishing.
 *
 * Given plural forms — a 4.1 host reading a label that counts since 4.2 —
 * it picks the form for `values.count` when that is a number
 * ({@link formatPlural}), else uses `other`.
 */
export function formatLabel(template: LabelValue, values: Record<string, string | number> = {}): string {
    // A counting label (4.2) where 4.1 had a text — `uploadingFiles`,
    // `metaRefused`… — read the 4.1 way: by its `count`, else its `other`.
    if (isPluralLabel(template)) {
        return typeof values.count === 'number'
            ? formatPlural(template, values.count, values)
            : formatLabel(template.other ?? '', values);
    }
    if (typeof template !== 'string') return '';
    return template.replace(/\{(\w+)\}/g, (placeholder, key: string) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : placeholder
    );
}

/**
 * A counting label for `count`, its placeholders filled: the form
 * `Intl.PluralRules` picks for `count` — in the language the label's forms
 * are written in when the chat resolved it (`resolveLabels`), else in
 * `language` — and `{count}` written as a number of `language` ("1,250",
 * "1.250"). A value in `values` wins over the count's, `count` included. A
 * plain text is every form.
 *
 * ```ts
 * formatPlural(labels.credits, 3)                       // "3 credits"
 * formatPlural({ one: 'ملف واحد', two: 'ملفان', few: '{count} ملفات', other: '{count} ملف' }, 2, {}, 'ar') // "ملفان"
 * ```
 */
export function formatPlural(
    label: LabelValue,
    count: number,
    values: Record<string, string | number> = {},
    language?: string,
): string {
    const filled = { count: formatNumber(count, language), ...values };
    if (typeof label === 'string') return formatLabel(label, filled);
    if (!isPluralLabel(label)) return '';
    const category = pluralCategory(count, pluralLocales.get(label) ?? language ?? 'en');
    const form = label[category];
    return formatLabel(typeof form === 'string' && form !== '' ? form : label.other, filled);
}

/**
 * A count with its noun: `one` for exactly 1, `other` otherwise — English's
 * rule, in every language.
 *
 * @deprecated Since 4.2. Use {@link formatPlural} with a plural label, which
 * chooses the form by the language's own rules.
 */
export function formatCount(count: number, one: LabelValue | undefined, other: LabelValue | undefined): string {
    const chosen = count === 1 ? one ?? other : other ?? one;
    return chosen === undefined ? '' : formatLabel(chosen, { count });
}

/** The `{placeholders}` a label uses — in any of its forms — sorted, each once. */
export function labelPlaceholders(value: LabelValue): string[] {
    const texts = typeof value === 'string'
        ? [value]
        : PLURAL_CATEGORIES.map(category => value[category]).filter((text): text is string => typeof text === 'string');
    const names = new Set<string>();
    texts.forEach(text => {
        for (const match of text.matchAll(/\{(\w+)\}/g)) names.add(match[1]);
    });
    return [...names].sort();
}
