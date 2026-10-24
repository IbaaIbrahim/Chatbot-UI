import React from 'react';
import { useInheritedDirection } from '../../common/direction';
import { useConfiguredLanguage } from '../../store/hooks';
import {
    ChatMode,
    ChatPresentation,
    ChatPresentationContext,
    ChatSide,
    ChatTheme,
    placementClasses,
    resolveSide,
    themeAttribute,
} from '../ChatContainer/presentation';

export interface ChatRootProps {
    theme?: ChatTheme;
    /** What the widgets inside lay themselves out for; fullscreen shows the expanded welcome. */
    mode?: ChatMode;
    /**
     * The side the widgets inside report through the presentation (`'end'` by
     * default). A root is laid out by the host, so this places nothing itself;
     * it is for widgets that draw toward the chat's edge.
     */
    side?: ChatSide;
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
    side: sideProp,
    className = '',
    style,
    children,
}) => {
    const [element, setElement] = React.useState<HTMLDivElement | null>(null);
    const direction = useInheritedDirection(element);
    // The chat's language (`config.language`), when the root is under a provider.
    const language = useConfiguredLanguage();
    const side = resolveSide(sideProp);
    const presentation = React.useMemo<ChatPresentation>(() => ({
        mode,
        allowedModes: [mode],
        theme,
        embedded: true,
        side,
        direction,
        sidebarInline: false,
    }), [mode, theme, side, direction]);

    const classes = ['cb-root', ...placementClasses(side, direction), className].filter(Boolean).join(' ');

    return (
        <ChatPresentationContext.Provider value={presentation}>
            <div ref={setElement} className={classes} data-theme={themeAttribute(theme)} style={style} lang={language}>
                {children}
            </div>
        </ChatPresentationContext.Provider>
    );
};
