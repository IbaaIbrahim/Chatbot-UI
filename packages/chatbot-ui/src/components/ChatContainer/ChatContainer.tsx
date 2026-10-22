import React from 'react';
import './ChatContainer.css';
import { ChatHeader } from '../ChatHeader/ChatHeader';
import { ConversationSidebar } from '../ConversationSidebar/ConversationSidebar';
import { CreditUsageDialog } from '../CreditUsage/CreditUsageDialog';
import { ArtifactsPanel } from '../Files/ArtifactsPanel';
import { ConversationFilesPanel } from '../Files/ConversationFilesPanel';
import { MainChat } from '../MainChat/MainChat';
import { useChatActions, useChatState, useConfiguredLanguage, useIcons, useLabels } from '../../store/hooks';
import { useInheritedDirection } from '../../common/direction';
import {
    ALL_MODES,
    ChatMode,
    ChatPresentation,
    ChatPresentationContext,
    ChatSide,
    ChatTheme,
    placementClasses,
    resolveSide,
    themeAttribute,
    useWideViewport,
} from './presentation';

export type { ChatMode, ChatSide, ChatTheme } from './presentation';

const { useEffect, useMemo, useState } = React;

export interface ChatContainerProps {
    mode?: ChatMode;
    /** The modes "Switch view" may move between; the first is used if `mode` is not among them. */
    allowedModes?: ChatMode[];
    theme?: ChatTheme;
    /** A flex child of the host's layout rather than a fixed overlay. */
    embedded?: boolean;
    /**
     * The edge the chat attaches to, in the page's direction: `'end'` (the
     * default) is the right in a left-to-right page and the left in a
     * right-to-left one; `'start'` is the other. It places the floating card
     * and its launcher, and the overlay sidebar (and the side it slides in
     * from). An embedded chat gets its border on the inner edge, and
     * `'start'` leads the host's flex row (`order: -1`) whatever its DOM
     * place; `'end'` sets no `order` and keeps the place the host gave it —
     * after the host's content only if the host renders it there (give it
     * `order: 1` to force the end). Fullscreen has no side. The direction is
     * the one the chat inherits (`dir` on `<html>` or any ancestor), read
     * from the browser.
     */
    side?: ChatSide;
    noBackground?: boolean;
    /**
     * The floating button's icon, shown while a floating chat is closed. Any React
     * node: an SVG, an icon component, a font icon or an `<img>`. Defaults to
     * `config.icons.launcher` (the sparkle), so a host that sets the icon there
     * for every instance needs nothing here.
     */
    launcherIcon?: React.ReactNode;
    /**
     * Replaces the floating button a closed floating chat shows; `null` removes
     * it, for a host that opens the chat from a control of its own — a button
     * in its header calling `useChatActions().open()`. Defaults to the round
     * button drawn with `launcherIcon`. A replacement is drawn as it is, with
     * none of the button's placement or theme.
     */
    launcher?: React.ReactNode;
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
 * The chat's frame: placement (floating, docked or fullscreen, at the `side`
 * the host names, in the page's direction), theme, the sidebar, the header,
 * the transcript and the footer.
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
    side: sideProp,
    noBackground = false,
    launcherIcon,
    launcher,
    header,
    sidebar,
    footer,
    children,
    className = '',
}) => {
    const isOpen = useChatState(s => s.isOpen);
    const isSidebarOpen = useChatState(s => s.isSidebarOpen);
    const isArtifactsOpen = useChatState(s => s.isArtifactsPanelOpen);
    const sidebarEnabled = useChatState(s => s.config.sidebar.enabled);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    // `lang` from `config.language` (4.2): screen readers pronounce the chat
    // in its language, and the browser hyphenates and picks fonts for it. The
    // layout's direction stays the page's (`useInheritedDirection`) — a
    // language is not a layout.
    const language = useConfiguredLanguage();
    const isWideViewport = useWideViewport();
    const [mounted, setMounted] = useState(false);
    // The element drawn — the launcher or the panel — whose inherited
    // direction the placement is read in. State, not a ref, so the direction
    // is read again from whichever of the two is mounted.
    const [frame, setFrame] = useState<HTMLElement | null>(null);
    const direction = useInheritedDirection(frame);
    const side = resolveSide(sideProp);

    const effectiveAllowedModes = allowedModes && allowedModes.length > 0 ? allowedModes : ALL_MODES;
    const effectiveMode = effectiveAllowedModes.includes(mode) ? mode : effectiveAllowedModes[0];
    const sidebarInline = effectiveMode === 'fullscreen' && isWideViewport;

    const presentation = useMemo<ChatPresentation>(() => ({
        mode: effectiveMode,
        allowedModes: effectiveAllowedModes,
        theme,
        embedded,
        side,
        direction,
        sidebarInline,
    }), [effectiveMode, effectiveAllowedModes, theme, embedded, side, direction, sidebarInline]);

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
        if (launcher !== undefined) return <>{launcher}</>;
        return (
            <button
                ref={setFrame}
                type="button"
                className={['cb-chat-launcher', 'cb-launcher-btn', ...placementClasses(side, direction)].join(' ')}
                data-theme={themeAttribute(theme)}
                lang={language}
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
        ...placementClasses(side, direction),
        noBackground ? 'cb-no-background' : null,
        className || null,
    ].filter(Boolean).join(' ');

    const sidebarNode = sidebar === undefined ? <ConversationSidebar /> : sidebar;
    const showSidebar = sidebarEnabled && sidebarNode !== null;

    return (
        <ChatPresentationContext.Provider value={presentation}>
            <div ref={setFrame} className={containerClasses} data-theme={themeAttribute(theme)} lang={language}>
                <div className="cb-chat-body-wrapper">
                    {showSidebar && (
                        <div className={`cb-drawer-wrapper ${isSidebarOpen ? 'open' : ''}`}>
                            <div className="cb-drawer-content">{sidebarNode}</div>
                            <div className="cb-drawer-backdrop" onClick={actions.closeSidebar} />
                        </div>
                    )}

                    <div className="cb-chat-content">
                        {header === undefined ? <ChatHeader /> : header}
                        {/* The transcript and the composer — or, while
                            "Artifacts" is chosen, the Artifacts view in their
                            place, under the header and beside the sidebar.
                            Both sit in one cell of the stage, so the view takes
                            exactly their room; the chat stays mounted but
                            hidden, from the eye and from assistive technology,
                            so a draft, an upload under way and the scroll
                            position are there when the user comes back. */}
                        <div className={`cb-chat-stage${isArtifactsOpen ? ' is-showing-artifacts' : ''}`}>
                            <div className="cb-chat-view" aria-hidden={isArtifactsOpen || undefined}>
                                {children ?? <MainChat />}
                                {footer && <div className="cb-chat-footer">{footer}</div>}
                            </div>
                            <ArtifactsPanel />
                        </div>
                        {/* Over the chat column only, so fullscreen's inline
                            sidebar stays beside it. */}
                        <ConversationFilesPanel />
                    </div>
                </div>
                <CreditUsageDialog />
            </div>
        </ChatPresentationContext.Provider>
    );
};
