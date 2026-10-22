import React from 'react';
import { useSyncExternalStoreWithSelector } from 'use-sync-external-store/shim/with-selector';
import { DEFAULT_CHATBOT_CONFIG } from '../common/chatbotConfig';
import type { ChatbotConfig, ResolvedChatbotConfig, ResolvedMarkdownConfig } from '../common/chatbotConfig';
import type { StorageClient } from '../api/StorageClient';
import type { ChatIcons } from '../common/icons';
import type { ChatLabels } from '../common/labels';
import { createChatFormat, formattingLocale, type ChatFormat } from '../common/i18n';
import { createChatStore } from './createChatStore';
import type {
    ChatActions,
    ChatEventHandler,
    ChatEventType,
    ChatRuntime,
    ChatServices,
    ChatSnapshot,
} from './types';

const { createContext, useContext, useEffect, useLayoutEffect, useRef } = React;

export const ChatRuntimeContext = createContext<ChatRuntime | null>(null);

const MISSING_PROVIDER =
    'chatbot-ui: this component or hook must be rendered inside <ChatbotProvider> '
    + '(or <ChatApp>, which creates one when there is none above it).';

export function useChatRuntime(): ChatRuntime {
    const runtime = useContext(ChatRuntimeContext);
    if (!runtime) throw new Error(MISSING_PROVIDER);
    return runtime;
}

/** The runtime when there is a provider above, otherwise `null`. */
export function useOptionalChatRuntime(): ChatRuntime | null {
    return useContext(ChatRuntimeContext);
}

/**
 * Read one slice of the chat; re-render only when that slice changes.
 *
 * ```ts
 * const sidebarOpen = useChatState(s => s.isSidebarOpen);
 * ```
 *
 * Select the smallest value you need. A selector that builds a new object on
 * every call re-renders on every change unless it is paired with an equality
 * function — `shallowEqual` from this package covers the usual case.
 */
export function useChatState<Selected>(
    selector: (snapshot: ChatSnapshot) => Selected,
    isEqual?: (previous: Selected, next: Selected) => boolean
): Selected {
    const { store } = useChatRuntime();
    return useSyncExternalStoreWithSelector(store.subscribe, store.getState, store.getState, selector, isEqual);
}

/** Do anything the chat can do — open it, send a message, star a thread — from anywhere under the provider. */
export function useChatActions(): ChatActions {
    return useChatRuntime().actions;
}

/**
 * Run `handler` each time `type` happens, for as long as the caller is mounted.
 *
 * For reacting to a moment — the sidebar opening, a message being sent — rather
 * than rendering a state, which is what `useChatState` is for. The latest
 * `handler` is always the one called, so it need not be memoised.
 */
export function useChatEvent<Type extends ChatEventType>(type: Type, handler: ChatEventHandler<Type>): void {
    const { events } = useChatRuntime();
    const latestHandler = useRef(handler);
    useLayoutEffect(() => {
        latestHandler.current = handler;
    });
    useEffect(
        () => events.on(type, payload => latestHandler.current(payload)),
        [events, type]
    );
}

let overrideOwnerSequence = 0;

/**
 * Lay a configuration layer over the provider's `config` for as long as the
 * caller is mounted, and withdraw it on unmount.
 *
 * This is how one screen changes the chat without changing it for every other
 * screen — hide the close button on a page that cannot close the chat, rename
 * the composer's placeholder, offer that page's own quick actions:
 *
 * ```ts
 * useChatOverrides(PAGE_CHAT_CONFIG); // a module constant, or a useMemo result
 * ```
 *
 * Layers apply in the order they were first registered, over the provider's
 * `config`. Pass a stable object: a new object on every render re-registers on
 * every render. A layer equal to the one already registered is ignored, which
 * keeps a literal of plain values cheap, but a literal holding elements or
 * functions is new each time.
 */
export function useChatOverrides(layer: ChatbotConfig): void {
    const { overrides } = useChatRuntime();
    const ownerRef = useRef<string | null>(null);
    if (ownerRef.current === null) {
        overrideOwnerSequence += 1;
        ownerRef.current = `chat-overrides-${overrideOwnerSequence}`;
    }
    const owner = ownerRef.current;

    useLayoutEffect(() => {
        overrides.register(owner, layer);
    }, [overrides, owner, layer]);

    useLayoutEffect(() => () => overrides.unregister(owner), [overrides, owner]);
}

/** The configuration in force, with every override layer applied. */
export function useChatConfig(): ResolvedChatbotConfig {
    return useChatState(selectConfig);
}

interface ConfigSource {
    getState: () => { config: ResolvedChatbotConfig };
    subscribe: (listener: () => void) => () => void;
}

