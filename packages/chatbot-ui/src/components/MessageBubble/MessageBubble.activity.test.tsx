// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MessageBubble, type MessageStep } from './MessageBubble';

// The attachment viewer's PDF library needs DOMMatrix, which jsdom lacks; no
// attachment is drawn here.
vi.mock('react-pdf', () => ({
    Document: () => null,
    Page: () => null,
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

/**
 * The bubble draws a run of thinking and tool steps as one closed section, and
 * the answer after it as before.
 */

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
});

function render(steps: MessageStep[], extra: Record<string, unknown> = {}): HTMLElement {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root!.render(<MessageBubble id="m1" role="assistant" steps={steps} shouldAnimate={false} {...extra} />);
    });
    return container;
}

const STEPS: MessageStep[] = [
    { id: 't1', type: 'thinking', content: 'Which skill?', isFinished: true },
    { id: 'c1', type: 'tool-call', toolSlug: 'search_skills', toolStatus: 'completed', toolArgs: { query: 'inspections' } },
    { id: 't2', type: 'thinking', content: 'Load it.', isFinished: true },
    { id: 'c2', type: 'tool-call', toolSlug: 'list_inspections', toolName: 'List Inspections', toolStatus: 'completed' },
    { id: 'x1', type: 'text', content: 'Here are the inspections.' },
];

describe('the activity section', () => {
    it('is one closed row, with the answer below it', () => {
        const page = render(STEPS);

        const sections = page.querySelectorAll('.cb-activity');
        expect(sections).toHaveLength(1);
        expect(sections[0].textContent).toContain('Thought 2 times · searched once · ran List Inspections');
        expect(page.querySelectorAll('.cb-modern-tool-call')).toHaveLength(0);
        expect(page.querySelectorAll('.cb-modern-thinking')).toHaveLength(0);
        expect(page.textContent).toContain('Here are the inspections.');
    });

    it('opens to every step', () => {
        const page = render(STEPS);

        act(() => (page.querySelector('.cb-activity-btn') as HTMLButtonElement).click());

        expect(page.querySelectorAll('.cb-activity-items .cb-modern-tool-call')).toHaveLength(2);
        expect(page.querySelectorAll('.cb-activity-items .cb-modern-thinking')).toHaveLength(2);
    });

    it('shows the newest step while the turn runs', () => {
        const live: MessageStep[] = [
            STEPS[0],
            { ...STEPS[3], toolStatus: 'running' },
        ];
        const page = render(live, { isTurnComplete: false });

        const section = page.querySelector('.cb-activity');
        expect(section?.classList.contains('is-running')).toBe(true);
        expect(section?.textContent).toContain('Running');
        expect(section?.textContent).toContain('List Inspections');
        expect(section?.querySelector('.cb-spinner-xs')).not.toBeNull();
    });
});
