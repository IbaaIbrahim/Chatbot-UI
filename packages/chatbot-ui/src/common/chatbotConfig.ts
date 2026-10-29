import type React from 'react';
import { DEFAULT_LABELS } from './labels';
import type { ChatLabelInputs, ChatLabels, ChatTranslations } from './labels';
import { canonicalLanguage, isUsableLabelValue, resolveLabels } from './i18n';
import { ChatIcons, DEFAULT_ICONS } from './icons';
import type { ChatMode } from '../components/ChatContainer/presentation';
import { isBlockRenderer } from './markdownBlocks';

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
    /**
     * The language the chat is in: a BCP 47 tag such as `'ar'`, `'de'` or
     * `'de-AT'`. It picks the labels from `translations` (falling back to the
     * base language, then to English), sets `lang` on the chat, and writes
     * numbers, dates, sizes and lists for that language. `_` is read as `-`
     * (`'pt_BR'` is `'pt-BR'`). Without it the chat shows `labels`, then
     * `translations.en`, then its English, and formats for the page's
     * `<html lang>`.
     * Change it at runtime — a new `config`, or a `useChatOverrides` layer —
     * and every label follows at once. Since 4.2.
     */
    language?: string;
    /**
     * Labels per language, each a partial map: `{ ar: { newChat: 'محادثة جديدة' }, de: { … } }`.
     * A key a language leaves out, or gives as `''`, shows its base language's,
     * then `translations.en`'s, then the library's English. `translations.en`
     * rewords the English. A later layer's text wins key by key; its `''`
     * leaves the layer beneath in force. Since 4.2; see
     * the README's "Internationalisation".
     */
    translations?: ChatTranslations;
    /**
     * Overrides that win in every language — what a host passed to translate
     * the chat before 4.2, and still the way to reword one key everywhere.
     * Keys left out show the translation for `language`, else English. The
     * deprecated 4.1 names (`creditsOne`, …) still fill their plural labels,
     * form by form, over the forms beneath them.
     */
    labels?: Partial<ChatLabelInputs>;
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
    /** Fenced code blocks the host draws itself — charts, tables, cards. See {@link MarkdownConfig}. */
    markdown?: MarkdownConfig;
}

/**
 * Fenced code blocks the host draws itself ("rich blocks", since 4.1).
 *
 * Generic on purpose: the library knows no chart. A host maps a fence's
 * language to a component, and every answer that contains such a fence shows
 * the component in its place — inline, beside the sentence that refers to it,
 * live while the answer streams and the same after a reload (the block is part
 * of the persisted message text). A language with no renderer stays an
 * ordinary code block, so a host without renderers degrades to readable JSON.
 */
export interface MarkdownConfig {
    /**
     * Keyed by the fence's language (```chart → `'chart'`). `null` in a layer
     * removes a renderer set beneath it — a screen that must not draw charts.
     *
     * Memoise the map, or define it at module level: its identity is compared
     * per layer, and a new one re-renders every answer.
     */
    blockRenderers?: Record<string, BlockRenderer | null>;
    /**
     * Takes over "Expand" — to show the block in a panel of the host's own, say.
     * Return `true` when handled; otherwise the library's overlay opens.
     */
    onExpandBlock?: (block: BlockDescriptor) => boolean;
}

/** How one fence language is drawn. */
export interface BlockRenderer {
    /**
     * A component, not a render function, so it can use hooks. Rendered only
     * once the fence is closed (or the answer ended without closing it), with
     * the fence's whole body — never a prefix of it. A renderer whose
     * `component` React cannot render is ignored with a warning.
     */
    component: React.ComponentType<BlockRenderProps>;
    /** Shown while the fence is still streaming. Default: the library's skeleton. */
    placeholder?: React.ComponentType<BlockPlaceholderProps>;
    /** Plain text replacing the fence in "Copy". Default: `[<label>: <title>]`. */
    toText?: (source: string) => string;
    /** Height (px) the skeleton reserves while streaming, so the transcript does not jump. Default 160. */
    minHeight?: number;
    /** The word the skeleton and the fallback use ("chart", "table"). Default: the language. */
    label?: string;
    /** Draw the library's frame: border, title, toolbar, expand, error fallback. Default `true`. */
    frame?: boolean;
}

