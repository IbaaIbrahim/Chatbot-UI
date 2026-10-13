import React from 'react';
import './ChatContainer.css';
import { ChatHeader } from '../ChatHeader/ChatHeader';
import { ConversationSidebar } from '../ConversationSidebar/ConversationSidebar';
import { CreditUsageDialog } from '../CreditUsage/CreditUsageDialog';
import { MainChat } from '../MainChat/MainChat';
import { useChatActions, useChatState, useIcons, useLabels } from '../../store/hooks';
import {
    ALL_MODES,
    ChatMode,
    ChatPresentation,
    ChatPresentationContext,
    ChatTheme,
    themeAttribute,
    useWideViewport,
} from './presentation';

export type { ChatMode, ChatTheme } from './presentation';

const { useEffect, useMemo, useState } = React;

export interface ChatContainerProps {
    mode?: ChatMode;
    /** The modes "Switch view" may move between; the first is used if `mode` is not among them. */
    allowedModes?: ChatMode[];
    theme?: ChatTheme;
    /** A flex child of the host's layout rather than a fixed overlay. */
    embedded?: boolean;
    noBackground?: boolean;
    /**
     * The floating button's icon, shown while a floating chat is closed. Any React
     * node: an SVG, an icon component, a font icon or an `<img>`. Defaults to
     * `config.icons.launcher` (the sparkle), so a host that sets the icon there
     * for every instance needs nothing here.
     */
    launcherIcon?: React.ReactNode;
    /** Replaces the header; `null` removes it. Defaults to `<ChatHeader />`. */
    header?: React.ReactNode;
    /** Replaces the conversation sidebar; `null` removes it. Defaults to `<ConversationSidebar />`. */
    sidebar?: React.ReactNode;
    /** Under the transcript — usually the composer. */
    footer?: React.ReactNode;
    /** The transcript. Defaults to `<MainChat />`; anything else must scroll itself. */
    children?: React.ReactNode;
    className?: string;
}

/**
 * The chat's frame: placement (floating, docked or fullscreen), theme, the
 * sidebar, the header, the transcript and the footer.
 *
 * Reads the open and sidebar state from the provider, so it can be rendered —
 * and moved — anywhere under `ChatbotProvider`; closing it from the host is
 * `useChatActions().close()`, not a prop on this component.
 */
export const ChatContainer: React.FC<ChatContainerProps> = ({
    mode = 'floating',
    allowedModes,
    theme = 'system',
    embedded = false,
    noBackground = false,
    launcherIcon,
    header,
    sidebar,
    footer,
    children,
    className = '',
}) => {
    const isOpen = useChatState(s => s.isOpen);
    const isSidebarOpen = useChatState(s => s.isSidebarOpen);
    const sidebarEnabled = useChatState(s => s.config.sidebar.enabled);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const isWideViewport = useWideViewport();
    const [mounted, setMounted] = useState(false);

    const effectiveAllowedModes = allowedModes && allowedModes.length > 0 ? allowedModes : ALL_MODES;
    const effectiveMode = effectiveAllowedModes.includes(mode) ? mode : effectiveAllowedModes[0];
    const sidebarInline = effectiveMode === 'fullscreen' && isWideViewport;

    const presentation = useMemo<ChatPresentation>(() => ({
        mode: effectiveMode,
        allowedModes: effectiveAllowedModes,
        theme,
        embedded,
        sidebarInline,
    }), [effectiveMode, effectiveAllowedModes, theme, embedded, sidebarInline]);

    useEffect(() => {
        setMounted(true);
    }, []);

    // An overlay sidebar closes on Escape; an inline column is part of the page.
    useEffect(() => {
        if (!isSidebarOpen || sidebarInline) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') actions.closeSidebar();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isSidebarOpen, sidebarInline, actions]);

    if (!mounted) return null;

    if (!isOpen && effectiveMode === 'floating' && !embedded) {
        return (
            <button
                type="button"
                className="cb-chat-launcher cb-launcher-btn"
                data-theme={themeAttribute(theme)}
                onClick={actions.open}
                aria-label={labels.openChat}
            >
                <div className="cb-launcher-icon cb-launcher-sparkle-icon" aria-hidden="true">
                    {launcherIcon ?? icons.launcher}
                </div>
            </button>
        );
    }

    const containerClasses = [
        'cb-chat-container',
        `cb-mode-${effectiveMode}`,
        isOpen ? 'cb-open' : 'cb-closed',
        embedded ? 'cb-embedded' : null,
        noBackground ? 'cb-no-background' : null,
        className || null,
    ].filter(Boolean).join(' ');

    const sidebarNode = sidebar === undefined ? <ConversationSidebar /> : sidebar;
    const showSidebar = sidebarEnabled && sidebarNode !== null;

    return (
        <ChatPresentationContext.Provider value={presentation}>
            <div className={containerClasses} data-theme={themeAttribute(theme)}>
                <div className="cb-chat-body-wrapper">
                    {showSidebar && (
                        <div className={`cb-drawer-wrapper ${isSidebarOpen ? 'open' : ''}`}>
                            <div className="cb-drawer-content">{sidebarNode}</div>
                            <div className="cb-drawer-backdrop" onClick={actions.closeSidebar} />
                        </div>
                    )}

                    <div className="cb-chat-content">
                        {header === undefined ? <ChatHeader /> : header}
                        {children ?? <MainChat />}
                        {footer && <div className="cb-chat-footer">{footer}</div>}
                    </div>
                </div>
                <CreditUsageDialog />
            </div>
        </ChatPresentationContext.Provider>
    );
};
