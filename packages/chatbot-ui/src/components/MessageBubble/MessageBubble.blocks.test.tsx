// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageBubble, type MessageProps, type MessageStep } from './MessageBubble';
import { ChatbotProvider } from '../../context/ChatbotContext';
import type { BlockRenderProps, ChatbotConfig } from '../../common/chatbotConfig';

// The attachment viewer's PDF library needs DOMMatrix, which jsdom lacks; no
// attachment is drawn here.
vi.mock('react-pdf', () => ({
    Document: () => null,
    Page: () => null,
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

/**
 * Rich blocks in the transcript: every markdown path of the bubble draws them,
 * each knows the turn it belongs to, and "Copy" gives text rather than JSON.
 */

const CHART_BODY = '{"type":"bar","title":"Inspections per week"}';
const CHART = `\`\`\`chart\n${CHART_BODY}\n\`\`\``;

const seen: BlockRenderProps[] = [];
const lifecycle = { mounts: 0, unmounts: 0 };
const Chart: React.FC<BlockRenderProps> = props => {
    seen.push(props);
    React.useEffect(() => {
        lifecycle.mounts += 1;
        return () => {
            lifecycle.unmounts += 1;
        };
    }, []);
    return <div className="host-chart" />;
};
const CONFIG: ChatbotConfig = { markdown: { blockRenderers: { chart: { component: Chart, label: 'chart' } } } };

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    seen.length = 0;
    lifecycle.mounts = 0;
    lifecycle.unmounts = 0;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function render(props: MessageProps, provider = true): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const bubble = <MessageBubble shouldAnimate={false} {...props} />;
    act(() => {
        root!.render(provider ? <ChatbotProvider config={CONFIG}>{bubble}</ChatbotProvider> : bubble);
    });
    return container;
}

const text = (id: string, content: string): MessageStep => ({ id, type: 'text', content });

describe('MessageBubble — rich blocks', () => {
    it('draws a block in an answer, saved against the turn that wrote it', () => {
        const page = render({
            id: 'job-1-assistant',
            role: 'assistant',
            jobUuid: 'job-1',
            steps: [text('s1', `Up 12%.\n\n${CHART}`), text('s2', 'Mostly in March.')],
        });

        expect(page.querySelector('.cb-markdown-content .cb-md-block .host-chart')).not.toBeNull();
        const props = seen[seen.length - 1];
        expect(props).toMatchObject({ jobUuid: 'job-1', messageId: 'job-1-assistant', streaming: false });
        // The whole answer, not just the step the block is in.
        expect(props.getMessageSource()).toBe(`Up 12%.\n\n${CHART}\n\nMostly in March.`);
    });

    it('keeps the last text of a live turn as a skeleton until its fence closes', () => {
        const page = render({
            id: 'assistant-live',
            role: 'assistant',
            isTurnComplete: false,
            steps: [text('s1', `Here:\n\n\`\`\`chart\n{"type":"bar","title":"Inspec`)],
        });
        expect(page.querySelector('.cb-md-block-skeleton')).not.toBeNull();
        expect(page.querySelector('.host-chart')).toBeNull();
    });

    it('draws an earlier text of a live turn, and says the turn is still in flight', () => {
        const page = render({
            id: 'assistant-live',
            role: 'assistant',
            isTurnComplete: false,
            steps: [
                text('s1', CHART),
                { id: 'c1', type: 'tool-call', toolSlug: 'query_analytics', toolStatus: 'running' },
            ],
        });
        expect(page.querySelector('.host-chart')).not.toBeNull();
        expect(seen[seen.length - 1].streaming).toBe(true);
        expect(seen[seen.length - 1].jobUuid).toBeNull();
    });

    it('copies an answer as text, each block as its title', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        const page = render({
            id: 'a1',
            role: 'assistant',
            steps: [text('s1', `Up 12%.\n\n${CHART}\n\nMostly in March.`)],
        });

        await act(async () => {
            page.querySelector<HTMLButtonElement>('.cb-message-actions .cb-action-btn')!.click();
        });

        expect(writeText).toHaveBeenCalledWith('Up 12%.\n\n[chart: Inspections per week]\n\nMostly in March.');
    });

    it('keeps a live legacy answer (no steps) as a skeleton until its fence closes', () => {
        const page = render({
            id: 'legacy-live',
            role: 'assistant',
            isTurnComplete: false,
            content: 'Here:\n\n```chart\n{"type":"bar","title":"Inspec',
        });
        expect(page.querySelector('.cb-md-block-skeleton')).not.toBeNull();
        expect(page.querySelector('.host-chart')).toBeNull();
    });

    it('draws the blocks in the legacy bubble too', () => {
        const page = render({ id: 'legacy', role: 'assistant', content: CHART, jobUuid: 'job-7' });
        expect(page.querySelector('.host-chart')).not.toBeNull();
        expect(seen[seen.length - 1].jobUuid).toBe('job-7');
    });

    it("draws the blocks in a sub-agent's answer, against the turn's job", () => {
        const page = render({
            id: 'a1',
            role: 'assistant',
            jobUuid: 'job-1',
            steps: [
                {
                    id: 'sub-1',
                    type: 'sub-agent',
                    agentName: 'Analyst',
                    toolStatus: 'completed',
                    subSteps: [],
                    content: `The chart:\n\n${CHART}`,
                },
                text('s2', 'Done.'),
            ],
        });

        // A lone sub-agent run is drawn on its own, closed: open it.
        act(() => page.querySelector<HTMLButtonElement>('.cb-sub-agent-header')!.click());

        expect(page.querySelector('.cb-sub-agent-result .host-chart')).not.toBeNull();
        expect(seen[seen.length - 1].jobUuid).toBe('job-1');
    });

    it('stays a code block without a provider', () => {
        const page = render({ id: 'a1', role: 'assistant', steps: [text('s1', CHART)] }, false);
        expect(page.querySelector('pre code')?.textContent).toContain('"type":"bar"');
        expect(page.querySelector('.cb-md-block')).toBeNull();
    });
});

describe('MessageBubble — a block in a running sub-agent', () => {
    // Review of 2026-10-14: the nested bubble of a sub-agent took its run for
    // finished, handed the host every prefix of a streaming spec as complete,
    // and remounted the block on every token.
    const subAgent = (content: string, toolStatus: 'running' | 'completed'): MessageStep => ({
        id: 'sa-1',
        type: 'sub-agent',
        agentName: 'Analyst',
        toolStatus,
        subSteps: [text('sub-text-1', content)],
    });

    function renderLive(content: string, toolStatus: 'running' | 'completed', isTurnComplete: boolean): void {
        act(() => {
            root!.render(
                <ChatbotProvider config={CONFIG}>
                    <MessageBubble
                        id="a1"
                        role="assistant"
                        shouldAnimate={false}
                        jobUuid="job-1"
                        isTurnComplete={isTurnComplete}
                        steps={[subAgent(content, toolStatus)]}
                    />
                </ChatbotProvider>
            );
        });
    }

    it('is a skeleton while its fence streams, then drawn once and told the turn goes on', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);

        renderLive('Here:\n\n```chart\n{"type":"ba', 'running', false);
        act(() => container!.querySelector<HTMLButtonElement>('.cb-sub-agent-header')!.click());
        expect(container.querySelector('.cb-sub-agent-body .cb-md-block-skeleton')).not.toBeNull();

        for (const partial of ['{"type":"bar"', '{"type":"bar","ti', CHART_BODY]) {
            renderLive(`Here:\n\n\`\`\`chart\n${partial}`, 'running', false);
            expect(container.querySelector('.cb-md-block-skeleton')).not.toBeNull();
        }
        expect(seen).toHaveLength(0);

        renderLive(`Here:\n\n${CHART}\n\nThat is all`, 'running', false);
        expect(container.querySelector('.cb-sub-agent-body .host-chart')).not.toBeNull();
        expect(seen[seen.length - 1]).toMatchObject({ source: CHART_BODY, streaming: true, jobUuid: 'job-1' });

        // The sub-agent is done, its turn is not: the block still waits on refs.
        renderLive(`Here:\n\n${CHART}\n\nThat is all.`, 'completed', false);
        expect(seen[seen.length - 1].streaming).toBe(true);

        renderLive(`Here:\n\n${CHART}\n\nThat is all.`, 'completed', true);
        expect(seen[seen.length - 1].streaming).toBe(false);
        expect(seen.every(props => props.source === CHART_BODY)).toBe(true);
        expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
    });

    it("tells a block in the sub-agent's own answer that the turn goes on", () => {
        const page = render({
            id: 'a1',
            role: 'assistant',
            jobUuid: 'job-1',
            isTurnComplete: false,
            steps: [{
                id: 'sub-1',
                type: 'sub-agent',
                agentName: 'Analyst',
                toolStatus: 'completed',
                subSteps: [],
                content: `The chart:\n\n${CHART}`,
            }],
        });
        act(() => page.querySelector<HTMLButtonElement>('.cb-sub-agent-header')!.click());
        expect(page.querySelector('.cb-sub-agent-result .host-chart')).not.toBeNull();
        expect(seen[seen.length - 1].streaming).toBe(true);
    });
});

describe("MessageBubble — a user's own message", () => {
    // Blocks are how the assistant presents an answer (design §3.4). A fence
    // the user pasted stays code, and "Copy" gives back what they wrote.
    it('draws a fence the user wrote as code, and copies it as written', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        const content = `Can you draw this?\n\n${CHART}`;
        const page = render({ id: 'u1', role: 'user', content, jobUuid: 'job-1' });

        expect(page.querySelector('pre code')?.textContent).toContain('"type":"bar"');
        expect(page.querySelector('.cb-md-block')).toBeNull();
        expect(seen).toHaveLength(0);

        await act(async () => {
            page.querySelector<HTMLButtonElement>('.cb-message-actions .cb-action-btn')!.click();
        });
        expect(writeText).toHaveBeenCalledWith(content);
    });

    it('does the same for a user message made of steps', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        const page = render({ id: 'u2', role: 'user', steps: [text('u-s1', CHART)] });

        expect(page.querySelector('.cb-md-block')).toBeNull();
        expect(page.querySelector('pre code')).not.toBeNull();
        await act(async () => {
            page.querySelector<HTMLButtonElement>('.cb-message-actions .cb-action-btn')!.click();
        });
        expect(writeText).toHaveBeenCalledWith(CHART);
    });
});