/** Which block, independent of how it is shown. */
export interface BlockDescriptor {
    language: string;
    /** The fence's body. */
    source: string;
    /** The info string after the language (```chart wide → `'wide'`), or `null`. */
    meta: string | null;
    /** `fnv1a(language + '\n' + source)`: the same live and after a reload. */
    blockKey: string;
    /** The message the block is in. */
    messageId: string;
}

/** What a block's component is given. */
export interface BlockRenderProps extends BlockDescriptor {
    /**
     * The turn is still in flight, so a reference to one of its steps may not
     * have a result yet: wait rather than fail.
     */
    streaming: boolean;
    /** Rendering inside the expanded overlay. */
    expanded: boolean;
    /**
     * The width the component can draw in, in px: the block body's content
     * box, inside its padding — the same box on the first measurement and on
     * every later one. Kept current as the chat resizes; `0` until measured.
     */
    width: number;
    /** Resolved: a `'system'` chat reports what the OS chose. */
    theme: 'light' | 'dark';
    /** The direction of the text around the block. */
    direction: 'ltr' | 'rtl';
    /** `floating`, `sidebar` (docked) or `fullscreen`. */
    mode: ChatMode;
    /**
     * The job (turn) that produced this message — what a host saves the block
     * against (`useChatActions().saveArtifact(jobUuid, …)`). `null` while a live
     * turn has not reported its job yet, and for a message that has none.
     */
    jobUuid: string | null;
    /** The conversation the message belongs to, or `null` before it has one. */
    conversationId: string | null;
    /** All text of this message, for a block that exports its siblings (a report). */
    getMessageSource: () => string;
    /**
     * The block's toolbar contributions (download, save, refresh…). The library
     * adds Expand and "Copy source" itself. Calling it again with the same ids,
     * labels and states changes nothing, so it is safe in an effect.
     */
    setActions: (actions: BlockAction[]) => void;
    /** The title shown in the frame's header; `null` shows none. */
    setTitle: (title: string | null) => void;
    openExpanded: () => void;
    /** Switch to the library's fallback with this reason; the source stays viewable. */
    fail: (reason: string) => void;
}

/** What a block's placeholder is given while its fence streams. */
export interface BlockPlaceholderProps {
    language: string;
    /** The body so far. */
    partialSource: string;
    label: string;
}

/** One entry in a block's toolbar. */
export interface BlockAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    /**
     * `element` is the block's frame (title, body); `messageElement` the whole
     * message it sits in, for an action over the answer (a report's export).
     */
    run: (ctx: { element: HTMLElement; messageElement: HTMLElement | null }) => void | Promise<void>;
    /**
     * `'menu'` (the default) lists it under "More"; `'toolbar'` shows it as a
     * button in the header — its `icon` when it has one, its label otherwise.
     * Keep the toolbar to one or two: the chat can be 330px wide.
     */
    placement?: 'toolbar' | 'menu';
    /** Shown but not clickable — "Saved", say. */
    disabled?: boolean;
}

/** @deprecated Renamed to {@link ChatbotConfig} in 3.0. */
export type ChatbotUIConfig = ChatbotConfig;

/** Which parts of "Memory & instructions" the dialog shows (`header.standingContext`, since 4.5). */
export interface StandingContextOptions {
    /** The user's own instructions and memories, which they add, change and delete. Default `true`. */
    personal?: boolean;
    /** Their organisation's (the tenant's) entries in force, read-only. Default `true`. */
    workspace?: boolean;
}

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
     * The "Memory & instructions" entry (since 4.4, ADR-021): the user's own
     * standing instructions and memories, and their organisation's to read.
     * Shown only when the client can reach them (`GatewayStreamClient`).
     * Since 4.5, `{ personal, workspace }` chooses which of the two the dialog
     * shows — a part left out stays on — for a host that manages one of them
     * on its own screens; with both off the entry is hidden, as with `false`.
     */
    standingContext?: boolean | StandingContextOptions;
    /**
     * "Delete thread" in the menu, for the open conversation. On by default
     * since the Gateway serves `DELETE /v1/user/conversations/{id}`; a client
     * without `deleteConversation` refuses, and nothing is removed on screen.
     */
    deleteConversation?: boolean;
    /**
     * The "Conversation files" button: every file of the open conversation —
     * the user's uploads, files the app generated, saved artifacts — with
     * preview and download. Shown only while a conversation is open and the
     * provider has a `storageApiUrl` and an `accessToken`.
     */
    files?: boolean;
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
    /**
     * The credit notice above the composer, and the send button it disables
     * while the user is out of credits. The allowance is read when the chat
     * opens and after every turn — only when the client can read it
     * (`GatewayStreamClient`). `false` neither reads it nor disables sending:
     * the Gateway still refuses a job it cannot admit. On by default. Since 4.3.
     */
    creditAlerts?: boolean;
    /**
     * Percentages of the user's own allowance used at which the notice warns,
     * e.g. `[75, 90]`. The highest one passed is shown; closing it keeps it
     * closed until the chat is next opened, or until the next threshold is
     * passed. `[]` warns only once the user is out. Defaults to `[90]`. Since 4.3.
     */
    creditWarningThresholds?: number[];
}

