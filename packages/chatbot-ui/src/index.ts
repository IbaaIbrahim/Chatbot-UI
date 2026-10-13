import './styles.css';

// --- The chat: one provider, mounted once, high in the host's tree ----------
export { ChatbotProvider } from './context/ChatbotContext';
export type { ChatbotProviderProps } from './context/ChatbotContext';

// Read any slice, do anything, react to anything — from anywhere under it.
export {
    useChatState,
    useChatActions,
    useChatEvent,
    useChatOverrides,
    useChatConfig,
    useLabels,
    useIcons,
    useAuthenticatedFetch,
} from './store/hooks';
export { shallowEqual } from './store/createChatStore';
export type {
    ChatSnapshot,
    ChatActions,
    ChatEventMap,
    ChatEventType,
    ChatEventHandler,
    ConversationSearch,
} from './store/types';

// --- Configuration: words, icons, which controls exist, welcome content ----
export * from './common/chatbotConfig';
export { DEFAULT_LABELS, formatLabel, formatCount } from './common/labels';
export type { ChatLabels } from './common/labels';
export { DEFAULT_ICONS } from './common/icons';
export type { ChatIcons } from './common/icons';

// --- The ready-made chat, and the widgets it is built from ------------------
export * from './components/App/App';
export * from './components/ChatContainer/ChatContainer';
export { ChatRoot } from './components/ChatRoot/ChatRoot';
export type { ChatRootProps } from './components/ChatRoot/ChatRoot';
export * from './components/ChatHeader/ChatHeader';
export * from './components/ConversationSidebar/ConversationSidebar';
export { CreditUsageDialog } from './components/CreditUsage/CreditUsageDialog';
export * from './components/MainChat/MainChat';
export * from './components/Composer/Composer';
export * from './components/WelcomeScreen/WelcomeScreen';

// --- Transcript building blocks ---------------------------------------------
export * from './components/MessageBubble/MessageBubble';
export * from './components/ThinkingIndicator/ThinkingIndicator';
export * from './components/BlinkingIndicator/BlinkingIndicator';
export * from './components/ToolInvocation/ToolInvocation';
export { ToolActionControl } from './components/ToolInvocation/ToolInvocation';
export * from './components/ConfirmButtons/ConfirmButtons';
export { ToolToggles, hasRunnableTools } from './components/ToolToggles/ToolToggles';
export type { ToolTogglesProps } from './components/ToolToggles/ToolToggles';
export * from './components/MessageActions/MessageActions';
export * from './components/BranchNavigator/BranchNavigator';
export * from './components/AuthenticatedImage/AuthenticatedImage';
export { ConversationDrawer } from './components/ConversationDrawer/ConversationDrawer';
export type { ConversationDrawerProps } from './components/ConversationDrawer/ConversationDrawer';

// Interactive questionnaire (built-in ``ask_user_questions`` client tool)
export { QuestionnaireForm, formatAnswers } from './components/Questionnaire/QuestionnaireForm';
export type { QuestionnaireFormProps, QuestionSpec, QuestionType } from './components/Questionnaire/QuestionnaireForm';

// Attachment utilities
export * from './common/attachmentUtils';

// Local Network Access (Chromium 142+) — see src/common/localNetwork.ts
export {
    configureLocalNetworkAccess,
    isLocalNetworkAccessEnabled,
    isLocalNetworkUrl,
    addressSpaceOf,
} from './common/localNetwork';
export type { TargetAddressSpace } from './common/localNetwork';

// --- Streaming API clients ---------------------------------------------------
export { StreamClient } from './api/StreamClient';
export type { StreamClientConfig, StreamEvent, StreamChatClient, StreamOutcome } from './api/StreamClient';
export { GatewayStreamClient } from './api/GatewayStreamClient';
export type { GatewayStreamClientConfig, EnablableTool, ChatAgent, HostContext, HostContextValue, HostContextProvider } from './api/GatewayStreamClient';

// The tool contract: what a host application declares per tool in the
// provider's `tools` prop. One entry per tool; `run` handles a client-dispatched
// call, `preview` a server-dispatched tool's output.
export { isClientTool, isServerTool, DEFAULT_TOOL_NAMES, formatToolSlug, resolveToolDisplayName } from './common/toolConfig';
// The platform's four meta-tools — how a central-mode run finds and loads
// tools and skills — and the compact text their steps render as.
export { META_TOOL_SLUGS, isMetaTool, describeMetaTool } from './common/metaTools';
// The activity section: runs of thinking, tool calls and sub-agents drawn as one
// collapsible row, with a live header and a finished count.
export { groupActivity, summarizeActivity, describeLatestActivity, isActivityStep, isStepRunning } from './common/activity';
export type { ActivityItem, ActivityLine, ActivityLabels } from './common/activity';
export type { MetaToolSlug, MetaToolStatus, MetaToolDescription, MetaToolLabels } from './common/metaTools';
export type {
    ToolConfig,
    ClientToolConfig,
    ServerToolConfig,
    ToolPresentation,
    ToolActionPlacement,
    ToolActionRenderProps,
    ToolCallContext,
    ResultPreviewContext,
    ClientToolDefinition,
    ClientSkillDefinition,
} from './common/toolConfig';
// The host catalogue: how a central-mode run searches and loads this
// application's tools and skills through the browser. The client answers on
// its own; these are for a host that draws its own transcript or builds its
// own client.
export { HOST_REQUEST_SLUG, isHostRequestSlug, answerHostRequest } from './common/hostCatalogue';
export type {
    ClientToolSpec,
    HostCatalogueTool,
    HostCatalogueSkill,
    HostRequest,
    HostRequestAnswer,
} from './common/hostCatalogue';
export { parseToolOutput, settledToolStatus } from './api/toolOutput';
export { AuthClient } from './api/AuthClient';
export type { TokenResponse, Session, PersonaQuestion, RegisterPayload, LoginPayload } from './api/AuthClient';
export {
    useStreamChat,
    describeApprovalRequest,
    STALE_TURN_NOTICE,
    STOPPED_NOTICE,
    CONTINUE_PROMPT,
} from './hooks/useStreamChat';
export type { UseStreamChatOptions } from './hooks/useStreamChat';

// Core types
export type {
    ChatState,
    AttachedFile,
    ConversationSummary,
    ConversationDetail,
    ConversationJob,
    ConversationStep,
    ConversationListResponse,
    ConversationListFilters,
    PendingApproval,
    UserCredits,
    CreditGrant,
    CreditBlock,
} from './api/types';
export { ConversationClient } from './api/ConversationClient';
export {
    useConversations,
    hasPendingClientToolCall,
    findPendingClientToolCalls,
    collectPendingApprovals,
} from './hooks/useConversations';
export type {
    UseConversationsResult,
    PendingClientToolCall,
} from './hooks/useConversations';
