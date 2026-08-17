import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import html2canvas from 'html2canvas'
import {
    App as ChatApp,
    GatewayStreamClient,
    ChatMode,
    AgentSidebarItem,
    ExternalToolConfig,
    ToolActionConfig,
} from '@chatbot-ui/core'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8001';
const STORAGE_API_BASE_URL = import.meta.env.VITE_STORAGE_API_BASE_URL || 'http://localhost:8003';
const STATIC_TOKEN = import.meta.env.VITE_ACCESS_TOKEN || '';
const MODEL_ID = import.meta.env.VITE_MODEL_ID || 'gpt-5-mini';

// Stands in for whatever the host application's routes and records actually are.
// `read_page_context` reports the current one and `navigate_app_route` moves
// between them, which is enough to exercise both tools end to end.
const DEMO_RECORDS: Record<string, { title: string; body: string }> = {
    '/dashboard': { title: 'Dashboard', body: 'Two customers, 288 seats in total.' },
    '/customers/1': { title: 'Acme Ltd', body: 'Enterprise plan, 240 seats, renews in March.' },
    '/customers/2': { title: 'Globex', body: 'Growth plan, 48 seats, renews in September.' },
};

function App() {
    const [mode, setMode] = useState<ChatMode>('sidebar');
    const [isOpen, setIsOpen] = useState(true);
    const [isEmbedded, setIsEmbedded] = useState(false);
    const [client, setClient] = useState<GatewayStreamClient | null>(null);
    const clientRef = useRef<GatewayStreamClient | null>(null);

    // Agent list fetched from gateway
    const [agentItems, setAgentItems] = useState<AgentSidebarItem[]>([]);
    const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

    // The app's own "current screen", read by read_page_context and changed by
    // navigate_app_route.
    const [demoRoute, setDemoRoute] = useState('/dashboard');
    // Last checklist a result previewer handed us. See `resultPreviewers` below.
    const [checklistPreview, setChecklistPreview] = useState<any>(null);

    // --- Client tool: get_frontend_context -----------------------------------
    // A dynamic client tool defined entirely here in the frontend. Its schema is
    // sent to the gateway as `client_tools` on every job; when the agent calls
    // it, a modal opens, the user types a value, and we return it as the tool
    // result. `resolve` is the Promise the chatbot client awaits before it acks
    // the suspended job — calling it resumes the agent with our answer.
    const [contextRequest, setContextRequest] = useState<
        { prompt: string; resolve: (value: unknown) => void } | null
    >(null);
    const [contextValue, setContextValue] = useState('');

    const requestFrontendContext = useCallback((data: { prompt?: string }): Promise<unknown> => {
        const prompt =
            typeof data?.prompt === 'string' && data.prompt.trim()
                ? data.prompt
                : 'Please provide the requested context';
        setContextValue('');
        return new Promise<unknown>(resolve => {
            setContextRequest({ prompt, resolve });
        });
    }, []);

    const submitContext = useCallback(() => {
        setContextRequest(prev => {
            prev?.resolve({ context: contextValue });
            return null;
        });
    }, [contextValue]);

    const cancelContext = useCallback(() => {
        setContextRequest(prev => {
            // Still resolve so the agent isn't left waiting on a suspended job.
            prev?.resolve({ context: null, cancelled: true });
            return null;
        });
    }, []);

    // --- Client tool: read_page_context (backend-registered, ungated) --------
    // Row 3 of the tool matrix. `read_page_context` has a `quota.tools` row
    // (services/tool-workers/app/tools/frontend_bridge), so we register a
    // callback by slug and pass NO `definition` — the schema already exists
    // server-side and the model is offered it from there.
    //
    // Returns immediately with no user interaction: its execution profile leaves
    // `requires_approval` off, because an agent that had to ask permission to see
    // the page the user is already looking at would be unusable.
    const readPageContext = useCallback((data: { scope?: string }) => {
        const scope = data?.scope ?? 'all';
        const selection = window.getSelection()?.toString() ?? '';
        const screen = {
            route: demoRoute,
            title: document.title,
            mode,
            embedded: isEmbedded,
        };
        if (scope === 'screen') return { screen };
        if (scope === 'selection') return { selection };
        if (scope === 'record') return { record: DEMO_RECORDS[demoRoute] ?? null };
        return { screen, selection, record: DEMO_RECORDS[demoRoute] ?? null };
    }, [demoRoute, mode, isEmbedded]);

    // --- Client tool: capture_page_screenshot (backend-registered, ungated) --
    // Also row 3. Renders the current view to a data URL with html2canvas.
    // `selector` narrows the capture, which is worth honouring: a smaller image
    // is cheaper for the model to interpret and leaks less of the page.
    const capturePageScreenshot = useCallback(async (data: { selector?: string }) => {
        const target = data?.selector
            ? document.querySelector<HTMLElement>(data.selector)
            : document.body;
        if (!target) {
            // Returned as a result rather than thrown: the agent can pick a
            // different selector, but only if it is told the first one missed.
            return { error: `No element matched selector '${data.selector}'.` };
        }
        const canvas = await html2canvas(target, { logging: false, useCORS: true });
        return {
            image_data_url: canvas.toDataURL('image/png'),
            width: canvas.width,
            height: canvas.height,
            captured: data?.selector ?? 'body',
        };
    }, []);

    // --- Client tool: navigate_app_route (backend-registered, GATED) ---------
    // Row 4. Identical wiring to the two above — the only difference is that its
    // execution profile ships with `requires_approval` on, so the orchestrator
    // holds the call and chatbot-ui renders a confirmation card first. By the
    // time this callback runs, the user has already said yes.
    //
    // Note what is NOT here: no confirm dialog of our own. Asking again would be
    // a second gate the platform knows nothing about, and the two could disagree.
    const navigateAppRoute = useCallback((data: { route?: string; reason?: string }) => {
        const route = data?.route ?? '';
        if (!(route in DEMO_RECORDS)) {
            return { error: `Unknown route '${route}'.`, known_routes: Object.keys(DEMO_RECORDS) };
        }
        setDemoRoute(route);
        return { navigated: route };
    }, []);

    // --- Client tool: query_customer_api (app-defined, GATED) ---------------
    // Row 7. Defined entirely here: no `quota.tools` row, no migration. The
    // schema travels with each job in `client_tools`, and `requires_approval` on
    // the definition is how an app gates its own tool — there is no policy for an
    // administrator to resolve, so the declaring app is the only authority.
    //
    // Gated because it reaches a system the platform cannot see, using the
    // user's own session, and the query is chosen by the model.
    const queryCustomerApi = useCallback(async (data: { resource?: string }) => {
        const resource = (data?.resource ?? '').trim();
        if (!resource) return { error: "'resource' is required." };
        // Stands in for a call to the host application's own backend, carrying
        // whatever credentials that app already holds in the browser.
        await new Promise(resolve => setTimeout(resolve, 400));
        return {
            resource,
            fetched_at: new Date().toISOString(),
            rows: [
                { id: 1, name: 'Acme Ltd', plan: 'enterprise', seats: 240 },
                { id: 2, name: 'Globex', plan: 'growth', seats: 48 },
            ],
        };
    }, []);

    // Client-side tools passed to the chat app. Entries WITH a `definition` are
    // advertised to the agent via the `client_tools` channel on each job; entries
    // WITHOUT one are backend-registered tools whose schema already exists in
    // `quota.tools` and which we are only supplying the local handler for.
    const externalTools = useMemo<Record<string, ExternalToolConfig>>(() => ({
        get_frontend_context: {
            definition: {
                description:
                    'Ask the user, through a modal in the app UI, for a piece of context ' +
                    'that only exists on the frontend (a local value, their current ' +
                    'selection, or any detail the backend cannot see). Returns whatever ' +
                    'the user types. Use this whenever you need information you can only ' +
                    'get from the user interactively.',
                input_schema: {
                    type: 'object',
                    properties: {
                        prompt: {
                            type: 'string',
                            description:
                                'The question or label to show the user in the modal, ' +
                                'e.g. "What is the name of your current project?"',
                        },
                    },
                    required: ['prompt'],
                },
            },
            callback: requestFrontendContext,
        },
        query_customer_api: {
            definition: {
                description:
                    'Look up records in this application\'s own customer API, which the ' +
                    'platform has no access to. Use when the user asks about their data ' +
                    'in this app. The user is asked to approve each lookup.',
                input_schema: {
                    type: 'object',
                    properties: {
                        resource: {
                            type: 'string',
                            description:
                                'Resource path to query, e.g. "customers" or ' +
                                '"customers/240/invoices".',
                        },
                    },
                    required: ['resource'],
                },
                // The app gates its own tool. Backend-registered tools use their
                // execution profile for this instead (see frontend_bridge).
                requires_approval: true,
            },
            callback: queryCustomerApi,
        },
        // Backend-registered — deliberately no `definition`.
        read_page_context: { callback: readPageContext },
        capture_page_screenshot: { callback: capturePageScreenshot },
        navigate_app_route: { callback: navigateAppRoute },
    }), [
        requestFrontendContext,
        queryCustomerApi,
        readPageContext,
        capturePageScreenshot,
        navigateAppRoute,
    ]);

    // --- Result previewers: server tool OUTPUT ------------------------------
    // Not the same channel as `external_tools`, and not interchangeable with it.
    // `generate_checklist` is a `kafka` tool: it runs in a worker, so it never
    // emits `client_tool_call` and can never reach an external-tool callback.
    // Its result arrives on `tool_result`, which is what a previewer subscribes
    // to — registering it above would hand us the arguments the model invented
    // instead of the checklist it produced.
    const resultPreviewers = useMemo(() => ({
        generate_checklist: (checklist: any) => setChecklistPreview(checklist),
    }), []);

    // --- Action presentation, per tool -------------------------------------
    // Registering a handler is what makes a tool *work*; this is what decides
    // whether its completed step offers a button. The two are separate because
    // they answer different questions — the three bridge tools below all need
    // handlers, and none of them has anything a user would re-open.
    const toolActions = useMemo<Record<string, ToolActionConfig>>(() => ({
        // Silent data tools: they hand a value to the agent and that is the whole
        // interaction. A button here would invite the user to re-run something
        // with no visible effect.
        read_page_context: { show: false },
        capture_page_screenshot: { show: false },
        navigate_app_route: { show: false },
        query_customer_api: { show: false },

        // A custom control instead of the built-in button. `payload` is the
        // checklist itself, so the label can name what it will open rather than
        // saying "Open Result" for everything.
        generate_checklist: {
            render: ({ onAction, payload }) => (
                <button
                    onClick={onAction}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                        border: '1px solid #4CAF50', background: 'rgba(76,175,80,0.12)',
                        color: '#4CAF50', fontSize: 13, fontWeight: 600,
                    }}
                >
                    ☑ Open “{payload?.title ?? 'checklist'}”
                    {Array.isArray(payload?.items) && (
                        <span style={{ opacity: 0.7, fontWeight: 400 }}>
                            {payload.items.length} items
                        </span>
                    )}
                </button>
            ),
        },
    }), []);

    const buildClient = useCallback((token: string) => {
        const c = new GatewayStreamClient({ gatewayUrl: API_BASE_URL, token: token || undefined, modelId: MODEL_ID });
        clientRef.current = c;
        setClient(c);
        return c;
    }, []);

    // --- Client init ----------------------------------------------------------
    useEffect(() => {
        buildClient(STATIC_TOKEN);
    }, [buildClient]);

    // --- Fetch agents from gateway --------------------------------------------
    const fetchAgents = useCallback(async (token: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/v1/user/agents`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return;
            const json = await res.json();
            const raw: { uuid: string; name: string; description?: string }[] =
                json?.data?.agents ?? [];

            setAgentItems(prev => {
                const currentActiveId = prev.find(a => a.active)?.id ?? raw[0]?.uuid ?? null;
                return raw.map(a => ({
                    id: a.uuid,
                    label: a.name,
                    active: a.uuid === currentActiveId,
                    onClick: () => switchAgent(a.uuid),
                }));
            });

            if (raw.length > 0 && !activeAgentId) {
                switchAgent(raw[0].uuid);
            }
        } catch (err) {
            console.error('Failed to fetch agents:', err);
        }
    }, [activeAgentId]);

    useEffect(() => {
        if (client && STATIC_TOKEN) fetchAgents(STATIC_TOKEN);
    }, [client, fetchAgents]);

    // --- Agent switching ------------------------------------------------------
    const switchAgent = useCallback((agentId: string) => {
        clientRef.current?.setAgentId(agentId);
        setActiveAgentId(agentId);
        setAgentItems(prev =>
            prev.map(a => ({ ...a, active: a.id === agentId, onClick: () => switchAgent(a.id) }))
        );
        clientRef.current?.reset?.();
    }, []);

    // --- Demo controls --------------------------------------------------------
    const demoControls = (
        <div style={{
            position: isEmbedded ? 'relative' : 'absolute',
            top: isEmbedded ? 0 : 10,
            left: isEmbedded ? 0 : 10,
            zIndex: 1,
            background: 'rgba(255,255,255,0.9)',
            padding: 10,
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            flexWrap: 'wrap' as const,
        }}>
            <span style={{ fontWeight: 'bold', marginRight: 5 }}>Mode:</span>
            <button onClick={() => { setMode('floating'); setIsOpen(true); }} style={{ cursor: 'pointer', padding: '4px 8px' }}>Floating</button>
            <button onClick={() => { setMode('sidebar'); setIsOpen(true); }} style={{ cursor: 'pointer', padding: '4px 8px' }}>Sidebar</button>
            <button onClick={() => { setMode('fullscreen'); setIsOpen(true); }} style={{ cursor: 'pointer', padding: '4px 8px' }}>Fullscreen</button>
            <button onClick={() => setIsOpen(!isOpen)} style={{ cursor: 'pointer', padding: '4px 8px' }}>Toggle</button>
            <button
                onClick={() => setIsEmbedded(!isEmbedded)}
                style={{ cursor: 'pointer', padding: '4px 8px', background: isEmbedded ? '#4CAF50' : undefined, color: isEmbedded ? '#fff' : undefined }}
            >
                {isEmbedded ? 'Embedded' : 'Overlay'}
            </button>
        </div>
    );

    // The app's "current screen". `read_page_context` reports it,
    // `navigate_app_route` changes it, and `capture_page_screenshot` can be
    // pointed at `#demo-screen` to capture just this region.
    const currentScreen = (
        <div
            id="demo-screen"
            style={{
                marginTop: 20, padding: 16, borderRadius: 10, background: '#f7f7f7',
                color: '#111', maxWidth: 560,
            }}
        >
            <div style={{ fontSize: 12, opacity: 0.6, fontFamily: 'monospace' }}>{demoRoute}</div>
            <h3 style={{ margin: '6px 0' }}>{DEMO_RECORDS[demoRoute]?.title ?? 'Unknown'}</h3>
            <p style={{ margin: 0 }}>{DEMO_RECORDS[demoRoute]?.body ?? ''}</p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {Object.keys(DEMO_RECORDS).map(route => (
                    <button
                        key={route}
                        onClick={() => setDemoRoute(route)}
                        style={{
                            cursor: 'pointer', padding: '4px 8px', borderRadius: 6,
                            border: '1px solid #ccc',
                            background: route === demoRoute ? '#4CAF50' : '#fff',
                            color: route === demoRoute ? '#fff' : '#333',
                        }}
                    >
                        {route}
                    </button>
                ))}
            </div>
        </div>
    );

    // Where a *result previewer* lands, as opposed to a client tool. The agent
    // never waits on this: `generate_checklist` already finished in a worker and
    // the run has moved on, so this is a display of what came back.
    const checklistPanel = checklistPreview && (
        <div
            style={{
                marginTop: 20, padding: 16, borderRadius: 10, background: '#fff',
                color: '#111', maxWidth: 560,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0 }}>{checklistPreview.title ?? 'Checklist'}</h3>
                <button onClick={() => setChecklistPreview(null)} style={{ cursor: 'pointer' }}>
                    Close
                </button>
            </div>
            <p style={{ fontSize: 13, opacity: 0.75 }}>{checklistPreview.description}</p>
            <ol style={{ paddingLeft: 20, fontSize: 14 }}>
                {(checklistPreview.items ?? []).slice(0, 25).map((item: any, index: number) => (
                    <li key={index}>{item.title ?? item.label ?? JSON.stringify(item)}</li>
                ))}
            </ol>
            <div style={{ fontSize: 12, opacity: 0.6 }}>
                {(checklistPreview.items ?? []).length} items in the result
            </div>
        </div>
    );

    const contextModal = contextRequest && (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            onClick={cancelContext}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: '#fff', borderRadius: 12, padding: 24, width: 'min(420px, 90vw)',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.35)', display: 'flex', flexDirection: 'column', gap: 14,
                }}
            >
                <div style={{ fontWeight: 600, fontSize: 16, color: '#111' }}>
                    The assistant needs some context
                </div>
                <label style={{ color: '#333', fontSize: 14 }}>{contextRequest.prompt}</label>
                <input
                    autoFocus
                    value={contextValue}
                    onChange={e => setContextValue(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') submitContext();
                        if (e.key === 'Escape') cancelContext();
                    }}
                    placeholder="Type your answer…"
                    style={{
                        padding: '10px 12px', fontSize: 14, border: '1px solid #ccc',
                        borderRadius: 8, outline: 'none',
                    }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        onClick={cancelContext}
                        style={{ cursor: 'pointer', padding: '8px 14px', borderRadius: 8, border: '1px solid #ccc', background: '#f5f5f5' }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={submitContext}
                        disabled={!contextValue.trim()}
                        style={{
                            cursor: contextValue.trim() ? 'pointer' : 'not-allowed',
                            padding: '8px 14px', borderRadius: 8, border: 'none',
                            background: contextValue.trim() ? '#4CAF50' : '#a5d6a7', color: '#fff', fontWeight: 600,
                        }}
                    >
                        Send
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', height: '100vh', width: '100vw', fontFamily: 'sans-serif' }}>
            {contextModal}
            {isEmbedded ? (
                <>
                    <main style={{ flex: 1, overflow: 'auto', background: '#333', padding: 20 }}>
                        {demoControls}
                        <div style={{ color: '#ccc', marginTop: 20 }}>
                            <h2 style={{ color: '#fff' }}>Main Content Area</h2>
                            <p>This content shrinks when the chat panel opens.</p>
                        </div>
                        {currentScreen}
                        {checklistPanel}
                    </main>
                    <ChatApp
                        client={client}
                        mode={mode}
                        isOpen={isOpen}
                        embedded={true}
                        onClose={() => setIsOpen(false)}
                        onOpen={() => setIsOpen(true)}
                        userName="Ibaa"
                        storageApiUrl={STORAGE_API_BASE_URL}
                        accessToken={STATIC_TOKEN || null}
                        agents={agentItems}
                        agentId={activeAgentId}
                        external_tools={externalTools}
                        result_previewers={resultPreviewers}
                        tool_actions={toolActions}
                    />
                </>
            ) : (
                <div style={{ flex: 1, background: '#333', position: 'relative', overflow: 'auto', padding: 20 }}>
                    {demoControls}
                    {currentScreen}
                    {checklistPanel}
                    <ChatApp
                        client={client}
                        mode={mode}
                        isOpen={isOpen}
                        onClose={() => setIsOpen(false)}
                        onOpen={() => setIsOpen(true)}
                        userName="Ibaa"
                        storageApiUrl={STORAGE_API_BASE_URL}
                        accessToken={STATIC_TOKEN || null}
                        agents={agentItems}
                        agentId={activeAgentId}
                        external_tools={externalTools}
                        result_previewers={resultPreviewers}
                        tool_actions={toolActions}
                    />
                </div>
            )}
        </div>
    );
}

export default App
