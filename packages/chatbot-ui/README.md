# iocloud-chatbot-library

React chat UI for the AI-EcoSystem gateway. Streams a run over SSE, renders the
agent's steps, and lets the host application take part in tool calls.

```tsx
import { App as ChatApp, GatewayStreamClient } from 'iocloud-chatbot-library';
```

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
|---|---|---|
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
|---|---|---|---|
| `run` | client tools | — | Executes the call. `(input, context) => result` |
| `preview` | server tools | — | Receives the output. `(output, context) => void` |
| `definition` | client tools | — | `{ description, input_schema, requires_approval? }`, advertised as a `client_tools` entry on each job. Omit for a backend-registered tool |
| `autoRun` | server tools | `true` | `false` makes the preview click-only |
| `show` | both | `true` | `false` offers no action control |
| `label` | both | `'Open Preview'` / `'Open Result'` | Button text. Ignored when `render` is given |
| `render` | both | — | Your own control instead of the built-in button |
| `placement` | both | `'step'` | `'turn'` hoists the control out of a collapsed sub-agent block; `'turn-end'` also waits for the turn to finish |

`placement` governs the *button*. To stop a preview opening itself the moment the
result lands, pair it with `autoRun: false` — including on a reload, where the
once-per-step guard cannot survive the page load.

### Imperatively

The same map can be set on the client instead of passed as a prop:

```ts
client.setTools({ generate_checklist: { preview: openChecklist } });
```

## Migrating from 1.x

Three props became one. The shapes map mechanically:

| 1.x | 2.0 |
|---|---|
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

`AppProps` is documented in TSDoc on
[`src/components/App/App.tsx`](src/components/App/App.tsx). See also
[`LOCAL_NETWORK_ACCESS.md`](LOCAL_NETWORK_ACCESS.md) for reaching a loopback or
private-network gateway from Chromium 142+, and
`services/tool-workers/app/tools/frontend_bridge/README.md` in the platform repo
for the seven kinds of tool and which of them need an entry here.
