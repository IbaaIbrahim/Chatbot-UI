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
- [Rich blocks: charts, tables and cards in an answer](#rich-blocks-charts-tables-and-cards-in-an-answer)
- [Conversation files and artifacts](#conversation-files-and-artifacts)
- [What the Gateway must serve](#what-the-gateway-must-serve)
- [Your own layout](#your-own-layout)
- [A fixed agent for one screen](#a-fixed-agent-for-one-screen)
- [Meta-tool steps](#meta-tool-steps)
- [The `tools` prop](#the-tools-prop)
- [Theming](#theming)
- [Developing against a linked host](#developing-against-a-linked-host)
- [Migrating from 4.0 (4.1)](#migrating-from-40-41)
- [Migrating from 3.x](#migrating-from-3x)
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
| `hostHandlesOpenChange`, `canSwitchMode`, `canShare`, `canCopyConversationLink`, `canStop` | Whether the provider has `onOpenChange` / `onSwitchMode` / `onShare` / `conversationLink`, and whether the client can cancel a turn on the server. |
| `canShowCredits`, `isCreditUsageOpen` | Whether the client can read the user's own allowance, and whether the "Credit usage" dialog is open. |
| `storageClient` | The storage API's client for this user (`StorageClient`), built from `storageApiUrl` and `accessToken`; `null` without both. See [Conversation files and artifacts](#conversation-files-and-artifacts). |
| `isFilesPanelOpen`, `isArtifactsPanelOpen` | Whether the "Conversation files" panel is open, or the "Artifacts" view is showing in place of the chat (one at a time). |
| `artifactsOpenings` | Counts the calls to `openArtifacts()` — the view goes back to its list when "Artifacts" is chosen while it already shows. |
| `filesRevision` | Counts the files saved and artifacts deleted through the chat — a list of files reads it to know when to read again. |
| `messages` | The transcript. Changes on every streamed token — read it only where you draw it. |
| `isThinking`, `isResuming`, `isStopping` | The turn in progress. |
| `usageSummary` | The consumption figures the usage ring shows. |
| `pendingQuestions` | The questions an `ask_user_questions` call is waiting on, or `null`. |
| `staleClientCall` | The open turn waits on a client tool this page can no longer answer. |
| `activeConversationId` | The conversation on screen, or `null` for a new one. |
| `conversations`, `starredConversations` | Recents (the unstarred ones when starring is supported) and Starred. |
| `starringSupported` | The Gateway reports `starred_at`, so a star will persist. |
| `renamingSupported` | The client can rename conversations (`renameConversation`). |
| `isLoadingConversations`, `isLoadingMore`, `hasMore` | The list's paging. |
| `search` | `{ query, results, isSearching }` — the active search, if any. |
| `registeredTools`, `enablableTools`, `enabledToolIds`, `handledToolSlugs` | Tools: the host's handlers, the user-switchable tools and which are on. |

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
| `openFiles()`, `closeFiles()` | The "Conversation files" panel, for the open conversation. |
| `openArtifacts()`, `closeArtifacts()` | The "Artifacts" view: everything the answers produced across conversations, saved and not saved, in the chat column in place of the transcript and the composer. |
| `saveFile(jobUuid, file, options?)` | Stores a `File` or `Blob` in the conversation against the turn `jobUuid` (a block's `jobUuid`): an export by default, an artifact with `isArtifact: true`. Resolves to the stored `ConversationFile`; rejects with the server's reason (after 3 s of retries for a turn not stored yet), or at once without a storage API. See [Saving](#saving-a-file-or-an-artifact). |
| `saveArtifact(jobUuid, file, options?)` | `saveFile` with `isArtifact: true` — listed under "Artifacts". A block's Save passes its `blockKey` prop (`options.blockKey`), which marks that block "Saved". |
| `saveGeneratedFile(attachmentUuid)` | Saves a file the application generated (an export) as an artifact: the storage API copies it. Resolves to the copy (the existing one when saved before); rejects with the server's reason (409 `NOT_GENERATED` for an upload or an artifact), or at once without a storage API. |
| `deleteArtifact(attachmentUuid)` | Deletes one of the user's artifacts; rejects when the server refuses. |
| `sendMessage(text, attachedFiles?)` | Sends a message in the active conversation (a new one when none is active). |
| `stopTurn()`, `retryTurn()`, `continueTurn()` | The turn in progress or the one that failed. |
| `confirmApproval(uuid)`, `rejectApproval(uuid)` | Answers a held tool call. |
| `submitQuestionnaire(formattedAnswers)` | Answers an `ask_user_questions` call. |
| `newChat()` | Starts a new conversation (and leaves the Artifacts view for it). |
| `selectConversation(id)` | Loads a conversation (and leaves the Artifacts view for it); resolves to `false` if it could not. |
| `deleteConversation(id)` | Rejects when the server refuses, and then removes nothing. |
| `setConversationStarred(id, starred)` | Moves the conversation between Starred and Recents at once, and back if the server refuses. |
| `renameConversation(id, title)` | Shows the new title at once, and the old one again if the server refuses. A blank title changes nothing. |
| `searchConversations(query)` | Searches on the server; an empty query ends the search. |
| `refreshConversations()`, `loadMoreConversations()` | The list. |
| `copyConversationId()` | Copies the active conversation's id. |
| `copyConversationLink()` | Copies the provider's `conversationLink` for the active conversation; nothing without one. |
| `setEnabledToolIds(ids)` | Switches user-enablable tools on or off. Saved in `localStorage` (`chatbot-ui:enabled-tools`); ids this screen does not list are kept as they were, so a screen with fewer tools cannot switch off the others. |
| `focusComposer()` | Focuses the composer, unless the user is already typing somewhere. |
| `setComposerText(text)` | Replaces the composer's text and focuses it — to prefill a prompt from a page button. Leaves the Artifacts view, which stands where the composer is. |

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
| `conversation.renamed` | `{ conversationId, title }` | The server accepted a rename. |
| `conversation.deleted` | `{ conversationId }` | The server accepted a delete. |
| `chat.files.changed` | `{ change: 'saved' \| 'deleted', attachmentUuid, file, conversationId, jobUuid, blockKey, savedFromUuid }` | The server accepted a `saveFile` / `saveArtifact` / `saveGeneratedFile` (`file` is what it stored; `blockKey` names the block an artifact was saved from, `savedFromUuid` the generated file a copy was saved from) or a `deleteArtifact` (`file` is `null`). |

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
| `storageApiUrl`, `accessToken` | `''`, `null` | Attachments and authenticated images; with both, the conversation files button, the Artifacts entry and `saveFile` / `saveArtifact`. |
| `userName` | `'User'` | Fills `{name}` in the greeting. |
| `tools` | — | See [The `tools` prop](#the-tools-prop). |
| `skills` | — | This app's own skills, loaded on demand. See [Client skills and the host catalogue](#client-skills-and-the-host-catalogue). Memoise it; omit it to leave `client.setSkills` alone, `[]` clears. |
| `config` | — | See [Configuration](#configuration). Memoise it. |
| `open`, `defaultOpen`, `onOpenChange` | uncontrolled, `true` | Presence. |
| `sidebarOpen`, `defaultSidebarOpen`, `onSidebarOpenChange` | uncontrolled, `false` | The conversation sidebar. |
| `onSwitchMode` | — | Enables the built-in "Switch view" entry (see [Views](#views-the-switch-view-entry)). |
| `onShare` | — | Enables the header's share button. |
| `conversationLink` | — | `(conversationId) => url`: the host's URL that opens a conversation. The menu then offers "Copy conversation link" instead of "Copy conversation ID". |
| `onEvent` | — | Every raw stream event, for hosts that need more than the hooks. |
| `allowLocalNetworkAccess` | `false` | See [`LOCAL_NETWORK_ACCESS.md`](LOCAL_NETWORK_ACCESS.md). |

**Opening a conversation from a link.** Point the client at it before the
provider first sees the client — `client.setConversationId(id)` — and the
provider opens it as it reopens the conversation a tab last had. A conversation
that will not load (deleted, or someone else's link) is let go of rather than
kept: the client's conversation is also where the next message goes, so keeping
it would send that message into a thread the Gateway refuses. Once the chat is
running, `useChatActions().selectConversation(id)` does the same and resolves to
`false` when it could not.

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
| `launcherIcon` | `config.icons.launcher` | `config.icons.launcher` | The floating button's icon — any React node. See [The floating button's icon](#the-floating-buttons-icon). |

`ChatContainer` also takes slots: `header` (defaults to `<ChatHeader />`, `null`
removes it), `sidebar` (defaults to `<ConversationSidebar />`, `null` removes it),
`footer` (usually the composer) and `children` (the transcript, defaults to
`<MainChat />`; anything else must scroll itself).

A closed floating chat that is not embedded renders its launcher button, which
reopens it. In fullscreen on a screen at least 960px wide the sidebar is a column
beside the transcript; everywhere else it is an overlay that closes on Escape and
after a pick.

### The floating button's icon

The round button a closed floating chat shows is a sparkle by default. Change it
on the instance, or for every instance through the configuration:

```tsx
import { ChatApp } from 'iocloud-chatbot-library';
import { ReactComponent as AssistantIcon } from './assistant.svg';

// On this instance — any React node: an SVG, an icon component, a font icon, an <img>.
<ChatApp mode="floating" launcherIcon={<AssistantIcon />} />
<ChatApp mode="floating" launcherIcon={<img src="/logo.png" alt="" />} />

// For every instance under the provider, or for one screen with useChatOverrides.
<ChatbotProvider config={{ icons: { launcher: <AssistantIcon /> } }}>…</ChatbotProvider>
```

`launcherIcon` wins over `config.icons.launcher`, which wins over the default.
The button stays a 56px circle on `--cb-accent-gradient` with a white
(`currentColor`) icon: an SVG is drawn at 24px, an `<img>` at 28px, a font icon
at `font-size: 24px`. Restyle the icon's box through `.cb-launcher-icon`, the
button through `.cb-launcher-btn`. Its accessible name is `labels.openChat`.

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
  composer: { mic: true, onVoiceInput: startDictation, usageDetails: false },
  sidebar: { items: [{ id: 'tasks', label: 'Tasks', icon: <Box />, onSelect: openTasks }] },
  markdown: { blockRenderers: BLOCK_RENDERERS },            // fences the host draws; see Rich blocks
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
| `copyConversationId` | `true` | A conversation is active. Copies the provider's `conversationLink` when it has one ("Copy conversation link"), the id otherwise. |
| `deleteConversation` | `true` | A conversation is active. Takes two clicks: the first asks, in place. |
| `files` | `true` | A conversation is active, the provider has `storageApiUrl` and `accessToken`, and the Artifacts view is not showing in its place. Opens "Conversation files" — see [Conversation files and artifacts](#conversation-files-and-artifacts). |
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
| `tools` | `true` | The tools menu, when there are user-switchable tools (those the client's agent allows, when it has one). `false` also skips fetching them. |
| `density` | `'auto'` | Not a control: how much room the composer takes — see below. |
| `usage` | `true` | The consumption indicator under the composer: a ring for the context window, and the conversation's total credits beside it (*until 4.0, the window's percentage, or the latest turn's credits*). |
| `usageDetails` | `true` | The breakdown card the indicator opens on click. `false` leaves the ring and the total with nothing to open: `config={{ composer: { usageDetails: false } }}`. |
| `disclaimer` | `true` | "This is AI, and can make mistakes. Verify results." (`labels.disclaimer`). |
| `mic` | `true` | `onVoiceInput` is set — the library records no audio itself. |
| `onVoiceInput` | — | Called by the mic button. |

**The usage card** (`usageDetails`) reads the platform's per-step usage events,
so every figure is what was metered — the same numbers as the credit ledger.
What each row means, because two of them are easy to misread:

| Row | What it is |
| --- | --- |
| **Context window** | The size of the agent's *last* prompt — everything sent on its latest model call — against the model's input window (`quota.models.max_input_tokens`). This is the figure that grows as a conversation gets longer, and the one the ring draws. **"limit unknown"** and an empty ring mean the model has no window configured: set it in the admin dashboard, or the platform can neither warn about nor automatically compact a long conversation. |
| Sub-agent · *name* | The same for the sub-agent with the fullest prompt. Its context is its own and ends with its run. |
| **This turn** | Credits, and tokens in / out / steps, summed over **every charged step** of the turn: each model call of the agent, and each tool that runs a model of its own. So **"in" is not a context size**: every model call re-sends the whole conversation and is counted again, and a tool such as web research adds what *its* model read. 1.1M in can be eight calls of 30–60k each plus one research call that read 600k of web pages. |
| This agent / Sub-agents (n) | The turn split between the agent the user is talking to and the sub-agents it started; shown only when it started any. |
| **Whole conversation** | Credits over every turn of the thread. |

Credits are charged per step and **rounded up per step**, a tool's multiplied by its
weight first: a model call worth 0.2 of a credit costs 1. "Steps" counts charged
steps only — meta-tool calls, refusals and the sub-agent hand-off are free and not
counted.

**Density.** `'comfortable'` is the roomy box: the text above a row of buttons.
`'compact'` is a single 48px row — attach and tools on the left, mic and send on
the right, the text between them — with the disclaimer and the usage ring on the
footer line beneath. `'auto'`, the default, is comfortable while the
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
| `artifacts` | `true` | The "Artifacts" entry under "New chat"; shown only while the provider has `storageApiUrl` and `accessToken`. See [Conversation files and artifacts](#conversation-files-and-artifacts). |
| `items` | `[]` | Navigation entries under "Artifacts": `{ id, label, icon?, onSelect, active?, badge? }` — a Tasks page, say. None by default. |
| `starred` | `true` | The Starred section; shown only while the Gateway reports `starred_at`. |
| `search` | `true` | The search box. |
| `rename` | `true` | "Rename" in a row's menu; needs a client with `renameConversation`. |
| `deleteConversation` | `true` | "Delete" in a row's menu; two clicks. |

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
`viewSidebar`, `viewFullscreen`, `creditUsage`, `copyConversationId`, `copiedConversationId`,
`copyConversationLink`, `copiedConversationLink`, `deleteThread`, `confirmDeleteThread`,
`closeChat`, `openChat`); sidebar (`sidebarTitle`, `collapseSidebar`,
`searchPlaceholder`, `starred`, `starredEmpty`, `recents`, `searchResults`,
`noSearchResults`, `star`, `unstar`, `conversationActions`, `renameConversation`,
`conversationTitle`, `deleteConversation`, `confirmDeleteConversation`, `untitledConversation`,
`loadMore`, `loading`, `noHistoryTitle`, `noHistoryBody`, `today`, `yesterday`,
`previous7Days`, `older`); transcript (`scrollToLatest`, `staleClientCall`,
`greetingTitle`); composer (`composerPlaceholder`, `questionnairePlaceholder`,
`dropFiles`, `addAttachment`, `attachmentsUnavailable`, `removeAttachment`,
`uploadingFiles`, `unsupportedFileType`, `fileTooLarge`, `uploadNeedsStorageUrl`,
`uploadNeedsToken`, `uploadFailed`, `tools`, `voiceInput`, `send`,
`waitingForUploads`, `stop`, `stopping`, `disclaimer`); messages
(`assistantName`, `copy`, `copied`, `reply`, `edit`, `retry`, `continue`,
`thinking`, `thoughtBriefly`, `show`, `hide`, `toolCalling`, `toolUsed`,
`toolRunning`, `toolFailed`, `toolRan`, `openResult`, `openPreview`,
`toolArguments`, `toolResult`, `searchResultsHeading`, `previousVersion`,
`nextVersion`, `confirm`, `cancel`, `executingTool`, `confirmedExecuting`,
`cancelled`); meta-tool steps (`metaSearchingTools`, `metaSearchedTools`,
`metaLoadingTools`, `metaLoadedTools`, `metaSearchingSkills`,
`metaSearchedSkills`, `metaLoadingSkill`, `metaLoadedSkill`, `metaRefused` —
see [Meta-tool steps](#meta-tool-steps)); the activity section
(`activityThoughtOne`/`Other`, `activitySearchedOne`/`Other`,
`activityLoadedSkillOne`/`Other`, `activityLoadedToolsOne`/`Other`,
`activityRanOne`, `activityRanRepeated`, `activityRanOther`,
`activityAgentOne`/`Other`, `activityAgentWorking`, `activityFailed`,
`activitySeparator` — see [The activity section](#the-activity-section));
rich blocks (`blockPreparing`, `blockFailed`, `blockShowSource`, `blockExpand`,
`blockMore`, `blockCopySource`, `blockClose` — see [Rich blocks](#rich-blocks-charts-tables-and-cards-in-an-answer));
attachment viewer (`close`, `closeAttachment`, `attachmentLoadFailed`,
`attachmentNoAuth`, `pdfLoadFailed`, `downloadFile`, `downloadFailed`,
`previewTruncated`); conversation files and artifacts (`conversationFiles`,
`conversationFilesEmpty`, `filesLoadFailed`, `fileArtifactBadge`,
`fileGeneratedBadge`, `previewFile`, `artifacts`, `artifactsEmpty`,
`artifactsLoadFailed`, `searchArtifacts`, `noArtifactResults`,
`noArtifactFilterResults`, `artifactKindFilter`, `artifactKindAll`,
`artifactKindChart`, `artifactKindTable`, `artifactKindKpi`, `artifactKindReport`,
`artifactKindFile`, `openConversation`, `backToArtifacts`, `deleteArtifact`,
`confirmDeleteArtifact`, `artifactDeleteFailed`); saved and not saved (`savedBadge`,
`notSavedBadge`, `saveFile`, `saveFileFailed`, `fileSavedAnnouncement`, `showInChat`, `showInChatUnavailable`,
`blockUntitled`, `blockNoRenderer`, `blockLoadFailed`, `filesFilter`, `filesFilterAll`,
`filesFilterVisuals`, `filesFilterFiles`, `conversationVisualsEmpty`, `artifactStatus`,
`artifactStatusAll`, `artifactStatusSaved`, `artifactStatusUnsaved`, `artifactsSavedEmpty`,
`artifactsUnsavedEmpty`); the files panel's look (`conversationFilesEmptyTitle`,
`conversationFilesEmptyHint`, `filesItemsOne`, `filesItemsOther`, `filesSavedCount`,
`itemKindChart`, `itemKindTable`, `itemKindKpi`, `itemKindReport`, `itemKindFile`,
`itemKindImage`, `itemKindPdf`, `itemKindSpreadsheet`); questionnaire (`answerPlaceholder`,
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

`brand`, `launcher` (also the `launcherIcon` prop — see [The floating button's icon](#the-floating-buttons-icon)), `sidebarToggle`, `sidebarCollapse`, `newChat`, `search`,
`star`, `starFilled`, `sectionCollapsed`, `sectionExpanded`, `promptRow`, `delete`,
`rename`, `more`, `share`, `viewFloating`, `viewSidebar`, `viewFullscreen`, `switchView`,
`check`, `creditUsage`, `copy`, `link`, `close`, `attach`, `tools`, `mic`, `send`, `stop`,
`scrollDown`, `files`, `artifacts`, `download`, `expand`, `openConversation`, `back`
(an opened artifact's "Back to artifacts", drawn pointing left and mirrored
right-to-left), and one per artifact kind: `artifactChart`, `artifactTable`, `artifactKpi`, `artifactReport`,
`artifactFile`; one per plain file's type, in the files lists' rows: `fileImage`, `filePdf`,
`fileSpreadsheet` (anything else is `artifactFile`); and for saved and not saved: `saved` (the "Saved" mark), `notSaved` (the
"Not saved" mark), `save` (a generated file's Save) and `showInChat` (a block's "Show in chat"
in the files panel).

`sidebarToggle` and `sidebarCollapse` are one panel drawn twice, its chevron
reversed: the header shows the first while the sidebar is closed and the second
while it is open, and the sidebar's own collapse button shows the second.
Replace them as a pair.

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

New chat, then **Artifacts** (with a storage API — see [Conversation files and
artifacts](#conversation-files-and-artifacts)), then the host's `sidebar.items`,
then **Starred** and **Recents**, with search over all of them. Selecting from an overlay closes it; the
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
- Each row's **"more" menu** holds Star, Rename and Delete — one button rather
  than three, which left a title a few characters in a 260px column.
- **Rename** edits the title in place: Enter or leaving the field saves, Escape
  cancels. The row shows the new title at once and the old one again if the
  server refuses. A title the user chose is never overwritten by a generated one.
- **Titles** are generated by the Gateway from a thread's first turn, after that
  turn ends, so the list is read again a few seconds after a new thread's first
  reply (3s and 8s) to pick the title up.
- **Delete** takes two clicks — the first turns the entry into the question — and
  the row is removed only after the server accepts. The Gateway hides a deleted
  conversation and removes nothing (revision 011). *Until 4.0 delete was off by
  default, because the Gateway served no `DELETE` route.*

## Rich blocks: charts, tables and cards in an answer

*New in 4.1 (2026-10-14).* A host draws fenced code blocks itself. The model
writes a fence in its answer — ` ```chart `, ` ```table `, whatever languages the
host registers — and the chat draws the host's component in its place: inline,
next to the sentence that refers to it, several per answer. The library knows no
chart; it owns the frame, the streaming, the failure path and the plumbing.

```tsx
const BLOCK_RENDERERS: Record<string, BlockRenderer> = {   // module level: its identity is compared
  chart: { component: ChartBlock, label: 'chart', minHeight: 260 },
  table: { component: TableBlock, label: 'table' },
};

<ChatbotProvider config={{ markdown: { blockRenderers: BLOCK_RENDERERS } }} … />
```

| `BlockRenderer` | Default | Meaning |
| --- | --- | --- |
| `component` | — | A component taking `BlockRenderProps`. Rendered only once the fence is whole. A renderer without one React can render is ignored with a console warning. |
| `placeholder` | the library's skeleton | Shown while the fence streams: `{ language, partialSource, label }`. |
| `toText(source)` | `[<label>: <title>]` | What the block reads as in "Copy". |
| `minHeight` | `160` | Height (px) the skeleton reserves, so the transcript does not jump. |
| `label` | the language | The word the skeleton ("Preparing chart…") and the fallback use. |
| `frame` | `true` | `false` draws the component bare: no border, title, toolbar or menu. |

`config.markdown.onExpandBlock(block)` takes "Expand" over — return `true` to
show the block somewhere of your own (a side panel); otherwise the library's
overlay opens. A layer's `blockRenderers: { chart: null }` removes a renderer set
beneath it, for a screen that must not draw charts.

The resolved map (`useMarkdownConfig().blockRenderers`) has **no prototype**: a
fence's language is text from the answer, and ` ```constructor ` must not find
`Object.prototype.constructor`. Read it by key or with `Object.keys`, or look a
language up with `rendererFor(map, language)` — which also guards a map of your
own — but not with `map.hasOwnProperty(…)`, which it does not have.

**What a block's component is given** (`BlockRenderProps`):

| Prop | Meaning |
| --- | --- |
| `language`, `source`, `meta`, `blockKey`, `messageId` | The fence: its language, body and info string after the language; `blockKey` is `fnv1a(language + '\n' + source)`, the same live and after a reload. |
| `jobUuid`, `conversationId` | The turn that wrote the answer and its conversation — what a block is saved against (`saveArtifact(jobUuid, …)`). `jobUuid` is `null` until a live turn's first frame names its job. |
| `streaming` | The turn is still in flight: a reference to one of its steps may not have a result yet. Wait rather than fail. |
| `expanded` | Drawn in the expanded overlay. |
| `width` | The width the component can draw in, in px: the body's content box (inside its padding), the same box on the first measurement as on every later one. Kept current; `0` until measured. |
| `theme`, `direction`, `mode` | `'light'`/`'dark'` as drawn (`system` resolved), the text direction around the block, the chat's placement. |
| `getMessageSource()` | The whole answer's text, for a block that exports its siblings (a report). |
| `setTitle(title)` | The title in the frame's header. |
| `setActions(actions)` | The block's actions: `{ id, label, icon?, run({ element, messageElement }), placement?: 'menu' \| 'toolbar', disabled? }`. Menu entries sit under "More actions" with "Copy source"; at most one or two `toolbar` buttons beside Expand. Calling it again with the same ids, labels, placements and states changes nothing, so it is safe in an effect; a click runs the latest `run`. |
| `openExpanded()` | Opens the overlay (or `onExpandBlock`). |
| `fail(reason)` | Shows the library's fallback: "Couldn't display this chart: *reason*", with the source. |

How it behaves:

- **Streaming.** A fence is drawn as a skeleton — with the title once `"title"`
  has streamed — until its closing line arrives; nothing is parsed from a
  partial body. A fence the answer ended inside counts as closed. Once drawn, a
  block **is not rendered again by later tokens**: the `components` map is a
  module constant, the block is memoised on its props, and `getMessageSource` is
  a stable reader. Memoise `config` and the renderer map, or every change of
  them re-renders every block.
- **Failure.** A component that throws is caught by an error boundary around
  each block; the answer around it stays, and the fallback shows the reason and
  the source. A `component` React cannot render at all is caught there too.
- **Whose messages.** Only the assistant's answers draw blocks. A user's own
  message shows a fence they pasted as code, and its "Copy" gives back exactly
  what they wrote. `MarkdownContent`'s `blocks={false}` does the same for a host.
- **Expanded.** A modal overlay portalled to `document.body`, carrying `.cb-root`
  and the chat's `data-theme` so the tokens apply there too. Escape and the
  scrim close it; Tab stays inside (a popup your component portals out of it
  keeps its own Tab order); focus returns to Expand. Its header is the title,
  the `toolbar` actions, "More actions", then the close button — last.
- **Copy.** The message's "Copy" replaces each claimed fence with
  `renderer.toText(source)` or `[<label>: <title>]` (`toPlainText`).
- **Line endings.** A block's `source` has `\n` line endings whatever the
  answer used, so its `blockKey` is the one `extractBlocks` gives for it.
- **A fence the answer ended inside** is drawn (once the text stops) with its
  body as the parser hands it over: without the text's final line break.
  `extractBlocks` reads it the same way since 2026-10-14, so its `blockKey` —
  the one a Save sends and the platform indexes — is the drawn block's.
- **Found again.** A drawn block's frame carries `data-block-key` and
  `data-job-uuid` (its turn), which the files panel's "Show in chat" goes to.
- **Indexed.** Every job names the languages the page draws
  (`block_languages`, from the merged `blockRenderers`), so the platform
  indexes those blocks when the turn ends: a block nobody saved is listed as
  "Not saved" in the conversation's files and under Artifacts — see
  [Saved and not saved](#saved-and-not-saved).
- **Width.** An answer takes its row's whole width since 4.1 (a user message keeps
  80%), so a block gets ~330px in the 400px floating panel.
- **Styles.** A block's body sits inside the message's `.cb-markdown-content`,
  whose rules (`p`, `table`, `code`…) reach a renderer's elements: scope a
  renderer's styles with a class of its own. The frame is `figure.cb-md-block`
  (`.cb-md-block-header`, `-title`, `-toolbar`, `-body`, `-fallback`), tokens only.
- **Without renderers** — another host, an old answer — a fence stays a code
  block, so the JSON is still readable.

Exports for a host that renders or exports answers itself: `MarkdownContent`
(the one markdown renderer every answer goes through; `blocks={false}` keeps
every fence as code), `toPlainText(markdown, renderers)`, `extractBlocks(markdown,
languages, messageId?)` (every block of those languages, with the same
`blockKey`), `scanBlocks(markdown, languages, messageId?)` (the same, with
whether each fence has closed), `extractBlockTitle`, `isFenceClosed`, `fnv1a`,
`blockKeyOf`, `blockLanguagesOf(languages)` (what a job sends as
`block_languages`), `rendererFor(renderers, language)`, and `useMarkdownConfig()`.

A block drawn **outside its message** — in a panel of your own, say — is
`<ExpandedBlock language source renderer jobUuid conversationId meta? messageId?
getMessageSource? streaming? onClose? />`: the host renderer, expanded and not
streaming (pass `streaming` while the block's turn is still under way, and a
`getMessageSource` that reads the message's current text), in the library's
frame, so its own Save saves it against `jobUuid` (pass the turn's). `<BlockDialog label onClose returnFocusTo?>` is the library's expanded
overlay around it — a modal dialog over the page, as the files panel opens a
block in.

## Conversation files and artifacts

*New in 4.1 (2026-10-14).* With `storageApiUrl` and `accessToken` on the
provider, the chat shows what a conversation has stored, and what the user chose
to keep:

- **The header's files button** (`header.files`) opens **"Conversation files"**:
  everything of the open conversation, newest first — what the user attached,
  what the application generated (an export), what the user saved, and every
  chart, table, KPI card or report its answers drew — with filter chips (All ·
  Visuals · Files) and a **Saved / Not saved** mark (an icon and the word) on
  every artifact; the user's uploads carry none. A file opens in the viewer
  (images, PDFs, a CSV as a table, text; anything else as a download) and
  downloads with the user's token; a generated file nobody saved has a Save
  button. A drawn block opens **drawn live** by its renderer in the expanded
  overlay — its own Save saves it — and "Show in chat" closes the panel and
  goes to it in the transcript. See [Saved and not saved](#saved-and-not-saved).
  It is a dialog sized to its list (2026-10-14): centred and rounded, as
  tall as its content up to `min(680px, 80vh)` with the list scrolling under
  a fixed header and filter — a sheet at the bottom of the chat, with small
  margins, in a narrow one (the floating card, a docked panel). Its header
  says the conversation and "6 items · 2 saved"; the filter is a segmented
  control with a count per option; under "All" the list is two sections,
  Visuals then Files, newest first in each. A row is a tile tinted by its kind
  (chart, table, KPI card, report, image, PDF, spreadsheet, file — or the image
  itself), its title, its mark as a small pill, and its details (kind, when —
  relative within the week in whole units, the full date as the tooltip — and
  size); its actions show on hover or focus with a mouse, and always on a
  touch screen or in a narrow chat. In a narrow chat the pill is its icon (a
  filled or a dashed bookmark; the word stays in the row's name) and the
  details wrap between parts to a second line, so the date and the size
  always show. Loading shows four rows' skeletons; an empty
  conversation, a heading ("No files yet") and what will appear there; an empty
  filter, its own line; a failed read, a message with Retry.
- **The sidebar's "Artifacts" entry** (`sidebar.artifacts`), under "New chat",
  opens **"Artifacts"**: everything the answers produced, across conversations,
  saved and not saved — a segmented control (All · Saved · Not saved) above
  the kind filter (charts, tables, KPIs, reports, files), a mark on every row
  — with search, 20 at a time, each with its conversation's title and a button
  that opens it, download (a stored file), and delete (an artifact; two
  clicks). "Load more", a search and a save keep the pages
  already loaded: a read again reads everything on screen, not just page one,
  in pages of at most 100. A "Load more" under way when the list is read again
  is neither lost nor shown twice, even when that read fails.
- **"Artifacts" is a view in place of the chat, not a dialog over it.** It
  takes the chat column's place — where the transcript and the composer are —
  under the header, with the sidebar where it was (inline in fullscreen; a
  drawer elsewhere, which closes as it does for a conversation). The entry is
  marked current (`aria-current="page"`) while it shows, and no conversation
  is. The transcript and the composer stay mounted behind it, hidden from the
  eye and from assistive technology, so a draft, an upload under way and the
  scroll position are there to come back to. The view is a labelled region:
  no scrim, no focus trap. Opening it puts focus in its search; choosing
  "Artifacts" again while it shows goes back to the list (from an open
  artifact) with focus in the search. The header's files button hides while
  it shows: the conversation it would describe is not on screen.
- **An artifact opens in full in that same column.** Its header has "Back to
  artifacts" at the start, its kind and title, its Saved / Not saved mark, its
  actions (Save, download, open its conversation, delete) and the close button
  last; below, its conversation,
  date and size, then the file — an image as wide as the column (scrolling
  when taller), a PDF a page at a time at the column's width, a CSV as a table,
  text as text, anything else as a card with a download — in the chat's own
  theme. A file that cannot be fetched says so in place, and the artifact
  stays open. A block nobody saved is **drawn live** there, full width, by the
  host's renderer; a generated file nobody saved shows as its file with Save.
  "Back" returns to the list as it was left: search, filters, the pages
  loaded, the scroll position, and focus on the row (or on the artifact it
  was saved as).
- **Leaving the view.** Its close button, "Open conversation", a conversation
  picked in the sidebar, "New chat" (sidebar or header) and `setComposerText`
  give the column back to the chat. The conversation that was open behind the
  view, picked again, comes back as it was — not loaded again, so an answer
  still streaming goes on. Escape steps back — from an artifact to the list,
  from the list to the chat — when pressed in the chat (the view, or an inline
  sidebar beside it), not from the host's page around it. While another
  dialog (credit usage), an overlay sidebar or the header's menu is open, the
  Escape is theirs, wherever focus is. Focus goes back to the "Artifacts"
  entry when it is on screen, else to the composer; after "Open
  conversation", to the composer; and nowhere when a dialog took the column
  (`openFiles()`), which keeps it.
- **The files panel is a modal dialog over the chat column.** Tab stays inside
  it. Escape closes it from anywhere in the chat (the panel, or the sidebar
  beside it), but not from the host's page around the chat; with nothing
  focused — the row the user was on was deleted — it goes by where the user
  last clicked or focused. A file opens in the viewer (a lightbox over the
  page); closing it puts focus back on its row.
- **A header's close button is last** — in the files panel, the Artifacts view
  and an opened artifact, the attachment viewer and an expanded block: after
  every action and the "More actions" menu. The row follows the page's
  direction, so right-to-left it is the left end.
- **Thumbnails.** An image of up to 1 MB shows itself in its row, fetched only
  once the row comes near the visible list and three at a time; a larger one
  shows its kind's icon (the storage API has no smaller rendition). The
  provider keeps fetched files' object URLs in a bounded cache (60 files or
  48 MB, least recently used out first) and lets a deleted artifact's go at once.

### Saving a file or an artifact

A file is stored against a **turn**: `saveFile(jobUuid, file, options)` — the
block's own `jobUuid`. The storage API checks that the turn is the user's.

```tsx
const ChartBlock: React.FC<BlockRenderProps> = ({ jobUuid, source, setActions }) => {
  const { saveArtifact } = useChatActions();
  const [saved, setSaved] = React.useState(false);
  const { title } = JSON.parse(source);
  React.useEffect(() => setActions([
    { id: 'png', label: 'Download PNG', run: ({ element }) => downloadPng(element) },
    {
      id: 'save', label: saved ? 'Saved' : 'Save', placement: 'toolbar', icon: <SaveIcon />,
      disabled: saved || !jobUuid,
      run: async ({ element }) => {
        await saveArtifact(jobUuid!, await toPngBlob(element), { title, kind: 'chart', spec: source });
        setSaved(true);
      },
    },
  ]));
  …
};
```

| `SaveFileOptions` | Meaning |
| --- | --- |
| `isArtifact` | `true`: an artifact, listed under "Artifacts" too. `false` (the default): a generated file of the conversation — an export. `saveArtifact` sets it. |
| `title` | Shown instead of the file name (one line, 255 characters). |
| `kind` | `'chart'`, `'table'`, `'kpi'`, `'report'` or `'file'`. |
| `spec` | What the file was drawn from (the block's body), kept so it can be drawn again. The storage API keeps one JSON object of at most 256 KiB, and refuses the whole save otherwise, so: an object, or a string holding one, is sent as that object; anything else — JSON your renderer had to repair, an array — is kept as its text under `source` (`{"source": "…"}`; hand `spec.source` back to the renderer to draw it again); a spec still over the limits (size, 64 levels of nesting, a NUL character) is left out with a console warning and the file is saved without it. `prepareSpec(spec)` says beforehand what will be sent. |
| `filename` | The name for a bare `Blob`; otherwise the title plus the type's extension. |
| `blockKey` | For an artifact saved from a drawn block: the block's `blockKey` prop, sent as `block_key`. It marks the block "Saved" in the conversation's files and takes it off "Not saved" under Artifacts. Sent only with `isArtifact: true`; a key the storage API would refuse is left out with a console warning. |

The promise resolves to the stored `ConversationFile` (`attachment_uuid`,
`job_uuid`, `conversation_uuid`, `conversation_title`, `filename`,
`content_type`, `size_bytes`, `is_artifact`, `artifact_kind`, `title`,
`has_spec`, `source`, `created_at`, `download_url`, and since 2026-10-14
`saved`, `block_key`, `saved_from_uuid`) and rejects with the
server's reason (`StorageRequestError`: `status`, `code`, `message`) — a type it
does not store (SVG and HTML are refused), more than 10 MB, a turn that is not the
user's. After it resolves the panels read again and `chat.files.changed` fires.

A block's `jobUuid` is set as soon as the stream names the turn, a moment before
the platform has written the turn's row, so a Save pressed at once can find the
storage API not knowing the turn yet (404 `JOB_NOT_FOUND`). `saveFile` tries
that answer again three times, 0.5, 1 and 1.5 s apart, before rejecting with
it; every other refusal rejects at once. A turn that really is not the user's
is therefore refused about 3 s later.

`useStorageClient()` (or `new StorageClient({ storageApiUrl, token })`) reads
directly: `listConversationFiles(conversationId)` → `{ conversation_uuid,
files, blocks }` (the files newest first; the blocks the platform indexed,
`BlockRecord[]`, oldest turn first — dedupe them by `(turn_job_uuid,
block_key)`; until 2026-10-14 it resolved to the files alone),
`listArtifactEntries({ status, kind, q, limit, offset })` → `{ items:
ArtifactEntry[], total, limit, offset, hasMore }` (saved and not saved;
`status` `all` | `saved` | `unsaved`), `getBlock(uuid)` (a block with its
`source`, to draw it again), `saveGeneratedFile(uuid)`, `listArtifacts({
limit, offset, q, kind })` → `{ items, total, limit, offset, hasMore }` (saved
artifacts only) — every list query brought within what the storage API takes:
`limit` 1–100, `offset` 0–1,000,000 (`MAX_ARTIFACT_OFFSET`; a page past it is
empty, without a request), `q` without NUL characters and cut at 200
characters (it answers anything else with a 422) — `getArtifact(uuid)` (with its `spec`), `deleteArtifact(uuid)`,
`fetchFile(file)` → `Blob`, `downloadFile(file)`, `fileDownloadUrl(jobUuid,
attachmentUuid)`. `normalizeConversationFile`, `normalizeBlockRecord` and
`normalizeArtifactEntry` read the storage API's records for a host that calls
a route of its own.

### Saved and not saved

*2026-10-14.* An **artifact** is anything the agent produced for the user:
every block it drew (a fence of a language with a renderer) and every file a
tool generated. **Saved** — the user pressed Save, and a stored, downloadable
artifact exists; **Not saved** — drawn or generated, never saved. The user's
own uploads are neither.

- **Indexing.** Every job carries `block_languages` — the languages of the
  merged `config.markdown.blockRenderers` the platform takes
  (`^[a-z][a-z0-9_-]{0,31}$`, each once, sorted, at most 16; left out with
  none). When the turn ends, the platform indexes those fences of its answer,
  sub-agents' included. `GatewayStreamClient.setBlockLanguages(languages)` and
  `getBlockLanguages()` (the provider calls the first; a host rarely needs
  them), or `blockLanguages` in its config.
- **The link.** A block is known by `(turn job, blockKey)`. A block's Save
  passes `blockKey` to `saveArtifact` against the block's `jobUuid` (the
  turn's), and the block is then Saved. Deleting the artifact makes it Not
  saved again.
- **The files panel** lists the server's blocks together with those in the
  loaded transcript — the turn under way (a fence still being written is
  left out) and older conversations the platform never indexed show at once —
  one row per turn and key. A saved block's artifact, and a generated file's
  saved copy, are folded into that block's or file's row. It reads again on
  `chat.files.changed` and twice shortly after a turn ends (1.5 s and 5 s),
  when the platform has indexed it. A block of the turn under way opens with
  `streaming: true` and a `getMessageSource` that reads its message as it
  grows, until the turn ends. A reloaded handoff child's answer belongs to the
  turn that handed over (`MessageProps.jobUuid`, as live), so its blocks are
  one row with the platform's. Picking another conversation (the inline
  sidebar stays usable beside the panel) shows that one's list, never the
  previous one's. A block of a language with no renderer on
  this page is a row with its language that opens nothing; "Show in chat" is
  off, with its reason, for a block whose answer is not in the transcript on
  screen.
- **Artifacts** reads `GET artifact-entries`: a saved block is listed as its
  artifact file; a not-saved block is fetched (`getBlock`) and drawn live
  when opened — `expanded: true`, `streaming: false`, `jobUuid` the block's
  turn, `conversationId` its conversation (not the one open), `blockKey` its
  key — so a renderer that resolves references reads that conversation.
- **Renderers.** Drawn outside its message, a block is given `messageId` `''`
  (or its message's, from the panel) and a `getMessageSource` of its answer
  when the transcript holds it, else of its own body. Its Save works as in
  the chat; show "Saved" from `chat.files.changed` (`blockKey`, `jobUuid`).
- **Known divergences.** The transcript's extraction (`scanBlocks`,
  `extractBlocks`) and the platform's index — a port of it — read two shapes
  otherwise than the renderer draws them: an unclosed fence in a list item
  followed by less-indented text (extracted to the end of the text, drawn to
  the end of the item: the drawn block's key is not the indexed one, so it
  stays Not saved in the lists after a save) and a fence inside an HTML block
  (drawn as HTML, still listed as Not saved). The skill that writes rich
  blocks produces neither.

### What the storage API must serve

Under `{storageApiUrl}/api/v1/attachments`, with the user's bearer token
(platform ADR-020):

| Call | Used for |
| --- | --- |
| `POST jobs/{job_uuid}/files` — multipart `file`, `title?`, `kind?`, `spec?`, `is_artifact`, `block_key?` | `saveFile` / `saveArtifact`; answers `data.file`. A 404 `JOB_NOT_FOUND` is tried again for 3 s (the turn's row may not be written yet). |
| `POST files/{attachment_uuid}/save` | `saveGeneratedFile`: 201 `ARTIFACT_SAVED` or 200 `ARTIFACT_ALREADY_SAVED`, `data.file` the copy; 409 `NOT_GENERATED`, 404 `ATTACHMENT_NOT_FOUND`. |
| `GET conversations/{conversation_uuid}` | The files panel; answers `data.{conversation_uuid, files, blocks}`. A 404 (a thread the platform has not stored yet) reads as nothing yet. |
| `GET artifact-entries?status&kind&q&limit&offset` | The Artifacts view, saved and not saved; answers `data.artifact_entries.{items, pagination}`. `limit` 1–100, `offset` 0–1,000,000, `q` up to 200 characters without NUL. |
| `GET blocks/{block_uuid}` | `getBlock`: `data.block` with `source`; 404 `BLOCK_NOT_FOUND`. |
| `GET artifacts?limit&offset&q&kind` | `listArtifacts` (saved artifacts only); answers `data.artifacts.{items, pagination}`. |
| `GET artifacts/{uuid}` | `getArtifact`, with `spec`. |
| `DELETE artifacts/{uuid}` | Deleting an artifact (204). |
| `GET jobs/{job_uuid}/files/{attachment_uuid}` | Previews and downloads. |

## What the Gateway must serve

What `GatewayStreamClient` calls, all under `/v1/user/` with the session's bearer
token:

| Call | Used for |
| --- | --- |
| `POST jobs`, then the job's stream URL, `POST jobs/{id}/stream-token` | Sending a message and streaming the turn; re-minting an expired stream token. A job without `agent_id` carries `host_catalogue=true` (and no `client_tools`); one with an agent carries `client_tools`. Every job carries `block_languages` (a JSON array) when the page draws rich blocks. |
| `POST jobs/{id}/cancel` | Stop. |
| `POST tools/jobs/{id}/tool-results`, `tool-approvals` | Answering a client tool call or a host request; approving or denying a held call. |
| `GET tools/enablable` | The tools menu (`?agent_id=` when the client has an agent). |
| `GET agents` | Only `listAgents()`, for a host that shows agents itself; the chat never calls it. |
| `GET conversations?limit&offset&q&starred` | Recents, Starred and search. Items carry `starred_at` on a Gateway that supports starring. |
| `GET conversations/{id}` | Opening a conversation. |
| `PATCH conversations/{id}` `{ starred }` or `{ title }` | Starring and renaming. |
| `GET credits` | The "Credit usage" dialog: the user's own allowance, this month's charges, and whether a job can start now. |
| `DELETE conversations/{id}` | Deleting (204). |

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
| `ConversationFilesPanel` | none — draws itself while the panel is open, covering its nearest positioned ancestor (`ChatContainer` puts it over the chat column) |
| `ArtifactsPanel` | none — the Artifacts view, drawn while `isArtifactsPanelOpen`, filling the element it is rendered in (see below) |
| `MarkdownContent` | `content`, `streaming`, `turnInFlight`, `messageId`, `jobUuid`, `conversationId`, `getMessageSource` — the transcript's markdown, with the host's blocks; wrap it in `.cb-markdown-content` for the transcript's typography |

**The Artifacts view in your own layout.** `ChatContainer` draws it in the
transcript's place. A layout of your own decides where it goes: render
`ArtifactsPanel` where the view belongs — usually in your chat column, instead
of `MainChat` and the composer while `isArtifactsPanelOpen`. It is
`height: 100%` of the element it is rendered in and scrolls inside it, so give
it an element of its own with a definite height — nothing else stacked in it —
such as a flex child with `flex: 1` and `min-height: 0` under the header. It
renders nothing while the view is closed. Keep the chat mounted and hide it
rather than unmounting it if a draft should survive the visit:

```tsx
const showingArtifacts = useChatState(s => s.isArtifactsPanelOpen);

<ChatRoot theme="light" className="my-chat-column">
  <ChatHeader />
  <div className="my-chat-body" hidden={showingArtifacts}>
    <MainChat />
    <Composer />
  </div>
  {showingArtifacts && (
    <div className="my-chat-body">
      <ArtifactsPanel />
    </div>
  )}
</ChatRoot>
```

```css
.my-chat-column { display: flex; flex-direction: column; height: 100%; }
.my-chat-body { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.my-chat-body[hidden] { display: none; }
```

A `ConversationSidebar` in the same `ChatRoot` (or `ChatContainer`) is "the
chat" for Escape, and its "Artifacts" entry is where focus returns when the
view closes.

`Composer` keeps two per-instance overrides, `disabled` and `placeholder`.
Everything else it shows comes from the provider, so two composers on one page
agree. Its ref is a `ComposerHandle`: `focus()`, `setText(text)`,
`directToolCall(slug, input)`, `getAttachedFiles()`, `clearAttachedFiles()`. To
reach the mounted composer from anywhere, prefer `useChatActions().focusComposer()`
and `setComposerText(text)`.

## A fixed agent for one screen

The chat offers no agent picker. A message sent without an agent runs the
platform's **central mode**: the application's central agent starts with four
meta-tools and loads the tools and skills the turn needs as it goes (see
[Meta-tool steps](#meta-tool-steps)). A thread already bound to an agent on the
server — started with one, or handed to one — keeps it either way.

A screen built around one specialist — Flowdit's "create a template with AI",
say — binds that agent on its own client:

```ts
const client = new GatewayStreamClient({ gatewayUrl, token, agentId: CHECKLIST_AGENT_ID });

// or, on a client you already have, before the provider first sees it:
client.setAgentId(CHECKLIST_AGENT_ID);
```

- **Bind it before the provider first sees the client.** Every job then carries
  `agent_id` and runs exactly that agent, as before 4.0, with every `tools` entry
  that has a `definition` sent along as `client_tools` (an agent's run offers its
  whole tool set, so it needs them up front). The tools menu is listed
  once, for the agent the client has at that moment
  (`GET tools/enablable?agent_id=…`); a later `setAgentId` changes what the next
  job sends, not the list.
- **Not persisted.** The client parks its conversation in `sessionStorage`
  (`chatbot-ui.active-session`) so a remount continues the thread, but not the
  agent. That key is per tab, shared by every client in it, and a restored agent
  outlived the screen that chose it: the next screen's client picked it up and
  silently bypassed central mode. Pass the agent each time the screen builds its
  client. A value 3.x stored is ignored, and the next write removes it.
- **Without one** no `agent_id` is sent and no definition either: the job carries
  `host_catalogue=true` and the platform reads the app's tools and skills from the
  browser when it needs them (see [Client skills and the host
  catalogue](#client-skills-and-the-host-catalogue)). `setAgentId(null)` returns a
  client to central mode.
- `getAgentId()` reads the binding, and `listAgents()` (`GET /v1/user/agents`)
  remains for a host that shows agents itself.

## Telling the agent about the user: host context

Your app knows things the platform does not — which of *your* permissions the
user holds, the interface language, the page they are on and the record open on
it. Give the client a function and it sends the result as `host_context` with
every message:

```ts
import ability from './acl'

const client = new GatewayStreamClient({
    gatewayUrl,
    hostContext: () => ({
        'Can create, import and edit checklist templates': ability.can('call', 'CKL_MANAGE_TEMPLATES'),
        'Interface language': currentLanguage(),
        'Current page': window.location.pathname,
        'Open template': openTemplate?.title,   // null/undefined is left out
    }),
});
// or later: client.setHostContext(() => ({ ... }))   — null sends none
```

The platform shows it at the end of that turn's system prompt as a
`<host_context>` block, framed as information rather than instructions (platform
ADR-019), so the agent knows from its first step what not to offer.

- **Computed at each send.** A function runs as the message goes out, so the facts
  describe that moment; a plain object is sent as is.
- **Never in the way.** A function that throws, or returns nothing, sends the
  message without the field.
- **It grants nothing.** The browser sends it, so the user could change it, and
  nothing the platform enforces reads it. Enforce permissions in your own API;
  use this so the agent does not *offer* what would fail.
- **Small.** At most 30 facts, labels of 64 characters, values of 300, 4 KB in
  all — the gateway refuses more with a 422. Booleans read as yes/no, lists are
  joined. Leave heavy page content to an on-demand tool.
- **Sub-agents** the turn starts are told the same.
- **Phrase a missing permission as a "cannot".** The platform's header for the block
  carries one rule: when a fact says the user cannot do something, the agent does
  not offer or attempt it, even if its own instructions say to, and tells the user
  it needs that permission. `'Can import checklists': false` (sent as "no") or
  "User is not allowed to import checklists" both trigger it. The rule only narrows,
  so a forged fact can never widen what the agent does.
- **API.** `GatewayStreamClientConfig.hostContext` and `setHostContext(context | provider | null)`;
  `resolveHostContext()` returns what the next job would carry (after the provider
  runs and `null`/`undefined` facts are dropped) — handy in a test. Types:
  `HostContext`, `HostContextValue`, `HostContextProvider`.

## The activity section

The agent's working between two pieces of its answer is drawn as **one
collapsible row**. A run of consecutive thinking, tool calls and sub-agent runs —
a central-mode turn is often think, search the skills, load one, think, run a
tool, think — becomes a section, closed by default:

| | Header |
| --- | --- |
| While the run goes on | the newest step in words, with a spinner: `Running List Inspections`, `Searching skills… “inspections list”`, the last line of the thought being written, `Checklist Builder is working…` |
| Once done | a count of what happened: `Thought 4 times · searched 2 times · loaded a skill · ran List Inspections`, then `· 1 failed` if any step failed |
| Opened | every step, drawn exactly as on its own (thinking, tool rows with their actions, sub-agent blocks) |

- **What ends a run, and stays in view:** the answer's text, an approval waiting
  for the user, an error with its button, a notice. Text the agent writes between
  steps ("Let me check one more thing") splits the working into two sections.
- **A run of one step** is drawn as that step: a section around one row adds
  nothing.
- **Live** means a step in it is running, or it is the turn's newest item while
  the turn goes on (`isTurnComplete: false`). A thread loaded from history shows
  every section finished.
- An action placed on its step (`placement: 'step'`) is inside the section, one
  click away; `'turn'` and `'turn-end'` actions are hoisted to the turn's row as
  before, so a result the user must act on is never hidden.
- The header's words are the `activity*` labels, joined by `activitySeparator`
  with the first letter capitalised — so write them lower-case. One tool called
  several times reads `activityRanRepeated` ("ran web_search 3 times"), several
  tools `activityRanOther` ("ran 4 tools").
- Restyle through `.cb-activity` (`.is-running`, `.is-finished`, `.has-failed`),
  `.cb-activity-btn`, `.cb-activity-text`, `.cb-activity-detail` and
  `.cb-activity-items`.
- For a renderer of your own: `groupActivity(steps)` returns the items to draw
  (`single` or `activity`), `summarizeActivity(steps, labels, toolName?)` the
  finished header, `describeLatestActivity(steps, labels, toolName?)` the live one
  as `{ text, detail? }`.

## Meta-tool steps

A central-mode run finds and loads what it needs with four tools —
`search_tools`, `load_tool`, `search_skills`, `load_skill` — and their steps
render as one line saying what happened, not "Ran Load tools":

| Step | While it runs | Once done |
| --- | --- | --- |
| `search_tools` | Searching tools… “query” | Searched tools “query” |
| `load_tool` | Loading tools… a, b | Loaded tools · Web search, Generate image (1 refused) |
| `search_skills` | Searching skills… “query” | Searched skills “query” |
| `load_skill` | Loading skill… audit-planning | Loaded skill · Audit planning |

- They cover this app's own tools and skills as well as the platform's (see
  [Client skills and the host catalogue](#client-skills-and-the-host-catalogue)).
  When one has to ask the browser, the question rides on the meta-tool's own step,
  so it adds no row.
- "Loaded tools" lists what the platform loaded (`{ loaded, refused }`), named the
  way every tool row is: the host's `tools[slug].name`, then
  `DEFAULT_TOOL_NAMES`, then the slug title-cased. "Loaded skill" shows the
  skill's name, else its slug, else the slug the model asked for
  (`{ skill: { slug, name, source, uuid? }, tools_loaded, tools_unavailable }`;
  `source` is `platform` or `host`, and an app's skill has no `uuid`). What a load
  unloaded past the caps (`evicted`, `evicted_skills`) and a `note` that the app
  did not answer are in the details, not the row.
- **The generic row stays** for a failed call, for a load that loaded nothing,
  and for a meta-tool whose `tools` entry carries its own `name`. The details —
  arguments and result — expand on every row, meta or not.
- Inside an [activity section](#the-activity-section) every meta step is its own
  row, and it counts in the section's header ("searched 2 times · loaded a skill").
- Restyle them through `.cb-modern-tool-call--meta` (`.cb-modern-tool-meta-text`,
  `.cb-modern-tool-meta-detail`), or `.cb-tool-invocation--meta` on the legacy
  `ToolInvocation`. The words are the `meta*` labels:
  `metaLoadedTools: 'Loaded tools · {names}'`,
  `metaLoadedSkill: 'Loaded skill · {name}'`, `metaRefused: '{count} refused'`
  and the running/searched pairs.
- For a renderer of your own, `describeMetaTool(slug, status, args, result,
  labels, toolName?)` returns `{ text, detail? }`, or `null` where the generic
  row belongs; `isMetaTool(slug)` and `META_TOOL_SLUGS` say which steps qualify.

## Client skills and the host catalogue

A chat with no agent (central mode) sends none of this app's tool definitions with
a message. It sends `host_catalogue=true` instead, which tells the platform that
the browser answers questions about the app's tools and skills on the
conversation's stream. The model then finds and loads them with the same four
meta-tools it uses for the platform's own (platform ADR-018, "Host catalogue and
conversation-scoped loads"):

- `search_tools` and `search_skills` rank the platform's entries and the app's in
  one list — the app's by name and description only.
- `load_tool` loads an app tool by name. `load_skill` loads an app skill (its
  instructions) or a platform skill, and with either, every app tool whose
  `definition.skills` names that slug.
- **Loads belong to the conversation.** A later turn starts with what earlier
  turns loaded, until the conversation is compacted. At most a few tools and
  skills are loaded at once (platform configuration: `MAX_LOADED_TOOLS`,
  `MAX_LOADED_SKILLS`); past a cap the least recently used is unloaded — the load's
  result names it under `evicted` — and has to be loaded again to be used.

A turn pays only for what it loads, so an app can offer many tools without every
message carrying all of them.

```tsx
import type { ClientSkillDefinition } from 'iocloud-chatbot-library';

const SKILLS: ClientSkillDefinition[] = [{
  slug: 'manage_assets',
  name: 'Manage assets',
  description: 'Create, edit and retire the assets of a site. Load before changing one.',
  instructions: '# Managing assets\n1. List the site\'s assets first…',
}];

<ChatbotProvider
  client={client}
  skills={SKILLS}                        // memoise it, like `tools`
  tools={{
    list_assets: {
      run: ({ site }) => api.listAssets(site),
      definition: {
        description: 'List the assets of a site.',
        input_schema: { type: 'object', properties: { site: { type: 'string' } } },
        skills: ['manage_assets'],       // load_skill('manage_assets') loads it too
      },
    },
  }}
>
```

**A skill** (`ClientSkillDefinition`) is `slug` (`^[a-z0-9][a-z0-9_-]{0,99}$`),
`name` and `description` (non-empty, at most 1000 characters each) and
`instructions` (1 to 65 536 characters). The platform checks every answer and
leaves out an entry outside these bounds rather than failing the turn. It ships
with the app — a deploy changes it, with no sync step. When a platform skill has
the same slug, a user's or tenant's own skill wins over the app's, and the app's
wins over the partner's and the platform's. A tool's `definition.skills` may name
a platform skill as well as one of these. `client.setSkills(list)` and
`getSkills()` do the same without the prop.

**How the browser answers.** A request is a `client_tool_call` under the reserved
slug `__host_request` (`HOST_REQUEST_SLUG`), answered through the same
`tool-results` POST as any client tool, with one of four operations as its input:

| `tool_input` | Asked for | Answer |
| --- | --- | --- |
| `{ op: 'catalogue' }` | a turn's first search | `{ tools: [{ name, description, skills, requires_approval }], skills: [{ slug, name, description }] }` |
| `{ op: 'definitions', names }` | `load_tool` | `{ tools: [spec…], missing: [name…] }` |
| `{ op: 'skill', slug }` | `load_skill` | `{ skill: { slug, name, description, instructions } \| null, tools: [spec…] }` — `null` for a platform skill, whose app tools still come back |
| `{ op: 'all_definitions', shared_only }` | a run that offers its whole tool set — a thread an agent already owns, a sub-agent — once, at its start | `{ tools: [spec…] }`; `shared_only` keeps the `share_with_sub_agents` ones |

A spec is an agent-bound job's `client_tools` entry without `defer_loading`:
`{ name, description, input_schema, requires_approval, share_with_sub_agents, skills }`.

- **The client answers by itself.** There is nothing to wire. `answerHostRequest(input,
  tools, skills)` is exported for a host that builds its own client.
- **From what is registered now.** Each answer reads the `tools` and `skills` held
  when the request arrives, so tools a page registers come and go with the page.
- **It never runs a tool**, only describes them.
- **It cannot be shadowed.** The reserved slug is checked before the `tools` map is
  read, and the platform refuses it as a client tool's name (as it does the
  meta-tools' names and `run_sub_agent`).
- **No row**, live or after a reload: the meta-tool's own row shows the work. The
  raw frame still reaches `onEvent`.
- **When it cannot answer**, it posts `{ error }` instead: for an unknown operation,
  a malformed input, or an answer over the Gateway's 2 MB tool-result cap. The size
  is measured before sending, because the Gateway refuses a body that large
  without reading it, and the browser may see only a reset connection. The
  platform then goes on at once with its own half and tells the model the app did
  not answer. No answer within the platform's timeout (`HOST_REQUEST_TIMEOUT_S`,
  15 s by default) has the same effect. After a catalogue request goes
  unanswered, that job does not ask for the catalogue again.
- **While the user is in another conversation.** Switching away, or starting a new
  chat, stops showing a turn but does not stop the run, which may still search and
  load. A turn sent with `host_catalogue` keeps a *parked reader* on a connection
  of its own, which answers that turn's host requests and nothing else. It adds no
  row, opens no preview and runs no client tool. Those wait until the user comes
  back and the turn is replayed, as before. At most three parked readers are kept;
  when a fourth starts, the longest-parked one stops. A parked reader also stops at
  the turn's end, or once its stream token is 30 minutes old. A turn left running
  in another conversation when the page reloads gets no answers until that
  conversation is opened again.
- **On a replayed read** (after a reload, or on coming back to a conversation), a
  request is held for a second in case its answer is further down the replay.
  - A meta-tool's request is dropped when the meta-tool's result turns up.
  - A run's start-up fetch (`all_definitions`) has no result frame, so after a
    reload it is answered again. The Gateway refuses the duplicate with a harmless
    `409`.
  - A held client tool call waits for the whole replay to go quiet; a host request
    does not. Other jobs streaming in the same turn could put that quiet off past
    the platform's timeout.

  Another device has nothing to answer: the platform times the request out.

**A tool that is no longer there.** A tool loaded in an earlier turn stays loaded,
but the page that registered it may be gone when the model calls it. A
`client_tool_call` for a slug with no `run` here is answered
`{ error: "No handler for '<slug>' is registered in this application right now." }`,
so the model can say so — not, as before, a `{ status: 'previewed' }` success for a
call that never ran.

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

    // app-supplied — no backend row; the platform loads the schema from the
    // browser when the model needs the tool (sent with each job if agent-bound)
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
nothing acks the call with a `{ status: 'previewed' }` placeholder. A `run` that
throws or rejects is answered
`{ error: "'<slug>' failed in this application: <message>" }`, with the message cut
to 500 characters, so the model learns that the call failed. A call for a
slug with no `run` registered is answered with an error (see [A tool that is no
longer there](#client-skills-and-the-host-catalogue)).

### Fields

| Field | Applies to | Default | Meaning |
| --- | --- | --- | --- |
| `run` | client tools | — | Executes the call. `(input, context) => result` |
| `preview` | server tools | — | Receives the output. `(output, context) => void` |
| `definition` | client tools | — | `{ description, input_schema, requires_approval?, share_with_sub_agents?, skills? }`. In central mode the platform reads it from the browser when the model searches for or loads the tool ([host catalogue](#client-skills-and-the-host-catalogue)); with an agent bound it is sent as a `client_tools` entry on each job. Omit for a backend-registered tool. `share_with_sub_agents: true` lets a delegated sub-agent call it too — share a tool a worker needs to check its own result (a validator), not one that shows the user something; a handoff sub-agent receives every tool regardless. `skills` names the skills (the app's or the platform's) whose `load_skill` loads it. `defer_loading` is deprecated and does nothing: every app tool now loads on demand |
| `autoRun` | server tools | `true` | `false` makes the preview click-only |
| `show` | both | `true` | `false` offers no action control |
| `label` | both | `labels.openPreview` / `labels.openResult` | Button text. Ignored when `render` is given |
| `render` | both | — | Your own control instead of the built-in button. It gets `{ onAction, payload, result, toolName, label }`: `payload` is what `onAction` passes, `result` the call's parsed result once there is one — so a control for an action that already happened can offer its outcome (open the checklist an import saved) instead of running it again |
| `placement` | both | `'step'` | `'turn'` hoists the control out of a collapsed sub-agent block; `'turn-end'` also waits for the turn to finish |

**Every call is shown.** A tool called several times in one turn — a retry, a
fix pass, a second sub-agent run — renders every call, each with its own action
bound to its own `step_uuid`, and the turn-level row offers one control per
completed result. (Until 4.0, `showLastOnly` — on by default for one slug — hid
all but the last call and, with it, whole sub-agent runs.) A call reported as
completed whose result is an object with a set top-level `error` is drawn as
**failed** and offers no action: it is not a result. `settledToolStatus(status,
output)` is that rule, exported for a host that draws its own rows.

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

The files lists tint each row's tile by what it is: `--cb-kind-chart` (the
strong accent by default), `--cb-kind-table`, `--cb-kind-kpi`, `--cb-kind-report`,
`--cb-kind-image`, `--cb-kind-pdf`, `--cb-kind-spreadsheet` and `--cb-kind-file`
(the secondary text by default) — the icon in the hue, the tile a tint of it —
with darker hues in the light theme. Three more tokens serve them (2026-10-14):

- `--cb-accent-strong` — the accent where it must keep 3:1 against a light
  surface or a tint of itself: the chart tile's icon, the header's folder, the
  Saved mark's icon and the files lists' focus rings. The accent itself in the
  dark theme; mixed 70/30 toward the text in the light one, where `#6390f1`
  on its own tint is 2.7:1 (the mix is 4.3:1 there, 5.1:1 on white). It
  follows a rebranded `--cb-accent-primary`.
- `--cb-surface-selected` — the chosen option of a segmented control, above its
  `--cb-surface-hover` track.
- `--cb-border-selected` — that option's edge, 3:1 or more against the track
  (3.6:1 dark, 3.3:1 light), so the choice is seen by more than its fill and
  its weight.

A host that redefines these should keep those ratios: the files dialog's
colours are measured against WCAG from the tokens by
`src/components/Files/Files.styles.test.ts`.

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

## Migrating from 4.0 (4.1)

4.1.0 is additive (2026-10-14): nothing a 4.0 host passes changes meaning.

- **New:** rich blocks (`config.markdown`, `MarkdownContent`, the `Block*` types
  and the fence helpers) — see [Rich blocks](#rich-blocks-charts-tables-and-cards-in-an-answer);
  conversation files and artifacts (`header.files`, `sidebar.artifacts`,
  `ConversationFilesPanel`, `ArtifactsPanel`, `StorageClient`, `useStorageClient`,
  the actions `openFiles`, `closeFiles`, `openArtifacts`, `closeArtifacts`,
  `saveFile`, `saveArtifact`, `deleteArtifact`, the event `chat.files.changed`,
  the state `storageClient`, `isFilesPanelOpen`, `isArtifactsPanelOpen`,
  `filesRevision`) — see [Conversation files and artifacts](#conversation-files-and-artifacts);
  `MessageProps.jobUuid`, set on every reloaded message and on a live answer from
  its first frame.
- **Labels and icons:** new keys only (listed under [Labels](#labels) and
  [Icons](#icons)); a host that maps every key from its catalogue picks them up,
  in English until translated.
- **Looks different:** an answer is as wide as its row (it was 80%); the
  attachment viewer has a download button in its toolbar for every type and shows
  a CSV as a table; with `storageApiUrl` and `accessToken` the header has a files
  button and the sidebar an "Artifacts" entry — `header.files: false` and
  `sidebar.artifacts: false` remove them.
- **Moved:** the attachment viewer's rules from `MessageBubble.css` to
  `AttachmentViewer.css` (same class names); `Attachment` is still exported.
- `sidebar.items` now sit after the Artifacts entry rather than straight after
  "New chat".

**Review fixes before release (2026-10-14).** Still 4.1.0 and still additive;
what changed against the first cut, for a host that built on it:

- A fence named after an inherited member (` ```constructor `, ` ```toString `,
  ` ```__proto__ `) no longer crashes the transcript: renderers are looked up as
  the map's own entries (`rendererFor`), the resolved map has no prototype, a
  renderer without a renderable `component` is dropped with a warning, and a
  component React cannot render is caught by the block's own boundary.
- A block in a **running sub-agent** waits for its fence to close (skeleton)
  and is drawn once, told `streaming: true` until the turn — not only the
  sub-agent — ends. It used to receive every prefix of the spec, remounting per token.
- `width` is the body's content box from the first measurement on (it started
  24px too wide).
- A CRLF answer's block has the same `source` and `blockKey` as `extractBlocks`
  gives.
- `saveFile` sends `spec` the way the storage API keeps it (see the `spec` row
  above) instead of losing the whole save to a 422.
- A user's own message no longer draws blocks; its "Copy" is its text.
- Thumbnails load lazily and a few at a time; the provider's blob cache is
  bounded; the Artifacts panel keeps loaded pages when it reads again, and a
  "Load more" under way then is neither lost nor shown twice; and
  `listArtifacts` keeps `limit`, `offset` and `q` within the storage API's limits.
- The files and artifacts panels keep Tab inside, as their `aria-modal` says,
  and close on Escape only from inside the chat — not from the host's page
  around it (Artifacts has since become a view without a trap — below). A host that pressed Escape in its own page with a panel open no
  longer closes the panel. The expanded block's Tab trap no longer pulls focus
  out of a popup a renderer portals from it.
- `saveFile` / `saveArtifact` try a 404 `JOB_NOT_FOUND` again for 3 s: a Save
  pressed before the platform wrote the turn's row used to fail outright.

**Artifacts in place, and close buttons last (2026-10-14).** Still 4.1.0. From
using it in a host: "Artifacts" opened a modal over the chat, an artifact a
lightbox over that, and an expanded block's close button sat between Save and
"More actions". Now:

- **"Artifacts" is a view in the chat column, in place of the transcript and
  the composer** — no scrim, no dialog, no focus trap; a labelled region. The
  chat stays mounted behind it, hidden (a draft survives). An artifact opens in
  full in the same column, with "Back to artifacts"; the list keeps its search,
  filter, pages and scroll. See [Conversation files and artifacts](#conversation-files-and-artifacts).
- `newChat()`, `selectConversation(id)` and `setComposerText(text)` close the
  view — from the header or a host's button as well as the sidebar.
- `ArtifactsPanel` fills the element it is rendered in instead of covering its
  nearest positioned ancestor. `ChatContainer` hosts need nothing; a host with
  its own layout renders it where the view belongs — see
  [Your own layout](#your-own-layout). `openArtifacts`, `closeArtifacts` and
  `isArtifactsPanelOpen` keep their names and meaning (open = showing).
- `ChatContainer` wraps the transcript and the footer in
  `.cb-chat-stage > .cb-chat-view` (a grid cell the view shares). A host style
  that selected them as direct children of `.cb-chat-content` should drop the
  `>`; descendant selectors are unaffected.
- **Close buttons last:** the expanded block's header is now title, `toolbar`
  actions, "More actions", Close (Expand, unexpanded, keeps its place before
  the menu). The files panel, the views' headers and the attachment viewer
  already ended with theirs, and are tested to.
- Inside the library the attachment viewer is split into the loading, the
  drawing and the lightbox, so an opened artifact draws its file as the viewer
  does without the lightbox. `AttachmentViewerModal` is unchanged, and the
  parts are not public API.
- **New:** the label `backToArtifacts` ("Back to artifacts") and the icon
  `back`. While the view shows, no conversation in the sidebar is marked
  active; the "Artifacts" entry is, and the header's files button is hidden.
- **New state:** `artifactsOpenings`, which counts `openArtifacts()` calls:
  choosing "Artifacts" while the view shows takes it back to its list.
- The header's "More options" menu closes on Escape, and only it closes.
- An opened PDF is measured once it has loaded, so it is drawn at the
  column's width; a page wider than its box (in the lightbox) starts at its
  start edge instead of being cut off there.

**Saved and not saved (2026-10-14).** Still 4.1.0. From the user: "the
folder icon in the chat should show all the artifacts in the conversation,
not only the saved ones, but the artifacts tab should differentiate between
saved and not saved". Against the platform's job blocks (ADR-020, amended
2026-10-14). See [Saved and not saved](#saved-and-not-saved).

- **"Conversation files"** lists every block the answers drew beside the
  files, with All · Visuals · Files chips and a Saved / Not saved mark on each
  artifact (the *Artifact* / *Generated* badges are gone; "Generated" is in
  the row's details). A block opens drawn live in the expanded overlay and has
  "Show in chat"; a generated file nobody saved has Save. The panel is still a
  modal dialog.
- **"Artifacts"** lists saved and not-saved entries (`GET artifact-entries`
  instead of `GET artifacts`), with a segmented All · Saved · Not saved
  control above the kind chips, a mark on every row, and a not-saved block
  drawn live in the column. Delete is offered for artifacts only.
- **Changed:** `StorageClient.listConversationFiles` resolves to `{
  conversation_uuid, files, blocks }` (it was the files array);
  `ConversationFile` gains `saved`, `block_key` and `saved_from_uuid`;
  `chat.files.changed` gains `blockKey` and `savedFromUuid`; `extractBlocks`
  reads a fence the answer ended inside without the text's final line break,
  as the renderer draws it (its `blockKey` was different); the English
  `artifactsEmpty` now speaks of everything, not only what was saved; an
  expanded block drawn without `onClose` has no close button.
- **New:** `StorageClient.listArtifactEntries`, `getBlock`,
  `saveGeneratedFile`; `SaveFileOptions.blockKey`; the action
  `saveGeneratedFile`; `GatewayStreamClient.setBlockLanguages` /
  `getBlockLanguages` and its `blockLanguages` config; `ExpandedBlock`,
  `BlockDialog`, `scanBlocks`, `blockLanguagesOf`, `BLOCK_LANGUAGE_PATTERN`,
  `MAX_BLOCK_LANGUAGES`, `ARTIFACT_STATUSES`, `normalizeBlockRecord`,
  `normalizeArtifactEntry`; the types `ArtifactStatus`, `ArtifactEntry`,
  `ArtifactEntryQuery`, `ArtifactEntryPage`, `BlockRecord`, `BlockWithSource`,
  `ConversationContents`, `ScannedBlock`, `ExpandedBlockProps`; the labels and
  icons listed under [Labels](#labels) and [Icons](#icons); `data-block-key` /
  `data-job-uuid` on a drawn block's frame and `data-message-id` on a message
  row; a reloaded answer's `MessageProps.timestamp` (its job's start).
- **A host's renderer** should pass its `blockKey` prop to `saveArtifact`
  and resolve references from `props.conversationId` (a block drawn from
  Artifacts may be of another conversation than the open one).

**The conversation files dialog (2026-10-14).** Still 4.1.0. From the user:
"fix the design of the artifacts modal in the conversation, it should be
better" — it ran the full height of the chat with square edges, an empty
conversation one grey line at its top.

- **"Conversation files"** is a dialog sized to its content, centred and
  rounded (a bottom sheet in a narrow chat), with a subtitle (the
  conversation, the item and saved counts — also its `aria-describedby`), the
  filter as a segmented control with counts, "All" in Visuals and Files
  sections, rows with a kind-tinted tile, a details line led by the kind and a
  relative date, actions on hover or focus, rows' skeletons while loading, and
  an empty state with a heading and a hint. Behaviour is unchanged.
- **Shared with the Artifacts view** (its layout unchanged): the tile tinted
  by kind — a plain file's icon now says image, PDF or spreadsheet — and the
  Saved / Not saved pill (Saved in the accent, Not saved an outline in the
  muted text; it was a green outline and a dashed grey box). A row's title in
  another direction than the page's keeps to the page's start edge, and the
  header title's `match-parent` now has the `-webkit-` spelling Chromium reads.
- **New:** the labels `conversationFilesEmptyTitle`, `conversationFilesEmptyHint`,
  `filesItemsOne`/`Other`, `filesSavedCount`, `itemKind*` (eight); the icons
  `fileImage`, `filePdf`, `fileSpreadsheet`; the tokens `--cb-kind-*`.
  `conversationFilesEmpty` is now the Files filter's empty line.
- **Changed markup:** the filter is `.cb-files-segmented.cb-files-filter` with
  `.cb-files-segment` buttons (a `.cb-files-segment-label` and a
  `.cb-files-segment-count`), not `.cb-files-chip`; "All" renders
  `.cb-files-section` blocks (an `h3.cb-files-section-title` naming its `ul`);
  the empty state is `.cb-files-empty`; a row's tile carries `data-kind`.

**Review fixes to saved and not saved (2026-10-14).** Still 4.1.0.

- **The files panel** draws a block of the turn under way as still streaming
  (`ExpandedBlock` gains `streaming`), reading its answer as it grows: a
  report no longer offers its exports, or Save, over half an answer. It never
  shows another conversation's list after a conversation is picked beside it,
  and a failed read of the new one keeps none. A Save from a row puts focus on
  that row and is said aloud (a polite live region).
- **Artifacts:** a Save from a row follows the saved copy with focus (the list
  lists it as a new entry, at the top) and is said aloud; a Save in an entry
  open in full keeps the file on screen (it no longer downloads it again) with
  focus on the header's first action, and Back brings the saved row into
  view. Delete, armed, is the icon in a red ring in a narrow header, so the
  close button stays in the column. An empty list says "your search" only for
  a search typed (`noArtifactFilterResults` otherwise), and the Not saved
  filter's empty line no longer claims everything is saved. The kind chips are
  named `artifactKindFilter` ("Kind").
- **History:** a reloaded handoff child's answer belongs to the turn that
  handed over (its `MessageProps.jobUuid` is that turn's job), as live — its
  blocks were two rows in the files panel and read Not saved after a save.
- **StorageClient:** `offset` past 1,000,000 (`MAX_ARTIFACT_OFFSET`, new
  export) answers an empty page without a request; a NUL is dropped from `q`.
- **New labels:** `noArtifactFilterResults`, `artifactKindFilter`,
  `fileSavedAnnouncement`; the English `artifactsUnsavedEmpty` changed.
- Two known divergences between the drawn and the extracted key are
  documented ([Saved and not saved](#saved-and-not-saved)).

**Review fixes to the conversation files dialog (2026-10-14).** Still 4.1.0.
Each colour was measured against WCAG 2.x (4.5:1 for small text, 3:1 for
icons, rings and a control's state); `Files.styles.test.ts` now measures them
from the tokens and fails when a rule falls below.

- **Contrast, dark theme.** The filter's track and the empty state's circle
  were `--cb-surface-sunken`, 1.05:1 on the dialog — invisible; both are a
  lift now (1.2:1). The chosen option was the dialog's own colour behind a
  10% hairline; it is `--cb-surface-selected` edged by `--cb-border-selected`
  (3.6:1 on the track; 3.3:1 in the light theme, where the white chip's edge
  was 1.1:1). A count's pill sinks into the track (its 11px count 6.1:1, was
  4.4:1); every count is the secondary text, the tertiary having been 3.0:1.
  The empty state's folder and Not saved's dashed icon are the secondary text
  too (the tertiary was 2.5:1 on their lifted backgrounds).
- **Contrast, light theme.** The chart tile and the header's folder draw
  `--cb-accent-strong` (new): 4.3:1 on their tint, where the plain accent was
  2.7:1.
- **Focus.** The files lists' rings are `--cb-accent-strong`, solid (5.6:1 on
  the dark dialog, 5.1:1 on white, 3.4:1 or more on a hovered row or the
  filter); `--cb-border-focus` is the accent at 50%, about 2:1, and is left
  as it is for the rest of the chat.
- **Older browsers.** The rule keeping a busy row's actions shown (`:has()`)
  is its own: in one list with `:hover` and `:focus-within`, a browser without
  `:has()` (Firefox before 121) dropped all three, and the actions stayed
  invisible. The opened artifact's details line (`.cb-artifact-detail-meta-text`)
  has the `-webkit-match-parent` Chromium reads.
- **Right-to-left.** The error box and the filter's options pad by logical
  sides.
- **Motion.** The scrim only fades (it used `cb-fade-in`, which also slides,
  and left a strip of the chat bare as it opened); the dialog alone rises.
- **A narrow chat** (the floating card, a docked panel) keeps each row's date
  and size: the pill is its icon and the details wrap between parts, each
  part with its dot in a `.cb-file-meta-part` (new markup, every list).
- **Dates** count whole units (`formatRelativeDate`): 59.6 minutes is "59
  minutes ago", not "60 minutes ago"; 23.7 hours "23 hours ago"; 6.8 days "6
  days ago", never "7 days ago" a moment before the short date.
- **Label:** `disclaimer` reads "…Verify results." (it read "Very results.").

## Migrating from 3.x

4.0 removes the agent picker: the server picks the agent (central mode) unless
a screen binds one on its client. 3.1.0 was never published; its changes ship
in 4.0.

| 3.x | 4.0 |
| --- | --- |
| `agents` and `agentsLoading` on `ChatbotProvider` / `ChatApp` | none — the server picks |
| `agentId` (controlled selection) and `onAgentChange` | none — the server picks. A screen that must use one agent: `new GatewayStreamClient({ agentId })` or `client.setAgentId(id)` before the provider first sees the client — see [A fixed agent for one screen](#a-fixed-agent-for-one-screen) |
| `useChatActions().setAgentId(id)` | `client.setAgentId(id)`; it changes the jobs sent after it, not the tools menu |
| `useChatState(s => s.agents)`, `s.agentId`, `s.agentsLoading` | none; `client.getAgentId()` reads the binding |
| `AgentSwitcher`, `AgentSidebar` and their types (`AgentSwitcherProps`, `AgentSidebarProps`, `AgentSidebarItem`) | none — the server picks; a host that still lists agents builds its own from `client.listAgents()` |
| `config.composer.agentSwitcher`, `config.composer.bottomSection` | none: nothing else sat in that strip or slot |
| `labels.agentAuto`, `selectAgent`, `switchAgent` | none |
| The hard-coded "Assistant" over a live reply | `labels.assistantName` |
| `agentsLoading` holding the send button and turning a welcome prompt into composer text | none — nothing to wait for; prompts always send |
| The agent restored from `sessionStorage` (`chatbot-ui.active-session`) | none — not persisted; bind it on each screen's client. A stored value is ignored and removed on the next write |
| Tool switches stored per agent (`chatbot-ui:enabled-tools:<agent>` / `…:__agentless__`) | one key, `chatbot-ui:enabled-tools`; the agentless selection is read once and carried over |
| `.cb-composer-bottom-row`, `.cb-composer-footer-agent`, `.cb-agent-switcher-*`, `.cb-agent-sidebar-*` | removed with the markup |
| Meta-tool steps drawn as "Ran Search tools", "Ran Load skill" | compact rows — see [Meta-tool steps](#meta-tool-steps); new labels `meta*`, new exports `describeMetaTool`, `isMetaTool`, `META_TOOL_SLUGS` |
| Consecutive tool calls folded into "Ran N commands" (`.cb-modern-tool-group`, `.cb-modern-group-*`), thinking and meta-tool steps each on a row of their own | one [activity section](#the-activity-section) per run of thinking, tool calls and sub-agents (`.cb-activity*`); new labels `activity*`, new exports `groupActivity`, `summarizeActivity`, `describeLatestActivity` |
| `showLastOnly` on a tool entry (and its default for `generate_checklist`) | none — every call is shown, each action on its own step; drop the key. A completed call whose result has a top-level `error` is drawn as failed (`settledToolStatus`) |
| Every `definition` sent as `client_tools` with every job | only when the client is bound to an agent. A central-mode job sends `host_catalogue=true` and the browser answers the platform's host requests — see [Client skills and the host catalogue](#client-skills-and-the-host-catalogue). Needs a platform that supports the host catalogue: an older Gateway ignores the flag, and its central-mode runs would see none of the app's tools |
| A `client_tool_call` for a slug with no `run` acked `{ status: 'previewed' }` | answered `{ error: "No handler for '<slug>' is registered in this application right now." }` |
| A `run` that threw or rejected acked `{ status: 'previewed' }` | answered `{ error: "'<slug>' failed in this application: <message>" }`, with the message cut to 500 characters |
| Leaving a conversation (switching, or "New chat") stopped reading its turn | still nothing is shown, previewed or run there, but a turn sent with `host_catalogue` keeps one extra connection open, at most three in all, to answer its host requests — see [Client skills and the host catalogue](#client-skills-and-the-host-catalogue) |

`GatewayStreamClient` keeps `agentId`, `setAgentId`, `getAgentId`,
`listAgents()` and `ChatAgent`.

New in 4.0, additive: `hostContext` / `setHostContext` (see [Telling the agent
about the user](#telling-the-agent-about-the-user-host-context));
`share_with_sub_agents` and `skills` on a client tool's `definition`; the
provider's `skills` prop, `ClientSkillDefinition`, `client.setSkills` /
`getSkills`, and for a host with its own client or transcript `HOST_REQUEST_SLUG`,
`isHostRequestSlug`, `answerHostRequest` and their types (`ClientToolSpec`,
`HostRequest`, `HostRequestAnswer`, `HostCatalogueTool`, `HostCatalogueSkill`).
`defer_loading` on a `definition` is deprecated: with the host catalogue every app
tool loads on demand.

Fixed in 4.0:

- **Legacy tool rows.** `MessageBubble`'s `toolInvocation` path handed
  `ToolInvocation` the display name instead of the slug, so a web search there
  never got its results view. It passes the slug now, which is also how a
  meta-tool is recognised.

## Migrating from 2.x

| 2.x | 3.0 |
| --- | --- |
| `useChatbot()` / `useChatbotContext()` (the whole context, re-rendered on every token) | `useChatState(selector)` to read, `useChatActions()` to act |
| `useChatMessages()`, `useChatConversations()`, `useChatComposer()` | `useChatState(s => s.messages)` etc. These hooks re-rendered on every change too. |
| `isOpen`, `onOpen`, `onClose` | `open`, `defaultOpen`, `onOpenChange` |
| `ChatContainer` `isDrawerOpen` / `onDrawerOpenChange` | provider `sidebarOpen` / `defaultSidebarOpen` / `onSidebarOpenChange` |
| `headerActions`, `brand` | `config.header.actions`, `config.header.brand` |
| `show_tool_toggles` | `config.composer.tools` |
| `onManageMemory`, `onViewUsage` | `config.header.menuItems` |
| "Switch view" (cycled to the next mode) | one "Switch view" entry that lists the views in place; `config.header.views` / `allowedViews`; `labels.switchView`, `viewFloating` / `viewSidebar` / `viewFullscreen`, `icons.switchView`, `viewFloating` / `viewSidebar` / `viewFullscreen` |
| `ChatbotUIConfig` | `ChatbotConfig`; the old name is a deprecated alias |
| `contextSelector`, `onContextChange` | removed; nothing read them |
| Built-in welcome prompts, cards and privacy badges | none by default; pass them in `config` |
| `Composer` data props (`onSend`, `tools`, `usage`, …) and `isRunning` | read from the provider; `disabled` and `placeholder` remain |
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
