import * as React from 'react';
import { ChatContainer, ChatMode, ChatTheme } from '../ChatContainer/ChatContainer';
import { Composer } from '../Composer/Composer';
import { MainChat } from '../MainChat/MainChat';
import { ChatbotProvider, useChatbot } from '../../context/ChatbotContext';
import type { AgentSidebarItem } from '../AgentSidebar/AgentSidebar';
import type { ChatbotUIConfig } from '../../common/chatbotConfig';
import type { StreamChatClient } from '../../api/StreamClient';
import type { GatewayStreamClient } from '../../api/GatewayStreamClient';
import type { UseStreamChatOptions } from '../../hooks/useStreamChat';
import type { ToolConfig } from '../../common/toolConfig';

export interface AppProps {
    client?: StreamChatClient | GatewayStreamClient | null;
    streamUrl?: string;
    streamHeaders?: Record<string, string>;
    mode?: ChatMode;
    isOpen?: boolean;
    onClose?: () => void;
    onOpen?: () => void;
    embedded?: boolean;
    userName?: string;
    onEvent?: UseStreamChatOptions['onEvent'];
    storageApiUrl?: string;
    accessToken?: string | null;
    allowLocalNetworkAccess?: boolean;
    agents?: AgentSidebarItem[];
    tools?: Record<string, ToolConfig>;
    agentId?: string | null;
    agentsLoading?: boolean;
    onAgentChange?: (agentId: string | null) => void;
    theme?: ChatTheme;
    show_tool_toggles?: boolean;
    showAgentSwitcher?: boolean;
    show_agent_switcher?: boolean;
    showBottomSection?: boolean;
    show_bottom_section?: boolean;
    headerActions?: React.ReactNode;
    brand?: React.ReactNode;
    allowedModes?: ChatMode[];
    noBackground?: boolean;
    config?: ChatbotUIConfig;
    onContextChange?: (contexts: string[]) => void;
    onSwitchMode?: (mode: ChatMode) => void;
    onShare?: () => void;
}

const ChatAppInner: React.FC<AppProps> = ({
    mode = 'fullscreen',
    theme = 'system',
    isOpen = true,
    onClose,
    onOpen,
    embedded = false,
    userName = 'User',
    headerActions,
    brand,
    allowedModes,
    noBackground = false,
    config,
    onContextChange,
    onSwitchMode,
    onShare,
    showAgentSwitcher,
    show_agent_switcher,
    showBottomSection,
    show_bottom_section,
}) => {
    const context = useChatbot();

    const messages = context?.messages ?? [];
    const isEmptyFullscreen = mode === 'fullscreen' && messages.length === 0;

    const composerElement = (
        <div className="cb-composer-stack">
            <Composer
                ref={context?.composerRef}
                onSelectedContextsChange={onContextChange}
                toolMenuPlacement={isEmptyFullscreen ? 'center' : 'above'}
                showAgentSwitcher={showAgentSwitcher}
                show_agent_switcher={show_agent_switcher}
                showBottomSection={showBottomSection}
                show_bottom_section={show_bottom_section}
            />
        </div>
    );

    return (
        <ChatContainer
            mode={mode}
            theme={theme}
            isOpen={isOpen}
            onClose={onClose}
            onOpen={onOpen}
            embedded={embedded}
            allowedModes={allowedModes}
            noBackground={noBackground}
            onSwitchMode={onSwitchMode}
            headerActions={headerActions}
            brand={brand}
            onShare={onShare}
            footer={isEmptyFullscreen ? null : composerElement}
        >
            <MainChat
                emptyComposer={isEmptyFullscreen ? composerElement : undefined}
                userName={userName}
                config={config}
                mode={mode}
            />
        </ChatContainer>
    );
};

export const App: React.FC<AppProps> = (props) => {
    const existingContext = useChatbot();
    if (existingContext) {
        return <ChatAppInner {...props} />;
    }
    return (
        <ChatbotProvider {...props}>
            <ChatAppInner {...props} />
        </ChatbotProvider>
    );
};

export const ChatApp = App;