export interface SidebarConfig {
    /** `false` removes the sidebar and its toggle entirely. */
    enabled?: boolean;
    newChat?: boolean;
    /**
     * The "Artifacts" entry under "New chat": everything the user saved, from
     * every conversation, to search, preview, download and delete. Shown only
     * while the provider has a `storageApiUrl` and an `accessToken`.
     */
    artifacts?: boolean;
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
    /** Every label for `language`, resolved: see `resolveLabels`. */
    labels: ChatLabels;
    /** The language in force, as the last layer that set one gave it (canonical: `'ru_RU'` → `'ru-RU'`); `undefined` when none did. */
    language: string | undefined;
    /**
     * Every layer's `translations`, in layer order (the last wins). Kept apart
     * rather than merged, so resolution reads each layer as a source of its
     * own: a later layer's text wins key by key, its empty value leaves the
     * one beneath in force, and its deprecated 4.1 names patch the forms
     * beneath them (`resolveLabels`).
     */
    translationLayers: readonly ChatTranslations[];
    /** Every layer's `labels`, in layer order, read the same way. */
    labelLayers: readonly Partial<ChatLabelInputs>[];
    icons: ChatIcons;
    header: Required<Omit<HeaderConfig, 'brand' | 'actions' | 'views' | 'allowedViews'>>
        & Pick<HeaderConfig, 'brand' | 'actions' | 'views' | 'allowedViews'>;
    composer: Required<Omit<ComposerConfig, 'onVoiceInput'>> & Pick<ComposerConfig, 'onVoiceInput'>;
    sidebar: Required<SidebarConfig>;
    greeting: GreetingConfig;
    suggestions: SuggestionItem[];
    quickActions: QuickActionItem[];
    featureCards: FeatureCardItem[];
    markdown: ResolvedMarkdownConfig;
}

/** {@link MarkdownConfig} with every layer applied and the removed renderers gone. */
export interface ResolvedMarkdownConfig {
    /**
     * Only renderers the chat can draw, in a map **without a prototype**: a
     * fence's language is text from the answer, and ` ```constructor ` must
     * not find `Object.prototype.constructor`. Read it by key, with
     * `Object.keys`, or with `rendererFor(map, language)` — not with
     * `map.hasOwnProperty(…)`, which it does not have.
     */
    blockRenderers: Record<string, BlockRenderer>;
    onExpandBlock?: (block: BlockDescriptor) => boolean;
}

/** A renderer map with no prototype, so no language finds an inherited member. */
function emptyRendererMap(): Record<string, BlockRenderer> {
    return Object.create(null) as Record<string, BlockRenderer>;
}

/**
 * The library's own defaults. Deliberately neutral: no prompts, no feature
 * cards and no privacy claims, because those describe one host's product and
 * would ship to every other host that forgot to override them.
 */
export const DEFAULT_CHATBOT_CONFIG: ResolvedChatbotConfig = {
    labels: DEFAULT_LABELS,
    language: undefined,
    translationLayers: [],
    labelLayers: [],
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
        standingContext: true,
        deleteConversation: true,
        files: true,
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
        creditAlerts: true,
        creditWarningThresholds: [90],
    },
    sidebar: {
        enabled: true,
        newChat: true,
        artifacts: true,
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
    markdown: { blockRenderers: Object.freeze(emptyRendererMap()) },
};

/**
 * Lay one layer's `markdown` over the one beneath: renderers merge by
 * language, and a `null` removes the language's renderer.
 *
 * A layer that says nothing about renderers keeps the map beneath it *as the
 * same object*. Its identity is what an answer's blocks are memoised on, so a
 * screen's layer that only changes labels must not re-render every chart.
 *
 * The merged map has no prototype (see {@link ResolvedMarkdownConfig}), and a
 * renderer React cannot draw — no `component`, or one that is not a component
 * — is left out with a warning, keeping whatever the layer beneath set for
 * that language. Drawn, it would throw while its error boundary is being
 * reconciled, where no boundary of the chat's can catch it.
 */
