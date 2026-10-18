import React from 'react';
import {
    ChatMode,
    ChatPresentation,
    ChatPresentationContext,
    ChatTheme,
    themeAttribute,
} from '../ChatContainer/presentation';

export interface ChatRootProps {
    theme?: ChatTheme;
    /** What the widgets inside lay themselves out for; fullscreen shows the expanded welcome. */
    mode?: ChatMode;
    className?: string;
    style?: React.CSSProperties;
    children: React.ReactNode;
}

/**
 * The chat's design tokens and theme around widgets placed in a layout of the
 * host's own — a composer in a page's hero section, say — without the frame,
 * header or sidebar of `ChatContainer`. Every widget is styled from tokens that
 * exist only inside a chat root, so a widget rendered outside one is unstyled.
 */
export const ChatRoot: React.FC<ChatRootProps> = ({
    theme = 'system',
    mode = 'fullscreen',
    className = '',
    style,
    children,
}) => {
    const presentation = React.useMemo<ChatPresentation>(() => ({
        mode,
        allowedModes: [mode],
        theme,
        embedded: true,
        sidebarInline: false,
    }), [mode, theme]);

    return (
        <ChatPresentationContext.Provider value={presentation}>
            <div className={`cb-root ${className}`} data-theme={themeAttribute(theme)} style={style}>
                {children}
            </div>
        </ChatPresentationContext.Provider>
    );
};
