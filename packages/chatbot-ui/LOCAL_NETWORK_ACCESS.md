# Local Network Access (Chromium 142+)

## The symptom

The host application shows a permission prompt and the chat stops:

> **Access other apps and services on this device** — Block / Allow

Inside an iframe there is often no prompt at all, just a CORS-shaped console
error:

```
Access to fetch at 'http://localhost:8001/api/v1/...' from origin
'https://host.example.com' has been blocked by CORS policy
```

## The cause

Chromium 142 (Chrome, Edge, Brave, Opera; Android included) enforces **Local
Network Access**. A request from a *public* page to a **loopback** address
(`localhost`, `127.0.0.1`, `[::1]`) or a **private** one (`10.*`, `192.168.*`,
`172.16–31.*`, `169.254.*`, `*.local`) now needs a user permission. Chrome's
site settings call it *Apps on device*
(`chrome://settings/content/localNetworkAccess`).

So the prompt means the chat UI was handed a local-network URL. In this codebase
that comes from one of:

| Source | Where |
|---|---|
| `storageApiUrl` / `streamUrl` props on `<App>` | whatever the host app passes |
| `gatewayUrl` on `GatewayStreamClient` | whatever the host app passes |
| `apiBaseUrl` on `<ChatbotProvider>` | **used to default to `http://localhost:8001/api`** — removed; it now defaults to the page's own origin |
| `AuthClient.configure(brokerUrl)` | host app |

The removed default was the trap: a host that never passed `storageApiUrl` aimed
every attachment fetch at *the viewer's own phone*, which reads as local network
access and prompts.

## Fix 1 — the one you almost certainly want

Give the chat UI **public, HTTPS URLs**. No permission is involved, no prompt
appears, nothing has to be delegated through the iframe chain.

```env
VITE_API_BASE_URL=https://gateway.example.com
VITE_STORAGE_API_BASE_URL=https://storage.example.com
```

`localhost:8001` / `localhost:8003` are development defaults. They cannot work
from a phone regardless of this permission — `localhost` on the phone is the
phone, not your server.

## Fix 2 — when the target really is on the device or the LAN

Both halves are required. Either one alone still fails.

### a. Opt the requests in (this side)

Env var in the **host application** — not in the library, which ships
pre-bundled, so a `VITE_` variable compiled into it would freeze at
library-publish time:

```env
VITE_ALLOW_LOCAL_NETWORK_ACCESS=true
```

```tsx
// Vite host
<App
  storageApiUrl={STORAGE_API_BASE_URL}
  allowLocalNetworkAccess={import.meta.env.VITE_ALLOW_LOCAL_NETWORK_ACCESS === 'true'}
/>
```

```ts
// Or once at start-up, from any config source (CRA, runtime config, …)
import { configureLocalNetworkAccess } from 'iocloud-chatbot-library';

configureLocalNetworkAccess({
  enabled: process.env.REACT_APP_ALLOW_LOCAL_NETWORK_ACCESS === 'true',
});
```

This annotates local-network requests with `targetAddressSpace`, which exempts
them from the mixed-content check — that is what lets an `https:` page *reach*
the permission prompt instead of being stopped before it. It does **not** grant
the permission.

### b. Delegate the permission down the iframe chain (host side)

The Permissions Policy default allowlist is `self`, so a cross-origin iframe has
the permission only if **every** frame in the chain carries it:

```html
<iframe src="https://chat.example.com"
        allow="local-network-access; loopback-network; local-network">
</iframe>
```

Chromium renamed the token in 145 (`loopback-network` / `local-network`);
listing all three is safe, as unknown tokens are ignored. Miss it on one nested
frame and the request fails silently with no prompt.

Note some embedding platforms strip `allow` from iframes they render (SharePoint
does). Where that happens, Fix 1 is the only option.

### c. Managed fleets

Chrome enterprise policy can pre-grant, so managed devices never see the prompt:
`LocalNetworkAccessAllowedForUrls` / `LocalNetworkAccessBlockedForUrls`.

## Testing it

`chrome://flags/#local-network-access-check` → **Enabled (Blocking)** reproduces
the 142 behaviour on an older build. Note that a page served *from* localhost
reaching localhost is same-space and never prompts — the prompt needs a public
origin, so test from the deployed host, not from `vite dev`.

## Implementation

`src/common/localNetwork.ts` — `netFetch` (used by every `fetch` in this
package), `configureLocalNetworkAccess`, `addressSpaceOf`, `isLocalNetworkUrl`,
and `warnIfLocalNetworkUrl`, which logs once per base URL when a configured URL
will trip this, naming the setting that produced it.
