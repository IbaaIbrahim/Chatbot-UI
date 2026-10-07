import * as React from 'react';
import { ChatContainer } from '../ChatContainer/ChatContainer';
import type { ChatMode, ChatTheme } from '../ChatContainer/presentation';
import { Composer } from '../Composer/Composer';
import { MainChat } from '../MainChat/MainChat';
import { ChatbotProvider } from '../../context/ChatbotContext';
import type { ChatbotProviderProps } from '../../context/ChatbotContext';
import { useChatState, useOptionalChatRuntime } from '../../store/hooks';

/** Where and how the chat is drawn — read by this instance only. */
export interface ChatAppPresentationProps {
    mode?: ChatMode;
    allowedModes?: ChatMode[];
    theme?: ChatTheme;
    embedded?: boolean;
    noBackground?: boolean;
}

/**
 * The ready-made chat: header, sidebar, transcript and composer.
 *
 * With no `ChatbotProvider` above it, it creates one from its own props. Under
 * a provider it uses that one, and the provider props here are ignored — which
 * is what a host that mounts the provider once at its root wants, and is
 * reported if any are passed anyway.
 */
export type AppProps = ChatAppPresentationProps & Omit<ChatbotProviderProps, 'children'>;

const ChatAppLayout: React.FC<Required<ChatAppPresentationProps>> = ({
    mode,
    allowedModes,
    theme,
    embedded,
    noBackground,
}) => {
    const isEmpty = useChatState(s => s.messages.length === 0);
    const isEmptyFullscreen = mode === 'fullscreen' && isEmpty;

    const composer = (
        <div className="cb-composer-stack">
            <Composer toolMenuPlacement={isEmptyFullscreen ? 'center' : 'above'} />
        </div>
    );

    return (
        <ChatContainer
            mode={mode}
            allowedModes={allowedModes}
            theme={theme}
            embedded={embedded}
            noBackground={noBackground}
            footer={isEmptyFullscreen ? null : composer}
        >
            <MainChat emptyComposer={isEmptyFullscreen ? composer : undefined} />
        </ChatContainer>
    );
};

const NO_MODES: ChatMode[] = [];

export const App: React.FC<AppProps> = ({
    mode = 'fullscreen',
    allowedModes = NO_MODES,
    theme = 'system',
    embedded = false,
    noBackground = false,
    ...providerProps
}) => {
    const runtime = useOptionalChatRuntime();
    const ignoredProps = runtime
        ? Object.entries(providerProps).filter(([, value]) => value !== undefined).map(([name]) => name)
        : [];
    const ignoredKey = ignoredProps.join(', ');

    React.useEffect(() => {
        if (!ignoredKey) return;
        console.warn(
            `[chatbot-ui] <ChatApp> is inside a <ChatbotProvider>, so these props were ignored: ${ignoredKey}. `
            + 'Pass them to the provider instead.'
        );
    }, [ignoredKey]);

    const layout = (
        <ChatAppLayout
            mode={mode}
            allowedModes={allowedModes}
            theme={theme}
            embedded={embedded}
            noBackground={noBackground}
        />
    );

    return runtime ? layout : <ChatbotProvider {...providerProps}>{layout}</ChatbotProvider>;
};

export const ChatApp = App;
