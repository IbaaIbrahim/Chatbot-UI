import React from 'react';
import type { TextDirection } from '../../common/direction';

export type ChatMode = 'floating' | 'sidebar' | 'fullscreen';
export type ChatTheme = 'light' | 'dark' | 'system';
/**
 * The edge of the layout — or of the viewport, for an overlay — the chat
 * attaches to, named in the chat's own direction: `'end'` is the right in a
 * left-to-right page and the left in a right-to-left one; `'start'` is the
 * other. Fullscreen fills the page and has no side.
 */
export type ChatSide = 'end' | 'start';

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
    /** The edge the chat attaches to — see {@link ChatSide}. */
    side: ChatSide;
    /**
     * The direction the chat inherits from the page around it, as the browser
     * resolved it. Placement follows it: `side` is read in it.
     */
    direction: TextDirection;
    /**
     * The sidebar is a column beside the transcript (fullscreen on a wide
     * screen) rather than an overlay across it. An overlay closes itself after
     * the user picks a conversation; a column stays.
     */
    sidebarInline: boolean;
}

export const ALL_MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];

/** The two sides, for validating a prop a JavaScript host may pass unchecked. */
export const CHAT_SIDES: readonly ChatSide[] = ['end', 'start'];

/** `side` as given, or `'end'` — the default — for anything that is not a side. */
export const resolveSide = (side: ChatSide | undefined): ChatSide =>
    side !== undefined && CHAT_SIDES.includes(side) ? side : 'end';

/**
 * The classes that place a chat root for its side and direction:
 * `cb-side-end` / `cb-side-start` and `cb-dir-ltr` / `cb-dir-rtl`. Positions are
 * logical properties and need neither; the slide-in transforms, which are
 * physical by nature, read their sign from these (ChatContainer.css).
 */
export const placementClasses = (side: ChatSide, direction: TextDirection): string[] =>
    [`cb-side-${side}`, `cb-dir-${direction}`];

export const ChatPresentationContext = React.createContext<ChatPresentation>({
    mode: 'floating',
    allowedModes: ALL_MODES,
    theme: 'system',
    embedded: false,
    side: 'end',
    direction: 'ltr',
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