function mergeMarkdown(base: ResolvedMarkdownConfig, layer: MarkdownConfig | undefined): ResolvedMarkdownConfig {
    if (!layer) return base;
    let blockRenderers = base.blockRenderers;
    if (layer.blockRenderers) {
        blockRenderers = Object.assign(emptyRendererMap(), base.blockRenderers);
        for (const [language, renderer] of Object.entries(layer.blockRenderers)) {
            if (renderer === null) {
                delete blockRenderers[language];
            } else if (renderer === undefined) {
                // Not set: what is beneath stays.
            } else if (isBlockRenderer(renderer)) {
                blockRenderers[language] = renderer;
            } else {
                console.warn(
                    `[chatbot-ui] config.markdown.blockRenderers['${language}'] has no component React can render; `
                    + 'it is ignored, and the fence is drawn as before.'
                );
            }
        }
    }
    const onExpandBlock = layer.onExpandBlock ?? base.onExpandBlock;
    if (blockRenderers === base.blockRenderers && onExpandBlock === base.onExpandBlock) return base;
    return onExpandBlock ? { blockRenderers, onExpandBlock } : { blockRenderers };
}

/** The keys a layer actually set; `undefined` means "keep what is beneath". */
function definedEntries<Group extends object>(group: Group | undefined): Partial<Group> {
    if (!group) return {};
    return Object.fromEntries(
        Object.entries(group).filter(([, value]) => value !== undefined)
    ) as Partial<Group>;
}

/** Whether a layer's map says anything resolution can use: an empty map, or one of empty values only, says nothing. */
function hasUsableLabels(labels: object | null | undefined): boolean {
    return Boolean(labels) && Object.values(labels as object).some(isUsableLabelValue);
}

function hasUsableTranslations(translations: ChatTranslations | null | undefined): boolean {
    return Boolean(translations) && Object.values(translations as ChatTranslations).some(hasUsableLabels);
}

/**
 * Lay `layer` over `base`. Groups merge key by key; lists replace whole, so a
 * layer passing `quickActions: []` hides the pills rather than appending none.
 *
 * The labels are resolved again — for the language in force, over every
 * layer's translations and overrides — only when the layer says something
 * about them; otherwise they stay the same object.
 */
export function mergeChatbotConfig(base: ResolvedChatbotConfig, layer: ChatbotConfig | undefined): ResolvedChatbotConfig {
    if (!layer) return base;
    // An empty tag is no language: a host whose own has not loaded yet keeps the one beneath.
    const language = canonicalLanguage(layer.language) ?? base.language;
    const translationLayers = hasUsableTranslations(layer.translations)
        ? [...base.translationLayers, layer.translations as ChatTranslations]
        : base.translationLayers;
    const labelLayers = hasUsableLabels(layer.labels)
        ? [...base.labelLayers, layer.labels as Partial<ChatLabelInputs>]
        : base.labelLayers;
    const labelsChanged = language !== base.language
        || translationLayers !== base.translationLayers
        || labelLayers !== base.labelLayers;
    return {
        labels: labelsChanged ? resolveLabels(language, translationLayers, labelLayers) : base.labels,
        language,
        translationLayers,
        labelLayers,
        icons: { ...base.icons, ...definedEntries(layer.icons) },
        header: { ...base.header, ...definedEntries(layer.header) },
        composer: { ...base.composer, ...definedEntries(layer.composer) },
        sidebar: { ...base.sidebar, ...definedEntries(layer.sidebar) },
        greeting: { ...base.greeting, ...definedEntries(layer.greeting) },
        suggestions: layer.suggestions ?? base.suggestions,
        quickActions: layer.quickActions ?? base.quickActions,
        featureCards: layer.featureCards ?? base.featureCards,
        markdown: mergeMarkdown(base.markdown, layer.markdown),
    };
}

export function resolveChatbotConfig(layers: Array<ChatbotConfig | undefined>): ResolvedChatbotConfig {
    return layers.reduce<ResolvedChatbotConfig>(mergeChatbotConfig, DEFAULT_CHATBOT_CONFIG);
}
