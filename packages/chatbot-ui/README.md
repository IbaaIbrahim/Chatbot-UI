# iocloud-chatbot-library

React chat UI for the AI-EcoSystem gateway. Streams a run over SSE, renders the
agent's steps, and lets the host application take part in tool calls.

Works with React 17 and 18. State is published through an external store read
with `use-sync-external-store`, so a component re-renders when the slice it reads
changes — not on every streamed token.

- [One provider, anywhere in the app](#one-provider-anywhere-in-the-app)
- [Reading state: `useChatState`](#reading-state-usechatstate)
- [Acting: `useChatActions`](#acting-usechatactions)
- [Reacting: `useChatEvent`](#reacting-usechatevent)
- [Open and sidebar](#open-and-sidebar-own-the-state-or-let-the-chat-keep-it)
- [Provider props](#provider-props)
- [Placement: `ChatApp` and `ChatContainer`](#placement-chatapp-and-chatcontainer)
- [Configuration](#configuration)
- [Changing the chat on one screen: `useChatOverrides`](#changing-the-chat-on-one-screen-usechatoverrides)
- [The conversation sidebar](#the-conversation-sidebar)
- [What the Gateway must serve](#what-the-gateway-must-serve)
- [Your own layout](#your-own-layout)
- [The `agents` prop](#the-agents-prop)
- [The `tools` prop](#the-tools-prop)
- [Theming](#theming)
- [Developing against a linked host](#developing-against-a-linked-host)
- [Migrating from 2.x](#migrating-from-2x)
- [Migrating from 1.x](#migrating-from-1x)

## One provider, anywhere in the app

Mount `ChatbotProvider` once, high enough that every part of the host that wants
to drive the chat is inside it. Everything below it — the chat's own widgets and
the host's components alike — reads and acts on the same chat:

```tsx
import { ChatbotProvider, ChatApp, useChatActions, useChatState } from 'iocloud-chatbot-library';

<ChatbotProvider client={client} tools={tools} config={config} open={open} onOpenChange={setOpen}>
  <MyApp />          {/* any screen can drive the chat */}
  <ChatApp mode="sidebar" theme="light" />   {/* draws it; portals are fine */}
</ChatbotProvider>

// Anywhere under the provider
function SummarizeButton() {
  const chat = useChatActions();                          // stable for the provider's lifetime
  const busy = useChatState(s => s.isThinking);          // re-renders only when this changes
  return <button disabled={busy} onClick={() => { chat.open(); void chat.sendMessage('Summarize this page'); }}>Ask AI</button>;
}
```

`ChatApp` with no provider above it creates one from its own props, which is all a
single-screen host needs. Under a provider it uses that one and ignores provider
props, with a console warning naming them.

React context follows the component tree, not the DOM, so a `ChatApp` rendered
through a portal still finds a provider mounted above the portal's owner.

| Hook | What it is for |
| --- | --- |
| `useChatState(selector, isEqual?)` | Read any slice. A component re-renders only when its slice changes. |
| `useChatActions()` | Do anything the chat can do. Every function keeps its identity and acts on the current state. |
| `useChatEvent(type, handler)` | React to a moment rather than render a state. Unsubscribes on unmount. |
| `useChatOverrides(layer)` | Change the configuration while one screen is mounted; withdrawn on unmount. |
| `useChatConfig()`, `useLabels()`, `useIcons()` | The configuration in force, with every layer applied. `useLabels`/`useIcons` also work outside a provider (they return the defaults). |
| `useAuthenticatedFetch()` | A stable function that fetches a storage-API URL with the session's token and returns a blob URL, or `null` outside a provider. |

Every hook except `useLabels`, `useIcons` and `useAuthenticatedFetch` throws when
there is no provider above it.

## Reading state: `useChatState`

```ts
const sidebarOpen = useChatState(s => s.isSidebarOpen);
const { isThinking, isStopping } = useChatState(
  s => ({ isThinking: s.isThinking, isStopping: s.isStopping }),
  shallowEqual,                       // the selector builds a new object each time
);
```

Select the smallest value you need. A selector that returns a new object on every
call re-renders on every change unless it is paired with an equality function;
`shallowEqual` (exported) covers the usual case.

| Field | What it holds |
| --- | --- |
| `client`, `storageApiUrl`, `accessToken`, `userName` | The session, as the provider was given it. |
| `config` | The configuration in force, every override layer applied. |
| `isOpen`, `isSidebarOpen` | Presence. |
| `hostHandlesOpenChange`, `canSwitchMode`, `canShare`, `canStop` | Whether the provider has `onOpenChange` / `onSwitchMode` / `onShare`, and whether the client can cancel a turn on the server. |
| `canShowCredits`, `isCreditUsageOpen` | Whether the client can read the user's own allowance, and whether the "Credit usage" dialog is open. |
| `messages` | The transcript. Changes on every streamed token — read it only where you draw it. |
| `isThinking`, `isResuming`, `isStopping` | The turn in progress. |
| `usageSummary` | The consumption figures the usage ring shows. |
| `pendingQuestions` | The questions an `ask_user_questions` call is waiting on, or `null`. |
| `staleClientCall` | The open turn waits on a client tool this page can no longer answer. |
| `activeConversationId` | The conversation on screen, or `null` for a new one. |
| `conversations`, `starredConversations` | Recents (the unstarred ones when starring is supported) and Starred. |
| `starringSupported` | The Gateway reports `starred_at`, so a star will persist. |
| `isLoadingConversations`, `isLoadingMore`, `hasMore` | The list's paging. |
| `search` | `{ query, results, isSearching }` — the active search, if any. |
| `registeredTools`, `enablableTools`, `enabledToolIds`, `handledToolSlugs` | Tools: the host's handlers, the user-switchable tools and which are on. |
| `agents`, `agentId`, `agentsLoading` | The agent list and the selection. |

## Acting: `useChatActions`

The object and its functions keep their identity for the provider's lifetime, so
they are safe in dependency arrays and event handlers, and there is no stale
closure to capture: every call acts on the current state.

| Action | Does |
| --- | --- |
| `open()`, `close()`, `toggleOpen()` | Opens or closes the chat. With a controlled `open`, asks `onOpenChange` instead. |
| `openSidebar()`, `closeSidebar()`, `toggleSidebar()` | The same for the conversation sidebar. |
| `switchMode(mode)` | Calls the provider's `onSwitchMode`. |
| `share()` | Calls the provider's `onShare`. |
| `openCreditUsage()`, `closeCreditUsage()` | The "Credit usage" dialog — see [Credit usage](#credit-usage). |
| `sendMessage(text, attachedFiles?)` | Sends a message in the active conversation (a new one when none is active). |
| `stopTurn()`, `retryTurn()`, `continueTurn()` | The turn in progress or the one that failed. |
| `confirmApproval(uuid)`, `rejectApproval(uuid)` | Answers a held tool call. |
| `submitQuestionnaire(formattedAnswers)` | Answers an `ask_user_questions` call. |
| `newChat()` | Starts a new conversation. |
| `selectConversation(id)` | Loads a conversation; resolves to `false` if it could not. |
| `deleteConversation(id)` | Rejects when the server refuses, and then removes nothing. |
| `setConversationStarred(id, starred)` | Moves the conversation between Starred and Recents at once, and back if the server refuses. |
| `searchConversations(query)` | Searches on the server; an empty query ends the search. |
| `refreshConversations()`, `loadMoreConversations()` | The list. |
| `copyConversationId()` | Copies the active conversation's id. |
| `setAgentId(id \| null)` | Selects an agent (`null` = Auto). Calls `onAgentChange`. |
| `setEnabledToolIds(ids)` | Switches user-enablable tools on or off. |
| `focusComposer()` | Focuses the composer, unless the user is already typing somewhere. |
| `setComposerText(text)` | Replaces the composer's text and focuses it — to prefill a prompt from a page button. |

## Reacting: `useChatEvent`

```ts
useChatEvent('sidebar.opened', () => analytics.track('chat_sidebar_opened'));
useChatEvent('message.sent', ({ text }) => console.log('sent', text));
```

The latest `handler` is always the one called, so it need not be memoised. A
handler that throws is reported and skipped; it cannot stop the action or the
other handlers.

| Event | Payload | Fires when |
| --- | --- | --- |
| `chat.opened`, `chat.closed` | — | `isOpen` changes, whoever changed it (an action or a controlled prop). |
| `sidebar.opened`, `sidebar.closed` | — | `isSidebarOpen` changes, the same way. |
| `message.sent` | `{ text }` | `sendMessage` is called. |
| `conversation.created` | — | `newChat` is called. |
| `conversation.selected` | `{ conversationId }` | A conversation was loaded. |
| `conversation.starred` | `{ conversationId, starred }` | The server accepted a star or unstar. |
| `conversation.deleted` | `{ conversationId }` | The server accepted a delete. |

Use `useChatState` to render the current value of something, and `useChatEvent` to
react to the moment it happens.

### Open and sidebar: own the state or let the chat keep it

Both follow the controlled/uncontrolled convention:

- `open` / `defaultOpen` / `onOpenChange`
- `sidebarOpen` / `defaultSidebarOpen` / `onSidebarOpenChange`

Omit `open` and the chat keeps its own state. Pass it to own the state, for
example a host that persists it, or that must navigate when the chat closes.
`onOpenChange` hears every request either way, including `useChatActions().close()`
from anywhere in the app, so the host stays the single source of truth.

To run your own code *as well as* the default, listen with `onSidebarOpenChange`
or `useChatEvent('sidebar.opened', …)`. To *replace* the default, control
`sidebarOpen` yourself.

## Provider props

| Prop | Default | Meaning |
| --- | --- | --- |
| `client` | — | A `GatewayStreamClient` (or any `StreamChatClient`). |
| `streamUrl`, `streamHeaders` | — | Builds a plain `StreamClient` when no `client` is given. |
| `storageApiUrl`, `accessToken` | `''`, `null` | Attachments and authenticated images. |
| `userName` | `'User'` | Fills `{name}` in the greeting. |
| `agents`, `agentId`, `agentsLoading`, `onAgentChange` | — | See [The `agents` prop](#the-agents-prop). Omit `agentId` to let the chat keep the selection. |
| `tools` | — | See [The `tools` prop](#the-tools-prop). |
| `config` | — | See [Configuration](#configuration). Memoise it. |
| `open`, `defaultOpen`, `onOpenChange` | uncontrolled, `true` | Presence. |
| `sidebarOpen`, `defaultSidebarOpen`, `onSidebarOpenChange` | uncontrolled, `false` | The conversation sidebar. |
| `onSwitchMode` | — | Enables the built-in "Switch view" entry (see [Views](#views-the-switch-view-entry)). |
| `onShare` | — | Enables the header's share button. |
| `onEvent` | — | Every raw stream event, for hosts that need more than the hooks. |
| `allowLocalNetworkAccess` | `false` | See [`LOCAL_NETWORK_ACCESS.md`](LOCAL_NETWORK_ACCESS.md). |

## Placement: `ChatApp` and `ChatContainer`

Where and how the chat is drawn belongs to the rendering, not to the chat: the
same conversation can be floating on one screen and fullscreen on another.

| Prop | `ChatApp` default | `ChatContainer` default | Meaning |
| --- | --- | --- | --- |
| `mode` | `'fullscreen'` | `'floating'` | `'floating'` (corner card), `'sidebar'` (panel at the edge) or `'fullscreen'`. |
| `allowedModes` | all three | all three | The modes the built-in "Switch view" entry lists. `mode` falls back to the first when it is not among them. |
| `theme` | `'system'` | `'system'` | `'light'`, `'dark'`, or `'system'` (follows the OS). |
| `embedded` | `false` | `false` | A flex child of the host's layout rather than a fixed overlay. |
| `noBackground` | `false` | `false` | No frame or background, for native embedding. |

`ChatContainer` also takes slots: `header` (defaults to `<ChatHeader />`, `null`
removes it), `sidebar` (defaults to `<ConversationSidebar />`, `null` removes it),
`footer` (usually the composer) and `children` (the transcript, defaults to
`<MainChat />`; anything else must scroll itself).

A closed floating chat that is not embedded renders its launcher button, which
reopens it. In fullscreen on a screen at least 960px wide the sidebar is a column
beside the transcript; everywhere else it is an overlay that closes on Escape and
after a pick.

## Configuration

One typed object on the provider, `config: ChatbotConfig`. Every group is
partial, and what a layer leaves out keeps the value beneath it. The layers stack
in this order: library defaults, then the provider's `config`, then each
`useChatOverrides` layer.

```tsx
const config: ChatbotConfig = {
  labels: { newChat: 'Neuer Chat', starred: 'Markiert' },   // every string; see DEFAULT_LABELS
  icons: { sidebarToggle: <MyPanelIcon /> },                // every icon; see DEFAULT_ICONS
  header: { close: false, switchView: false, actions: <MyHeaderButtons />, menuItems: [...] },
  composer: { mic: true, onVoiceInput: startDictation, agentSwitcher: false },
  sidebar: { items: [{ id: 'artifacts', label: 'Artifacts', icon: <Box />, onSelect: openArtifacts }] },
  greeting: { title: 'Hi {name}, what are we doing today?' },
  suggestions: [...], quickActions: [...], featureCards: [...],
};
```

- **Visibility flags only hide.** A control also needs something to do, and it
  renders only when it has both — the tables below say what each one needs. No
  flag can conjure a button that does nothing.
- **Lists replace rather than merge**, in every layer: `quickActions: [...]` is the
  whole set, and `featureCards: []` removes the cards. Groups (`header`,
  `composer`, …) merge key by key.
- **Memoise the object** (or define it at module level). A new `config` on every
  render re-renders everything that reads it.

### `header`

| Key | Default | Shows when |
| --- | --- | --- |
| `visible` | `true` | `false` removes the whole bar. |
| `brand` | icon + `labels.brandTitle` | Any React node replaces it; `false` removes it. |
| `actions` | — | Host controls, before the built-in buttons. `null` in a layer removes them. |
| `menuItems` | `[]` | Extra menu entries: `{ id, label, icon?, onSelect, danger? }`. |
| `sidebarToggle` | `true` | `sidebar.enabled`; hidden while the inline sidebar is open (it has its own collapse button). |
| `newChat` | `true` | The conversation has messages. |
| `share` | `true` | The provider has `onShare`. |
| `menu` | `true` | The menu has at least one entry. |
| `switchView` | `true` | A view other than the one in effect — see [Views](#views-the-switch-view-entry). |
| `views`, `allowedViews` | — | See [Views](#views-the-switch-view-entry). |
| `creditUsage` | `true` | The client can read the allowance (`GatewayStreamClient`) — see [Credit usage](#credit-usage). |
| `copyConversationId` | `true` | A conversation is active. |
| `deleteConversation` | `false` | A conversation is active, **and** the Gateway serves `DELETE /v1/user/conversations/{id}` — it does not today. |
| `close` | `true` | The provider has `onOpenChange`, or the chat is floating and not embedded (its launcher can reopen it). |

### Views: the "Switch view" entry

One entry at the top of the header's menu, `labels.switchView` with
`icons.switchView`. Choosing it opens the views right beneath it, inside the
menu, the one in effect ticked (`icons.check`); choosing another applies it and
closes the menu. A submenu beside the menu would run out of room in a narrow
floating panel, and an entry per view made the menu as long as the list. The
entry shows only while there is a view other than the one in effect, and a
divider follows it when the menu has other entries.

- **Built in:** without `header.views`, the views are the container's
  `allowedModes`, labelled `labels.viewFloating` / `viewSidebar` /
  `viewFullscreen` with the icons of the same names. Choosing one calls the
  provider's `onSwitchMode(mode)`, which must exist.
- **The host's own:** a host whose placements are not the library's three passes
  `header.views` — every view, the one in effect included — and the library lists
  exactly those:

  ```ts
  interface ChatViewOption {
    id: string;              // the host's own id
    label: string;           // the view's name: "Docked panel"
    icon?: React.ReactNode;
    active?: boolean;        // the view in effect; ticked in the list
    onSelect: () => void;    // the host applies it — or navigates, for a page
  }
  ```

  A view can be a route rather than a placement: Flowdit lists its `/ai` page as
  "Full page", whose `onSelect` navigates there.
- **Narrowing and hiding:** `header.allowedViews: ['floating', 'sidebar']` keeps
  only those ids (of either kind), and `header.switchView: false` removes the
  entry — both usually from one screen's [override
  layer](#changing-the-chat-on-one-screen-usechatoverrides).

### Credit usage

A menu entry, `labels.creditUsage` with `icons.creditUsage`, opens a dialog over
the chat with the signed-in user's **own** allowance, read afresh from
`GET /v1/user/credits` each time it opens: the credits left, a meter of used
against granted, the date it lasts until, and one row per grant when a plan
allowance has top-ups beside it. A user with no allowance of their own sees "No
personal limit" and what their work was charged this month. When a request could
not start now, a sentence says whose limit stops it — theirs, their
organisation's, the provider account's, or no plan — and never the
organisation's or the provider's figures, which the Gateway does not send.

- Shown when `header.creditUsage` is on (the default) and the client can read the
  allowance (`canShowCredits`: `GatewayStreamClient`'s `getCredits()`). A
  Gateway without the route answers 404, and the dialog says the feature is not
  available there rather than offering a retry.
- Open it from anywhere with `useChatActions().openCreditUsage()`;
  `closeCreditUsage()`, Escape, the close button or a click outside close it.
- `ChatContainer` renders the dialog. A host with its own layout renders
  `<CreditUsageDialog />` once, inside a positioned element it should cover.
- The figures come back as `UserCredits` — read them without the dialog through
  `useChatRuntime().services.fetchCredits()` or `ConversationClient.getCredits()`.
- Its text is the `credits*` and `creditGrant*` labels.

### `composer`

| Key | Default | Shows when |
| --- | --- | --- |
| `attachments` | `true` | The attach button; uploading needs `storageApiUrl` and `accessToken`. |
| `tools` | `true` | The tools menu, when the agent has user-switchable tools. `false` also skips fetching them. |
| `agentSwitcher` | `true` | There are `agents`. |
| `bottomSection` | `true` | Where the agent switcher sits: the strip under the input when comfortable, the start of the footer line when compact. `false` removes it from both. |
| `density` | `'auto'` | Not a control: how much room the composer takes — see below. |
| `usage` | `true` | The consumption ring under the composer. |
| `disclaimer` | `true` | "Uses AI. Verify results." (`labels.disclaimer`). |
| `mic` | `true` | `onVoiceInput` is set — the library records no audio itself. |
| `onVoiceInput` | — | Called by the mic button. |

**Density.** `'comfortable'` is the roomy box: the text above a row of buttons,
the agent switcher in a strip underneath. `'compact'` is a single 48px row —
attach and tools on the left, mic and send on the right, the text between them —
with the agent switcher moved to the start of the footer line, beside the
disclaimer and the usage ring. `'auto'`, the default, is comfortable while the
conversation is empty, where the composer is the page, and compact once it has
messages, where the height belongs to the transcript.

The input grows with its text up to 180px and keeps one row while empty: it is
never sized by its placeholder, and it re-fits when its width changes. A compact
composer gives the text the full width, buttons on a row beneath, once the text
needs a second line, and keeps that layout until the box is emptied — switching
back as soon as the text fit again would re-wrap it at the narrower width and
flip straight back.

```tsx
// A screen with little height to spare: compact even before the first message.
useChatOverrides({ composer: { density: 'compact' } });
```

**The questionnaire** an `ask_user_questions` call raises sits above the
composer, the same width as its box. Choices are chips that wrap, so short
answers share a row; a single question has no pager; radios move with the arrow
keys; and Enter in its text fields answers — Shift+Enter is a new line — the way
it sends from the composer. While it waits, the composer stays, disabled, because
it holds the Stop button for the run that asked.

### `sidebar`

| Key | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false` removes the sidebar and its toggle. |
| `newChat` | `true` | The "New chat" entry. |
| `items` | `[]` | Navigation entries under "New chat": `{ id, label, icon?, onSelect, active?, badge? }` — an Artifacts or Tasks page, say. None by default. |
| `starred` | `true` | The Starred section; shown only while the Gateway reports `starred_at`. |
| `search` | `true` | The search box. |
| `deleteConversation` | `false` | A delete button per row; needs the Gateway's `DELETE` route. |

### Welcome content

What an empty conversation shows. None of it has defaults: 3.0 ships no prompts,
cards or privacy claims, because they describe one host's product. Choosing a
prompt sends it.

| Key | Where | Shape |
| --- | --- | --- |
| `greeting` | Every mode | `{ title?, privacyBadges? }`. `{name}` in the title is the provider's `userName`; the title defaults to `labels.greetingTitle`. A badge is `{ text, icon? }`, icon `lock` / `shield` / `check`. |
| `suggestions` | Compact (floating, sidebar) | `{ id, text, prompt?, icon? }`, icon `pin` / `clipboard` / `message` or any React node. |
| `quickActions` | Fullscreen | Pills: `{ id, label, prompt?, icon?, prompts? }`, icon `clock` / `pencil` / `bolt` / `sparkle` / `clipboard` / `message` / `help` or any React node. |
| `featureCards` | Fullscreen, under the pills | `{ id, title, description, badge?, icon?, image?, prompt? }`. `icon` (`globe`, `file`, `settings`, `shield`, `chart`, `slides`) also picks the card's illustration unless `image` is set. |

**A quick action with `prompts` is a category.** Its pill opens a list of those
prompts between the pills and the feature cards, which stay visible below. The
pill again, or Escape, closes it.

```tsx
quickActions: [{
  id: 'analyze', label: 'Analyze', icon: 'bolt',
  prompts: [
    { id: 'gaps', label: 'Show me compliance gaps across my sites' },
    { id: 'template', label: 'Show me how a template is performing', behavior: 'insert' },
  ],
}]
```

| Prompt key | Meaning |
| --- | --- |
| `id`, `label` | The row. |
| `prompt` | What is sent or inserted; the label when omitted. |
| `behavior` | `'send'` (default) sends it. `'insert'` puts it in the composer for the user to finish — for a prompt that needs a name, a date or a site first. |

### Labels

Every string the chat shows is a key of `ChatLabels`, with its English default in
`DEFAULT_LABELS`. Pass a partial map; keys you leave out keep the default.

- Placeholders are `{name}` style (`uploadingFiles: 'Uploading {count} file(s)…'`),
  so a label can come straight from a translation file. Fill your own with
  `formatLabel(template, values)`.
- Counts take one/other pairs — `creditsOne` / `creditsOther`, `stepsOne` /
  `stepsOther`, `turnsOne` / `turnsOther` — filled with
  `formatCount(count, one, other)`.
- A host that translates through its own message catalogue can map every key at
  once: `Object.keys(DEFAULT_LABELS)` is the full list, so
  `labels[key] = messages[`chat.${key}`] ?? DEFAULT_LABELS[key]` translates whatever
  the catalogue has and leaves the rest in English. Read the raw message rather
  than formatting it: the library fills its own placeholders, and a formatter such
  as IntlMessageFormat throws on a placeholder it was given no value for.

The keys, by area: header (`brandTitle`, `openSidebar`, `closeSidebar`, `newChat`,
`newChatTitle`, `share`, `moreOptions`, `switchView`, `viewFloating`,
`viewSidebar`, `viewFullscreen`, `creditUsage`, `copyConversationId`, `copiedConversationId`, `deleteThread`,
`closeChat`, `openChat`); sidebar (`sidebarTitle`, `collapseSidebar`,
`searchPlaceholder`, `starred`, `starredEmpty`, `recents`, `searchResults`,
`noSearchResults`, `star`, `unstar`, `deleteConversation`, `untitledConversation`,
`loadMore`, `loading`, `noHistoryTitle`, `noHistoryBody`, `today`, `yesterday`,
`previous7Days`, `older`); transcript (`scrollToLatest`, `staleClientCall`,
`greetingTitle`); composer (`composerPlaceholder`, `questionnairePlaceholder`,
`dropFiles`, `addAttachment`, `attachmentsUnavailable`, `removeAttachment`,
`uploadingFiles`, `unsupportedFileType`, `fileTooLarge`, `uploadNeedsStorageUrl`,
`uploadNeedsToken`, `uploadFailed`, `tools`, `voiceInput`, `send`,
`waitingForUploads`, `stop`, `stopping`, `disclaimer`); agents (`agentAuto`,
`selectAgent`, `switchAgent`); messages (`copy`, `copied`, `reply`, `edit`,
`retry`, `continue`, `thinking`, `thoughtBriefly`, `show`, `hide`, `toolCalling`,
`toolUsed`, `toolRunning`, `toolFailed`, `toolRan`, `openResult`, `openPreview`,
`toolArguments`, `toolResult`, `searchResultsHeading`, `previousVersion`,
`nextVersion`, `confirm`, `cancel`, `executingTool`, `confirmedExecuting`,
`cancelled`); attachment viewer (`close`, `closeAttachment`, `attachmentLoadFailed`,
`attachmentNoAuth`, `pdfLoadFailed`); questionnaire (`answerPlaceholder`,
`otherOption`, `customAnswerPlaceholder`, `previousQuestion`, `nextQuestion`,
`submit`, `submitted`); usage (`usageTitle`, `usageFootnote`, `usageUpdating`, `usageTrigger`,
`usageSummaryWithWindow`, `usageSummary`, `usageContextWindow`, `usageLimitUnknown`,
`usageLastPromptNote`, `usageSubAgentContext`, `usageLargestPrompt`,
`usageOwnContextNote`, `usageNearLimit`, `usageThisTurn`, `usageThisAgent`,
`usageSubAgents`, `usageWholeConversation`, `usageFreeCalls`, `usageWaived`,
`usageSubAgentTree`, `usageTreeLimitReached`, `usageTokens`, `creditsOne`,
`creditsOther`, `stepsOne`, `stepsOther`, `turnsOne`, `turnsOther`); credit usage
(`creditsLeftOne`, `creditsLeftOther`, `creditsUsedOfCap`, `creditGrantPlan`,
`creditGrantTopUp`, `creditGrantLeft`, `creditsValidUntil`, `creditsNoLimitTitle`,
`creditsNoLimitBody`, `creditsUsedThisMonth`, `creditsBlockedUser`,
`creditsBlockedOrganization`, `creditsBlockedProvider`, `creditsBlockedNoPlan`,
`creditsLoadFailed`, `creditsUnavailable`).

### Icons

Every built-in icon is a key of `ChatIcons`, with its default in `DEFAULT_ICONS`.
Values are plain React nodes — a font icon, an `<img>` or another icon library's
component — and the defaults are drawn with `currentColor`, so they follow the
theme.

`brand`, `launcher`, `sidebarToggle`, `sidebarCollapse`, `newChat`, `search`,
`star`, `starFilled`, `sectionCollapsed`, `sectionExpanded`, `promptRow`, `delete`,
`more`, `share`, `viewFloating`, `viewSidebar`, `viewFullscreen`, `switchView`,
`check`, `creditUsage`, `copy`, `close`, `attach`, `tools`, `mic`, `send`, `stop`,
`scrollDown`.

## Changing the chat on one screen: `useChatOverrides`

A screen lays its own configuration over the provider's for as long as it is
mounted, and the layer is withdrawn when it unmounts — no cleanup code, no state
left behind for the next screen:

| On this screen… | Layer |
| --- | --- |
| no close button | `{ header: { close: false } }` |
| no "Switch view" entry | `{ header: { switchView: false } }` |
| only some views | `{ header: { allowedViews: ['floating', 'sidebar'] } }` |
| no header controls of the host's | `{ header: { actions: null } }` |
| different quick-action pills, or categories | `{ quickActions: [...] }` |
| no quick-action pills | `{ quickActions: [] }` |
| different feature cards | `{ featureCards: [...] }` |
| no feature cards | `{ featureCards: [] }` |
| different compact suggestions | `{ suggestions: [...] }` |
| another composer placeholder | `{ labels: { composerPlaceholder: '…' } }` |
| no sidebar | `{ sidebar: { enabled: false } }` |
| no microphone, attachments or tools menu | `{ composer: { mic: false, attachments: false, tools: false } }` |

```tsx
// A module constant: the same object on every render.
const AUDIT_SCREEN_CHAT: ChatbotConfig = {
  header: { close: false, allowedViews: ['floating'] },
  featureCards: [],
};

function AuditScreen() {
  useChatOverrides(AUDIT_SCREEN_CHAT);

  // Translated content is built once with useMemo.
  const prompts = useMemo<ChatbotConfig>(() => ({
    quickActions: [{
      id: 'audit', label: t('audit.ai.category'), icon: 'bolt',
      prompts: [{ id: 'gaps', label: t('audit.ai.gaps') }],
    }],
  }), []);
  useChatOverrides(prompts);
  …
}
```

- Layers apply in the order they were first registered, over the provider's
  `config`.
- **Pass a stable object** — a module constant or a `useMemo` result. A layer equal
  to the one already registered is ignored, which keeps a literal of plain values
  cheap, but a literal holding elements or functions is new on every render and
  re-registers every render.
- A screen with a provider of its own (a separate chat) configures that provider
  directly; overrides affect the nearest provider above the caller.

## The conversation sidebar

New chat, then the host's `sidebar.items`, then **Starred** and **Recents**,
with search over all of them. Selecting from an overlay closes it; the
fullscreen column on a wide screen stays open.

- **Starred** appears only when the Gateway reports `starred_at` on its
  conversations (revision 009, `PATCH /v1/user/conversations/{id}`). On an
  older Gateway, starring could not persist, so it is not offered. A star moves
  the row at once and moves it back if the server refuses.
- **Search** asks the Gateway (`q`), which matches the stored title and anything
  the user wrote in the conversation — never a prompt one agent wrote for
  another. It is debounced (250ms). On a Gateway that predates search, the
  results are narrowed to matching titles on the client instead.
- **Recents** are grouped Today / Yesterday / Previous 7 days / Older and paged
  20 at a time.
- **Delete** is off (`sidebar.deleteConversation`, `header.deleteConversation`).
  The AI-EcoSystem Gateway serves no `DELETE /v1/user/conversations/{id}`, and a
  delete that cannot succeed must not be offered. When it can succeed, the row
  is removed only after the server accepts.

## What the Gateway must serve

What `GatewayStreamClient` calls, all under `/v1/user/` with the session's bearer
token:

| Call | Used for |
| --- | --- |
| `POST jobs`, then the job's stream URL, `POST jobs/{id}/stream-token` | Sending a message and streaming the turn; re-minting an expired stream token. |
| `POST jobs/{id}/cancel` | Stop. |
| `POST tools/jobs/{id}/tool-results`, `tool-approvals` | Answering a client tool call; approving or denying a held one. |
| `GET agents`, `GET tools/enablable` | The agent switcher and the tools menu. |
| `GET conversations?limit&offset&q&starred` | Recents, Starred and search. Items carry `starred_at` on a Gateway that supports starring. |
| `GET conversations/{id}` | Opening a conversation. |
| `PATCH conversations/{id}` `{ starred }` | Starring. |
| `GET credits` | The "Credit usage" dialog: the user's own allowance, this month's charges, and whether a job can start now. |
| `DELETE conversations/{id}` | Only when `deleteConversation` is enabled; not served by the AI-EcoSystem Gateway today. |

## Your own layout

The widgets (`ChatContainer`, `ChatHeader`, `ConversationSidebar`, `MainChat`,
`Composer`, `WelcomeScreen`) all read the provider, so any of them can be
placed alone. Put widgets that sit outside a `ChatContainer` inside `ChatRoot`,
which supplies the design tokens and theme without the frame:

```tsx
<ChatRoot theme="light">
  <Composer placeholder="Describe the checklist you need…" />
</ChatRoot>
```

| Component | Props |
| --- | --- |
| `ChatRoot` | `theme`, `mode` (default `'fullscreen'`: what the widgets inside lay themselves out for), `className`, `style` |
| `ChatHeader` | `className`, `style` |
| `ConversationSidebar` | `embedded` (a column the host placed: no collapse button, and a pick does not close it), `className`, `style` |
| `MainChat` | `emptyComposer` (centred under the greeting while empty), `className`, `style` |
| `WelcomeScreen` | `composer` |
| `Composer` | `disabled`, `placeholder`, `toolMenuPlacement` (`'above'` / `'center'`), `className` |
| `CreditUsageDialog` | none — draws itself while `isCreditUsageOpen`, covering its nearest positioned ancestor |

`Composer` keeps two per-instance overrides, `disabled` and `placeholder`.
Everything else it shows comes from the provider, so two composers on one page
agree. Its ref is a `ComposerHandle`: `focus()`, `setText(text)`,
`directToolCall(slug, input)`, `getAttachedFiles()`, `clearAttachedFiles()`. To
reach the mounted composer from anywhere, prefer `useChatActions().focusComposer()`
and `setComposerText(text)`.

## The `agents` prop

The agent list renders as a compact selector **under the composer**, not in the
sidebar. The drawer stays dedicated to conversation history (search on top,
date-grouped threads), so switching agents never costs a trip through a menu
that also lists chats.

```tsx
const [agents, setAgents] = useState<AgentSidebarItem[]>([]);

<ChatApp
  client={client}
  agents={agents.map(a => ({
    ...a,
    active: a.id === activeAgentId,
    onClick: () => setActiveAgentId(a.id),
  }))}
/>;
```

Each item's `onClick` is responsible for switching the active agent on the
client — the library never does it. When `agents` is empty or omitted, the
selector does not render and the header keeps the plain brand. The selector's
menu opens upward from the footer composer and downward in the empty fullscreen
state, where the composer sits mid-screen.

While the agent list is still loading pass `agentsLoading` (with `agents`)
rather than an empty array: an empty array renders no selector, but loading
state disables the composer until the first agent id arrives, so the first
message cannot go out agentless.

Memoise the list: it lands in the store, and a new array on every render
re-renders everything that reads it.

## The `tools` prop

Everything this application contributes to a tool goes in one entry, keyed by tool
slug: its handler, its schema if it has no backend row, and how its completed step
presents an action.

```tsx
<ChatApp
  client={client}
  tools={{
    // client-dispatched — handed the agent's tool_input; the return resumes the job
    read_page_context: {
      run: ({ scope }) => collectContext(scope),
      show: false,                     // nothing here a user would re-open
    },

    // server-dispatched (kafka/inline) — handed the worker's parsed tool_output
    generate_checklist: {
      preview: (checklist) => openChecklist(checklist),
      autoRun: false,                  // don't open it mid-turn
      placement: 'turn-end',           // offer the control once the turn is done
      render: ({ onAction, payload }) => (
        <button onClick={onAction}>Open “{payload.title}”</button>
      ),
    },

    // app-supplied — no backend row; the schema rides with each job
    query_customer_api: {
      run: ({ resource }) => fetchFromMyApi(resource),
      definition: {
        description: 'Look up records in this app\'s own customer API.',
        input_schema: { type: 'object', properties: { resource: { type: 'string' } } },
        requires_approval: true,
      },
    },
  }}
/>
```

### Which handler an entry carries

A tool call has two ends and a host application can only sit on one of them,
decided by the tool's `quota.tools.dispatch_mode`. The handler field is what says
which:

| | `run` | `preview` |
| --- | --- | --- |
| `dispatch_mode` | `client` | `kafka` / `inline` |
| SSE event | `client_tool_call` | `tool_result` |
| Receives | the agent's `tool_input` | the worker's `tool_output`, parsed |
| Return value | posted back to resume the suspended job | ignored |
| Fires on arrival | always — the job is waiting | unless `autoRun: false` |

**An entry carries one or the other, never both.** Writing both, or `autoRun` on a
`run` entry, or `definition` on a `preview` entry, is a type error. That is the
point: a `kafka` tool emits no `client_tool_call`, so a `run` registered for one
would simply never fire, and before these were one type that mistake compiled.

A `run` may return a Promise that resolves once the user has acted — that is how an
interactive tool works, and the job stays suspended until it settles. Returning
nothing acks the call with a `{ status: 'previewed' }` placeholder.

### Fields

| Field | Applies to | Default | Meaning |
| --- | --- | --- | --- |
| `run` | client tools | — | Executes the call. `(input, context) => result` |
| `preview` | server tools | — | Receives the output. `(output, context) => void` |
| `definition` | client tools | — | `{ description, input_schema, requires_approval? }`, advertised as a `client_tools` entry on each job. Omit for a backend-registered tool |
| `autoRun` | server tools | `true` | `false` makes the preview click-only |
| `show` | both | `true` | `false` offers no action control |
| `label` | both | `labels.openPreview` / `labels.openResult` | Button text. Ignored when `render` is given |
| `render` | both | — | Your own control instead of the built-in button. It gets `{ onAction, payload, result, toolName, label }`: `payload` is what `onAction` passes, `result` the call's parsed result once there is one — so a control for an action that already happened can offer its outcome (open the checklist an import saved) instead of running it again |
| `placement` | both | `'step'` | `'turn'` hoists the control out of a collapsed sub-agent block; `'turn-end'` also waits for the turn to finish |

`placement` governs the *button*. To stop a preview opening itself the moment the
result lands, pair it with `autoRun: false` — including on a reload, where the
once-per-step guard cannot survive the page load.

### Imperatively

The same map can be set on the client instead of passed as a prop:

```ts
client.setTools({ generate_checklist: { preview: openChecklist } });
```

## Theming

All colour, spacing, radius, shadow and motion values are design tokens
(`--cb-*`) in [`src/styles.css`](src/styles.css), scoped to `.cb-chat-container`,
`.cb-chat-launcher` and `.cb-root` so nothing leaks into the host. The `theme`
prop sets `data-theme` on those roots; `'system'` sets nothing and follows the OS.
Only the tokens change per theme, so a component styled from tokens works in
both.

The tokens carry `!important` so that a host's CSS reset cannot repaint the
widget. To restyle it on purpose, redefine tokens with `!important` from a more
specific selector:

```css
.my-app .cb-chat-container,
.my-app .cb-root {
  --cb-accent-primary: #0f766e !important;
}
```

The stylesheet is injected by the JavaScript bundle; there is no separate CSS file
to import.

## Developing against a linked host

```bash
# the library
cd frontend/packages/chatbot-ui && yarn link && yarn dev

# the host application
yarn link "iocloud-chatbot-library" && yarn start
```

`yarn dev` is `vite build --watch --mode watch`. A watch build differs from
`yarn build` in two ways, each fixing a failure the host saw on every change:

- **ES only.** Rollup's watcher writes every output format in parallel, and Vite
  emits a library's CSS once per build, so only one format — whichever finished
  first — got the injected styles, and the host (which loads the ES build) often
  rendered unstyled.
- **Overwrite, don't empty.** Vite empties `dist/` at the start of every build,
  and the declaration plugin re-emits `.d.ts` files only when a TypeScript file
  changed. The host then saw no module while a rebuild ran, and no types at all
  after a CSS-only edit (`TS2307: Cannot find module 'iocloud-chatbot-library'`).

Things to know while linked:

- **The host rebuilds on every library rebuild.** Webpack follows the link to its
  real path, which is outside `node_modules`, so it watches `dist/`.
- **Do not run `yarn build` while the host's dev server is running.** It empties
  `dist/`, and the declarations land about ten seconds after the JavaScript; the
  host type-checks in between and keeps the error (often an implicit `any`) until
  one of its own files is saved. To rebuild once without stopping it, run
  `vite build --mode watch`: the watch configuration without `--watch`, which
  rewrites the ES bundle and the declarations in place and empties nothing. For the
  CJS bundle too, build to another directory (`vite build --outDir <tmp>`) and copy
  its `index.cjs.js` over.
- **A watch build does not rebuild `index.cjs.js`.** Jest resolves the package
  through `main`, so run `yarn build` once before the host's tests.
- **Two copies of `@types/react`.** The linked package resolves React's types
  from this workspace, so a host's `React.ReactNode` may not be assignable to the
  library's (`Type 'bigint' is not assignable to type 'ReactNode'`). Pass elements
  instead of raw nodes: wrap `children` in a fragment (`<>{children}</>`) and type
  icon constants as `JSX.Element`. An installed (unlinked) package has one copy
  and no such error.

Publishing: bump `version` in `package.json`, then `npm run release:chatbot` from
`frontend/` (build and publish). Bump the host's dependency only after the publish;
before it, `yarn install` in the host fails to resolve the version.

## Migrating from 2.x

| 2.x | 3.0 |
| --- | --- |
| `useChatbot()` / `useChatbotContext()` (the whole context, re-rendered on every token) | `useChatState(selector)` to read, `useChatActions()` to act |
| `useChatMessages()`, `useChatConversations()`, `useChatComposer()` | `useChatState(s => s.messages)` etc. These hooks re-rendered on every change too. |
| `isOpen`, `onOpen`, `onClose` | `open`, `defaultOpen`, `onOpenChange` |
| `ChatContainer` `isDrawerOpen` / `onDrawerOpenChange` | provider `sidebarOpen` / `defaultSidebarOpen` / `onSidebarOpenChange` |
| `headerActions`, `brand` | `config.header.actions`, `config.header.brand` |
| `showAgentSwitcher` / `show_agent_switcher`, `showBottomSection` / `show_bottom_section` | `config.composer.agentSwitcher`, `config.composer.bottomSection` |
| `show_tool_toggles` | `config.composer.tools` |
| `onManageMemory`, `onViewUsage` | `config.header.menuItems` |
| "Switch view" (cycled to the next mode) | one "Switch view" entry that lists the views in place; `config.header.views` / `allowedViews`; `labels.switchView`, `viewFloating` / `viewSidebar` / `viewFullscreen`, `icons.switchView`, `viewFloating` / `viewSidebar` / `viewFullscreen` |
| `ChatbotUIConfig` | `ChatbotConfig`; the old name is a deprecated alias |
| `contextSelector`, `onContextChange` | removed; nothing read them |
| Built-in welcome prompts, cards and privacy badges | none by default; pass them in `config` |
| `Composer` data props (`onSend`, `tools`, `agents`, `usage`, …) and `isRunning` | read from the provider; `disabled` and `placeholder` remain |
| `MainChat` / `ConversationSidebar` / `ChatHeader` data props | read from the provider |
| `<div class="cb-chat-container cb-open">` around a standalone widget | `<ChatRoot>` |
| `apiBaseUrl` | `storageApiUrl` |
| `ConversationDrawer` | `ConversationSidebar`; the old name is a deprecated alias |
| `yarn dev` = `vite build --watch` | `vite build --watch --mode watch` (see [Developing against a linked host](#developing-against-a-linked-host)) |

Fixed in 3.0:

- **Re-renders.** Every context consumer used to re-render on every streamed token. The package had no `React.memo`; `MessageBubble` is now memoised. Under React 17, each token was its own synchronous render.
- **Image flicker.** `AuthenticatedImage` and the attachment viewer re-ran their fetch on every token, so images reset to loading while a turn streamed.
- **Delete.** The button removed the row locally even when the Gateway answered 405. The conversation came back on reload.
- **Mic.** The mic button rendered with no handler.
- **Strings.** Every string was hardcoded in English; all of them are labels now.
- **Tall composer.** An empty composer laid out narrow for a moment (mid-move into a fullscreen page) was sized to its wrapped placeholder and stayed several rows tall until the user typed.
- **Welcome scroll.** The transcript's follow-the-stream scrolling also ran on the empty welcome screen, so anything that grew it scrolled the greeting away.
- **Watch builds.** See [Developing against a linked host](#developing-against-a-linked-host).

## Migrating from 1.x

Three props became one. The shapes map mechanically:

| 1.x | 2.0 |
| --- | --- |
| `external_tools={{ slug: { callback: fn } }}` | `tools={{ slug: { run: fn } }}` |
| `external_tools={{ slug: { callback: fn, definition: d } }}` | `tools={{ slug: { run: fn, definition: d } }}` |
| `result_previewers={{ slug: fn }}` | `tools={{ slug: { preview: fn } }}` |
| `tool_actions={{ slug: { show, label, render, placement } }}` | merge those fields into that slug's entry |
| `client.setExternalTools({ slug: { callback: fn } })` | `client.setTools({ slug: { run: fn } })` |
| `client.setResultPreviewers({ slug: fn })` | `client.setTools({ slug: { preview: fn } })` |

A slug that had entries in two props now has one entry holding both halves:

```tsx
// 1.x
external_tools={{ read_page_context: { callback: collectContext } }}
tool_actions={{ read_page_context: { show: false } }}

// 2.0
tools={{ read_page_context: { run: collectContext, show: false } }}
```

Four things that no longer compile, all of which were broken or inert at runtime:

- **A presentation-only entry** (`{ slug: { show: false } }` with no handler
  anywhere). It never rendered anything, because presentation cannot create an
  action.
- **One slug registered as both** a client tool and a result previewer. 1.x
  resolved this by silently preferring the previewer.
- **A server tool registered in `external_tools`.** It never fired.
- **`ToolActionConfig`, `ExternalToolConfig`, `ResultPreviewer`** as type names —
  use `ToolPresentation`, `ClientToolConfig`, `ServerToolConfig`, or `ToolConfig`
  for the union.

Also renamed, for hosts driving `MessageBubble` or `useStreamChat` directly:
`onToolCall` / `onToolPreview` / `toolActions` are one `tools` prop there too.

### Fixed in 2.0

- `ask_user_questions` now appears in the composer's tool menu. It was registered
  as a handler but left out of the list the menu filters against, so a
  `user_enabled_client_side` questionnaire was hidden even though the UI could run
  it.
- `placement: 'turn-end'` now means what it says. The preview used to auto-open
  mid-turn regardless, because placement only ever governed the button; pair it
  with `autoRun: false`.
- A slug in two registries no longer resolves by silent precedence — it cannot
  happen.

## Other props

`ChatbotProviderProps`, `AppProps` and `ChatbotConfig` are documented in TSDoc on
[`src/context/ChatbotContext.tsx`](src/context/ChatbotContext.tsx),
[`src/components/App/App.tsx`](src/components/App/App.tsx) and
[`src/common/chatbotConfig.ts`](src/common/chatbotConfig.ts). See also
[`LOCAL_NETWORK_ACCESS.md`](LOCAL_NETWORK_ACCESS.md) for reaching a loopback or
private-network gateway from Chromium 142+, and
`services/tool-workers/app/tools/frontend_bridge/README.md` in the platform repo
for the seven kinds of tool and which of them need an entry here.
