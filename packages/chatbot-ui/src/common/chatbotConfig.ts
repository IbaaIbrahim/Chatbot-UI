import type React from 'react';
import { ChatLabels, DEFAULT_LABELS } from './labels';
import { ChatIcons, DEFAULT_ICONS } from './icons';

/**
 * Everything a host can change about the chat without writing a component:
 * the words, the icons, which controls exist, and what the welcome screen
 * offers.
 *
 * Passed once as `ChatbotProvider`'s `config`, and layered per screen with
 * `useChatOverrides`, which withdraws its layer when the screen unmounts. Every
 * group is partial: what a layer leaves out keeps the value beneath it.
 *
 * Visibility flags only ever *hide*. A control also needs something to do — the
 * close button a way to close, the mic a voice handler — and it renders only
 * when it has both, so a flag can never conjure a button that does nothing.
 */
export interface ChatbotConfig {
    labels?: Partial<ChatLabels>;
    icons?: Partial<ChatIcons>;
    header?: HeaderConfig;
    composer?: ComposerConfig;
    sidebar?: SidebarConfig;
    greeting?: GreetingConfig;
    /** Prompt rows on the compact welcome screen (floating and sidebar modes). */
    suggestions?: SuggestionItem[];
    /** Prompt pills on the expanded welcome screen (fullscreen). */
    quickActions?: QuickActionItem[];
    /** Cards under the pills on the expanded welcome screen. */
    featureCards?: FeatureCardItem[];
}

/** @deprecated Renamed to {@link ChatbotConfig} in 3.0. */
export type ChatbotUIConfig = ChatbotConfig;

export interface HeaderConfig {
    /** Hide the whole header bar. */
    visible?: boolean;
    /** Replaces the brand block (icon + `labels.brandTitle`); `false` removes it. */
    brand?: React.ReactNode | false;
    /** Host controls, rendered before the built-in buttons. */
    actions?: React.ReactNode;
    /** Extra entries at the end of the "more" menu. */
    menuItems?: HeaderMenuItem[];
    sidebarToggle?: boolean;
    newChat?: boolean;
    share?: boolean;
    menu?: boolean;
    /**
     * The menu's one "Switch view" entry, which opens the page's views in place
     * with the one in effect ticked. Shown only while there is another view to
     * switch to.
     */
    switchView?: boolean;
    /**
     * The views the entry lists, when the host defines its own — every view,
     * the active one included. Without it the menu lists the container's
     * `allowedModes` and calls the provider's `onSwitchMode`.
     */
    views?: ChatViewOption[];
    /** Narrows the views offered to these ids, e.g. on one page. */
    allowedViews?: string[];
    /**
     * The menu's copy entry: "Copy conversation link" when the provider has a
     * `conversationLink`, "Copy conversation ID" otherwise.
     */
    copyConversationId?: boolean;
    /**
     * The "Credit usage" entry, which shows the user's own allowance. Shown
     * only when the client can read it (`GatewayStreamClient`).
     */
    creditUsage?: boolean;
    /**
     * "Delete thread" in the menu, for the open conversation. On by default
     * since the Gateway serves `DELETE /v1/user/conversations/{id}`; a client
     * without `deleteConversation` refuses, and nothing is removed on screen.
     */
    deleteConversation?: boolean;
    close?: boolean;
}

/** A view the header's menu can switch to: a placement the host knows how to apply. */
export interface ChatViewOption {
    id: string;
    /** The view's name, e.g. "Floating chat" — the menu's entry says "Switch view". */
    label: string;
    icon?: React.ReactNode;
    /** The view in effect, ticked in the list. */
    active?: boolean;
    onSelect: () => void;
}

export interface HeaderMenuItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onSelect: () => void;
    danger?: boolean;
}

/**
 * How much room the composer takes.
 *
 * `comfortable` is the roomy box an empty chat presents: the text above a row
 * of buttons. `compact` is one row — buttons beside the text — that gives the
 * text the full width only once it needs a second line. `auto` is comfortable
 * while the chat is empty and compact once it has messages, when the height
 * belongs to the transcript.
 */
export type ComposerDensity = 'auto' | 'comfortable' | 'compact';

export interface ComposerConfig {
    attachments?: boolean;
    /** `false` also skips fetching the user-enablable tools. */
    tools?: boolean;
    /** Defaults to `'auto'`. */
    density?: ComposerDensity;
    /**
     * The usage indicator in the footer line: a ring for the context window and
     * the conversation's total credits beside it. `false` removes it.
     */
    usage?: boolean;
    /**
     * The breakdown card the usage indicator opens on click — context window,
     * this turn, sub-agents, the whole conversation. `false` leaves the ring and
     * the total credits, with nothing to open. On by default.
     */
    usageDetails?: boolean;
    disclaimer?: boolean;
    mic?: boolean;
    /** The mic button renders only when this is set: the library records no audio itself. */
    onVoiceInput?: () => void;
}

export interface SidebarConfig {
    /** `false` removes the sidebar and its toggle entirely. */
    enabled?: boolean;
    newChat?: boolean;
    /** Navigation entries under "New chat" — none by default. */
    items?: SidebarItem[];
    /** Shown only while the Gateway reports `starred_at` on conversations. */
    starred?: boolean;
    search?: boolean;
    /** "Rename" in a row's menu. Needs a client with `renameConversation`. */
    rename?: boolean;
    /** "Delete" in a row's menu; see {@link HeaderConfig.deleteConversation}. */
    deleteConversation?: boolean;
}

