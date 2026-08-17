import './styles.css';

// Main entry — simple stream-connected chat app
export * from './components/App/App';

// Core UI components
export * from './components/ChatContainer/ChatContainer';
export * from './components/Composer/Composer';
export * from './components/MessageBubble/MessageBubble';
export * from './components/ThinkingIndicator/ThinkingIndicator';
export * from './components/BlinkingIndicator/BlinkingIndicator';
export * from './components/WelcomeScreen/WelcomeScreen';

// Supporting display components (kept for MessageBubble compatibility)
export * from './components/ToolInvocation/ToolInvocation';
export type {
    ToolActionConfig,
    ToolActionRenderProps,
} from './components/ToolInvocation/ToolInvocation';
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

// Agent sidebar
export { AgentSidebar } from './components/AgentSidebar/AgentSidebar';
export type { AgentSidebarProps, AgentSidebarItem } from './components/AgentSidebar/AgentSidebar';

// Agent switcher (header dropdown)
export { AgentSwitcher } from './components/AgentSwitcher/AgentSwitcher';
export type { AgentSwitcherProps } from './components/AgentSwitcher/AgentSwitcher';

// Streaming API clients & hook
export { StreamClient } from './api/StreamClient';
export type { StreamClientConfig, StreamEvent, StreamChatClient } from './api/StreamClient';
export { GatewayStreamClient } from './api/GatewayStreamClient';
export type {
    GatewayStreamClientConfig,
    ExternalToolConfig,
    ClientToolDefinition,
    EnablableTool,
    ResultPreviewer,
    ResultPreviewContext,
} from './api/GatewayStreamClient';
export { parseToolOutput } from './api/toolOutput';
export { AuthClient } from './api/AuthClient';
export type { TokenResponse, Session, PersonaQuestion, RegisterPayload, LoginPayload } from './api/AuthClient';
export { useStreamChat, describeApprovalRequest } from './hooks/useStreamChat';
export type { UseStreamChatOptions } from './hooks/useStreamChat';

// Core types
export type { ChatState, AttachedFile, ConversationSummary, ConversationDetail, ConversationJob, ConversationStep, ConversationListResponse } from './api/types';
export { ConversationClient } from './api/ConversationClient';
export { useConversations } from './hooks/useConversations';
export type { UseConversationsResult } from './hooks/useConversations';
export { ConversationDrawer } from './components/ConversationDrawer/ConversationDrawer';
export type { ConversationDrawerProps } from './components/ConversationDrawer/ConversationDrawer';
