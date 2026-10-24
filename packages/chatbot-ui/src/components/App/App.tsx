import * as React from 'react';
import { ChatContainer } from '../ChatContainer/ChatContainer';
import type { ChatMode, ChatSide, ChatTheme } from '../ChatContainer/presentation';
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
    /**
     * The edge the chat attaches to, in the page's direction: `'end'` (the
     * default — the right in a left-to-right page, the left in a right-to-left
     * one) or `'start'`. Embedded, `'start'` leads the host's flex row and
     * `'end'` keeps the DOM place the host gave it (no `order`). See
     * `ChatContainerProps.side`.
     */
    side?: ChatSide;
    noBackground?: boolean;
    /**
     * The floating button's icon — any React node (an SVG, an icon component, a
     * font icon, an `<img>`). Defaults to `config.icons.launcher`. See
     * `ChatContainerProps.launcherIcon`.
     */
    launcherIcon?: React.ReactNode;
    /**
     * Replaces the floating button; `null` removes it, for a host that opens
     * the chat from a control of its own. Defaults to the round button drawn
     * with `launcherIcon`. See `ChatContainerProps.launcher`.
     */
    launcher?: React.ReactNode;
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

// Every placement prop decided by `App`'s defaults; the icon and the launcher
// stay optional, so an omitted icon falls through to `config.icons.launcher`
// and an omitted launcher to the round button.
type ChatAppLayoutProps = Required<Omit<ChatAppPresentationProps, 'launcherIcon' | 'launcher'>>
    & Pick<ChatAppPresentationProps, 'launcherIcon' | 'launcher'>;

const ChatAppLayout: React.FC<ChatAppLayoutProps> = ({
    mode,
    allowedModes,
    theme,
    embedded,
    side,
    noBackground,
    launcherIcon,
    launcher,
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
            side={side}
            noBackground={noBackground}
            launcherIcon={launcherIcon}
            launcher={launcher}
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
    side = 'end',
    noBackground = false,
    launcherIcon,
    launcher,
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
            side={side}
            noBackground={noBackground}
            launcherIcon={launcherIcon}
            launcher={launcher}
        />
    );

    return runtime ? layout : <ChatbotProvider {...providerProps}>{layout}</ChatbotProvider>;
};

export const ChatApp = App;