/** A navigation entry in the sidebar — an Artifacts or Tasks page, say. */
export interface SidebarItem {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onSelect: () => void;
    /** Highlights the entry, for a host whose route matches it. */
    active?: boolean;
    badge?: string | number;
}

export interface PrivacyBadge {
    text: string;
    icon?: 'lock' | 'shield' | 'check' | string;
}

export interface GreetingConfig {
    /** `{name}` is replaced with the provider's `userName`. Defaults to `labels.greetingTitle`. */
    title?: string;
    privacyBadges?: PrivacyBadge[];
}

/** `icon` is a built-in name (`pin`, `clipboard`, `message`) or any React node. */
export interface SuggestionItem {
    id: string;
    text: string;
    prompt?: string;
    icon?: React.ReactNode;
}

/**
 * A pill on the expanded welcome screen. Either a prompt of its own, sent when
 * chosen, or — with `prompts` — a category that opens a list of prompts under
 * the pills instead.
 *
 * `icon` is a built-in name (`clock`, `pencil`, `bolt`, `sparkle`, `clipboard`,
 * `message`, `help`) or any React node.
 */
export interface QuickActionItem {
    id: string;
    label: string;
    /** Sent when the pill is chosen; the label when omitted. Ignored for a category. */
    prompt?: string;
    icon?: React.ReactNode;
    /** Makes the pill a category: choosing it toggles this list rather than sending. */
    prompts?: QuickActionPrompt[];
}

/** One row of a quick-action category. */
export interface QuickActionPrompt {
    id: string;
    /** What the row says. */
    label: string;
    /** What is sent, or placed in the composer; the label when omitted. */
    prompt?: string;
    /**
     * `send` (the default) sends the prompt as it is. `insert` puts it in the
     * composer for the user to finish — for a prompt that needs a name, a date or
     * a site before it means anything ("Show me how a template is performing").
     */
    behavior?: 'send' | 'insert';
}

export interface FeatureCardItem {
    id: string;
    badge?: string;
    /** A built-in name; it also selects the card's illustration unless `image` is set. */
    icon?: string;
    title: string;
    description: string;
    image?: string;
    prompt?: string;
}

/** The configuration in force: every group present, every flag decided. */
export interface ResolvedChatbotConfig {
    labels: ChatLabels;
    icons: ChatIcons;
    header: Required<Omit<HeaderConfig, 'brand' | 'actions' | 'views' | 'allowedViews'>>
        & Pick<HeaderConfig, 'brand' | 'actions' | 'views' | 'allowedViews'>;
    composer: Required<Omit<ComposerConfig, 'onVoiceInput'>> & Pick<ComposerConfig, 'onVoiceInput'>;
    sidebar: Required<SidebarConfig>;
    greeting: GreetingConfig;
    suggestions: SuggestionItem[];
    quickActions: QuickActionItem[];
    featureCards: FeatureCardItem[];
}

/**
 * The library's own defaults. Deliberately neutral: no prompts, no feature
 * cards and no privacy claims, because those describe one host's product and
 * would ship to every other host that forgot to override them.
 */
export const DEFAULT_CHATBOT_CONFIG: ResolvedChatbotConfig = {
    labels: DEFAULT_LABELS,
    icons: DEFAULT_ICONS,
    header: {
        visible: true,
        menuItems: [],
        sidebarToggle: true,
        newChat: true,
        share: true,
        menu: true,
        switchView: true,
        copyConversationId: true,
        creditUsage: true,
        deleteConversation: true,
        close: true,
    },
    composer: {
        attachments: true,
        tools: true,
        density: 'auto',
        usage: true,
        usageDetails: true,
        disclaimer: true,
        mic: true,
    },
    sidebar: {
        enabled: true,
        newChat: true,
        items: [],
        starred: true,
        search: true,
        rename: true,
        deleteConversation: true,
    },
    greeting: { privacyBadges: [] },
    suggestions: [],
    quickActions: [],
    featureCards: [],
};

/** The keys a layer actually set; `undefined` means "keep what is beneath". */
function definedEntries<Group extends object>(group: Group | undefined): Partial<Group> {
    if (!group) return {};
    return Object.fromEntries(
        Object.entries(group).filter(([, value]) => value !== undefined)
    ) as Partial<Group>;
}

/**
 * Lay `layer` over `base`. Groups merge key by key; lists replace whole, so a
 * layer passing `quickActions: []` hides the pills rather than appending none.
 */
export function mergeChatbotConfig(base: ResolvedChatbotConfig, layer: ChatbotConfig | undefined): ResolvedChatbotConfig {
    if (!layer) return base;
    return {
        labels: { ...base.labels, ...definedEntries(layer.labels) },
        icons: { ...base.icons, ...definedEntries(layer.icons) },
        header: { ...base.header, ...definedEntries(layer.header) },
        composer: { ...base.composer, ...definedEntries(layer.composer) },
        sidebar: { ...base.sidebar, ...definedEntries(layer.sidebar) },
        greeting: { ...base.greeting, ...definedEntries(layer.greeting) },
        suggestions: layer.suggestions ?? base.suggestions,
        quickActions: layer.quickActions ?? base.quickActions,
        featureCards: layer.featureCards ?? base.featureCards,
    };
}

export function resolveChatbotConfig(layers: Array<ChatbotConfig | undefined>): ResolvedChatbotConfig {
    return layers.reduce<ResolvedChatbotConfig>(mergeChatbotConfig, DEFAULT_CHATBOT_CONFIG);
}
