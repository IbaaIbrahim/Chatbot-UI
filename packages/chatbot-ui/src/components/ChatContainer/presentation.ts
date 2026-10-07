import React from 'react';

export type ChatMode = 'floating' | 'sidebar' | 'fullscreen';
export type ChatTheme = 'light' | 'dark' | 'system';

/**
 * How one rendering of the chat is placed — a property of the container, not
 * of the chat. The same conversation can be shown floating on one screen and
 * fullscreen on another, so this travels down from `ChatContainer` (or
 * `ChatRoot`) rather than living in the provider's store.
 */
export interface ChatPresentation {
    mode: ChatMode;
    /** The modes the header's "Switch view" cycles through. */
    allowedModes: ChatMode[];
    theme: ChatTheme;
    /** A flex child of the host's layout rather than a fixed overlay. */
    embedded: boolean;
    /**
     * The sidebar is a column beside the transcript (fullscreen on a wide
     * screen) rather than an overlay across it. An overlay closes itself after
     * the user picks a conversation; a column stays.
     */
    sidebarInline: boolean;
}

export const ALL_MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];

export const ChatPresentationContext = React.createContext<ChatPresentation>({
    mode: 'floating',
    allowedModes: ALL_MODES,
    theme: 'system',
    embedded: false,
    sidebarInline: false,
});

export const useChatPresentation = (): ChatPresentation => React.useContext(ChatPresentationContext);

/** `data-theme` for a root element; `system` stamps nothing so the OS decides. */
export const themeAttribute = (theme: ChatTheme): 'light' | 'dark' | undefined =>
    theme === 'system' ? undefined : theme;

/** Matches the CSS breakpoint at which fullscreen lays the sidebar out as a column. */
const INLINE_SIDEBAR_QUERY = '(min-width: 960px)';

const matchesInlineSidebar = (): boolean =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.(INLINE_SIDEBAR_QUERY).matches);

/** Whether the viewport is wide enough for fullscreen's inline sidebar, kept current on resize. */
export function useWideViewport(): boolean {
    const [isWide, setIsWide] = React.useState(matchesInlineSidebar);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const query = window.matchMedia(INLINE_SIDEBAR_QUERY);
        const onChange = () => setIsWide(query.matches);
        onChange();
        query.addEventListener('change', onChange);
        return () => query.removeEventListener('change', onChange);
    }, []);

    return isWide;
}