/**
 * What the labels and icons read when no provider is above: the defaults. The
 * transcript components can be used on their own, so they must not require one.
 */
const DEFAULTS_ONLY: ConfigSource = createChatStore({ config: DEFAULT_CHATBOT_CONFIG });

const selectConfig = (snapshot: { config: ResolvedChatbotConfig }) => snapshot.config;
const selectLabels = (snapshot: { config: ResolvedChatbotConfig }) => snapshot.config.labels;
const selectIcons = (snapshot: { config: ResolvedChatbotConfig }) => snapshot.config.icons;
const selectMarkdown = (snapshot: { config: ResolvedChatbotConfig }) => snapshot.config.markdown;
const selectLanguage = (snapshot: { config: ResolvedChatbotConfig }) => snapshot.config.language;

function useConfigSource(): ConfigSource {
    return useOptionalChatRuntime()?.store ?? DEFAULTS_ONLY;
}

export function useLabels(): ChatLabels {
    const source = useConfigSource();
    return useSyncExternalStoreWithSelector(source.subscribe, source.getState, source.getState, selectLabels);
}

/**
 * The language the chat writes numbers and dates in: `config.language`, else
 * the page's `<html lang>`, else `undefined` (the browser's own). Outside a
 * provider, the page's. Since 4.2.
 */
export function useChatLanguage(): string | undefined {
    const source = useConfigSource();
    const configured = useSyncExternalStoreWithSelector(source.subscribe, source.getState, source.getState, selectLanguage);
    return formattingLocale(configured);
}

/**
 * The language the host set (`config.language`), as it set it — `undefined`
 * when none did. What the chat's `lang` attribute says.
 */
export function useConfiguredLanguage(): string | undefined {
    const source = useConfigSource();
    return useSyncExternalStoreWithSelector(source.subscribe, source.getState, source.getState, selectLanguage);
}

/**
 * Write numbers, dates, sizes, lists and counts as the chat does — in its
 * language, with its labels: `format.plural(labels.credits, 3)`,
 * `format.fileSize(2048)`, `format.relativeDate(iso)`. For a host's block
 * renderer or a widget of its own beside the chat. Since 4.2.
 */
export function useChatFormat(): ChatFormat {
    const labels = useLabels();
    const language = useChatLanguage();
    return React.useMemo(() => createChatFormat(labels, language), [labels, language]);
}

export function useIcons(): ChatIcons {
    const source = useConfigSource();
    return useSyncExternalStoreWithSelector(source.subscribe, source.getState, source.getState, selectIcons);
}

/**
 * The rich-block configuration in force — the defaults (no renderers) outside
 * a provider, for the same reason as the labels: a transcript component drawn
 * on its own must not require one.
 */
export function useMarkdownConfig(): ResolvedMarkdownConfig {
    const source = useConfigSource();
    return useSyncExternalStoreWithSelector(source.subscribe, source.getState, source.getState, selectMarkdown);
}

/** What the conversation-scoped hooks below read when no provider is above: nothing. */
const NO_SESSION = createChatStore<Partial<ChatSnapshot>>({});

function useOptionalSlice<Selected>(selector: (snapshot: Partial<ChatSnapshot>) => Selected): Selected {
    const store = useOptionalChatRuntime()?.store ?? NO_SESSION;
    return useSyncExternalStoreWithSelector(
        store.subscribe,
        store.getState as () => Partial<ChatSnapshot>,
        store.getState as () => Partial<ChatSnapshot>,
        selector
    );
}

const selectActiveConversationId = (snapshot: Partial<ChatSnapshot>) => snapshot.activeConversationId ?? null;
const selectStorageClient = (snapshot: Partial<ChatSnapshot>) => snapshot.storageClient ?? null;

/** The open conversation's id, or `null` — also outside a provider. */
export function useActiveConversationId(): string | null {
    return useOptionalSlice(selectActiveConversationId);
}

/**
 * The storage API client for the signed-in user — list a conversation's files
 * or the user's artifacts, fetch or download one. `null` outside a provider,
 * or when the provider has no `storageApiUrl` or no `accessToken`.
 */
export function useStorageClient(): StorageClient | null {
    return useOptionalSlice(selectStorageClient);
}

/**
 * Fetch a storage-API URL with the session's credentials and hand back a blob
 * URL, or `null` outside a provider. The function keeps its identity, so an
 * effect that depends on it runs when its own inputs change — not on every
 * streamed token, which is what depending on the whole context used to cause.
 */
export function useAuthenticatedFetch(): ChatServices['fetchAuthenticatedUrl'] | null {
    return useOptionalChatRuntime()?.services.fetchAuthenticatedUrl ?? null;
}
