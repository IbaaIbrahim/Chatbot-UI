import './styles.css';

// Main entry — simple stream-connected chat app
export * from './components/App/App';

// Core UI components
export * from './components/ChatContainer/ChatContainer';
export type { ChatTheme } from './components/ChatContainer/ChatContainer';
export * from './components/Composer/Composer';
export * from './components/MessageBubble/MessageBubble';
export * from './components/ThinkingIndicator/ThinkingIndicator';
export * from './components/BlinkingIndicator/BlinkingIndicator';
export * from './components/WelcomeScreen/WelcomeScreen';

// Supporting display components (kept for MessageBubble compatibility)
export * from './components/ToolInvocation/ToolInvocation';
export { ToolActionControl } from './components/ToolInvocation/ToolInvocation';
export * from './components/ConfirmButtons/ConfirmButtons';
export { ToolToggles, hasRunnableTools } from './components/ToolToggles/ToolToggles';
export type { ToolTogglesProps } from './components/ToolToggles/ToolToggles';

// Interactive questionnaire (built-in ``ask_user_questions`` client tool)
export { QuestionnaireForm, formatAnswers } from './components/Questionnaire/QuestionnaireForm';
export type { QuestionnaireFormProps, QuestionSpec, QuestionType } from './components/Questionnaire/QuestionnaireForm';
export * from './components/MessageActions/MessageActions';
export * from './components/BranchNavigator/BranchNavigator';
export * from './components/AuthenticatedImage/AuthenticatedImage';

// Context
export * from './context/ChatbotContext';

// Local Network Access (Chromium 142+) — see src/common/localNetwork.ts
export {
    configureLocalNetworkAccess,
    isLocalNetworkAccessEnabled,
    isLocalNetworkUrl,
    addressSpaceOf,
} from './common/localNetwork';
export type { TargetAddressSpace } from './common/localNetwork';


// Agent sidebar
export { AgentSidebar } from './components/AgentSidebar/AgentSidebar';
export type { AgentSidebarProps, AgentSidebarItem } from './components/AgentSidebar/AgentSidebar';

// Agent switcher (header dropdown)
export { AgentSwitcher } from './components/AgentSwitcher/AgentSwitcher';
export type { AgentSwitcherProps } from './components/AgentSwitcher/AgentSwitcher';

// Streaming API clients & hook
export { StreamClient } from './api/StreamClient';
export type { StreamClientConfig, StreamEvent, StreamChatClient, StreamOutcome } from './api/StreamClient';
export { GatewayStreamClient } from './api/GatewayStreamClient';
export type { GatewayStreamClientConfig, EnablableTool } from './api/GatewayStreamClient';

// The tool contract: what a host application declares per tool in ChatApp's
// `tools` prop. One entry per tool; `run` handles a client-dispatched call,
// `preview` a server-dispatched tool's output.
export { isClientTool, isServerTool } from './common/toolConfig';
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
} from './common/toolConfig';
export { parseToolOutput } from './api/toolOutput';
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
export type { ChatState, AttachedFile, ConversationSummary, ConversationDetail, ConversationJob, ConversationStep, ConversationListResponse, PendingApproval } from './api/types';
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
export { ConversationDrawer } from './components/ConversationDrawer/ConversationDrawer';
export type { ConversationDrawerProps } from './components/ConversationDrawer/ConversationDrawer';
