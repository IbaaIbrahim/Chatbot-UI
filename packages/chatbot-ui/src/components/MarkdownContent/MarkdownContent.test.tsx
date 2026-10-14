// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MarkdownContent } from './MarkdownContent';
import { ChatRoot } from '../ChatRoot/ChatRoot';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { useChatOverrides } from '../../store/hooks';
import type { BlockAction, BlockRenderer, BlockRenderProps, ChatbotConfig } from '../../common/chatbotConfig';
import { blockKeyOf, extractBlocks } from '../../common/markdownBlocks';

/**
 * Rich blocks as the transcript draws them: a fence whose language the host
 * registered is the host's component, inside the library's frame — once the
 * fence is whole, and only once however many tokens stream after it.
 */

const CHART_BODY = '{"type":"line","title":"Average score per month","data":{"ref":"1899af24"}}';
const fence = (body = CHART_BODY, language = 'chart') => `\`\`\`${language}\n${body}\n\`\`\``;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
    sessionStorage.clear();
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

function render(element: React.ReactElement): HTMLElement {
    if (!container) {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    }
    act(() => root!.render(element));
    return container;
}

/** A renderer that records what it was given, how often it rendered and mounted. */
function recordingRenderer(extra: Partial<BlockRenderer> = {}) {
    const seen: BlockRenderProps[] = [];
    const counts = { renders: 0, mounts: 0 };
    const Component: React.FC<BlockRenderProps> = props => {
        counts.renders += 1;
        seen.push(props);
        React.useEffect(() => {
            counts.mounts += 1;
        }, []);
        return <div className="host-chart">{`chart:${props.source.length}`}</div>;
    };
    const renderer: BlockRenderer = { component: Component, label: 'chart', ...extra };
    return { renderer, seen, counts, last: () => seen[seen.length - 1] };
}

function withRenderers(
    renderers: Record<string, BlockRenderer | null>,
    children: React.ReactNode,
    config: ChatbotConfig = {}
): React.ReactElement {
    return (
        <ChatbotProvider config={{ ...config, markdown: { ...config.markdown, blockRenderers: renderers } }}>
            {children}
        </ChatbotProvider>
    );
}

describe('MarkdownContent — which fences are blocks', () => {
    it("draws a claimed fence with the host's component, and tells it what it needs", () => {
        const chart = recordingRenderer();
        const page = render(withRenderers(
            { chart: chart.renderer },
            <MarkdownContent
                content={`Scores rose.\n\n\`\`\`chart wide\n${CHART_BODY}\n\`\`\``}
                messageId="m-1"
                jobUuid="job-1"
                conversationId="conv-1"
            />
        ));

        expect(page.querySelector('figure.cb-md-block[data-lang="chart"] .host-chart')).not.toBeNull();
        expect(page.querySelector('pre')).toBeNull();
        expect(page.textContent).toContain('Scores rose.');
        expect(chart.last()).toMatchObject({
            language: 'chart',
            source: CHART_BODY,
            meta: 'wide',
            blockKey: blockKeyOf('chart', CHART_BODY),
            messageId: 'm-1',
            jobUuid: 'job-1',
            conversationId: 'conv-1',
            streaming: false,
            expanded: false,
            mode: 'floating',
            direction: 'ltr',
        });
        expect(['light', 'dark']).toContain(chart.last().theme);
        expect(chart.last().getMessageSource()).toContain('Scores rose.');
    });

    it('leaves a language nobody claimed as a code block', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence('ls -la', 'bash')} />));
        expect(page.querySelector('pre code')?.textContent).toBe('ls -la\n');
        expect(page.querySelector('.cb-md-block')).toBeNull();
        expect(chart.counts.renders).toBe(0);
    });

    it('has no blocks outside a provider', () => {
        const page = render(<MarkdownContent content={fence()} />);
        expect(page.querySelector('pre code')?.textContent).toContain('"type":"line"');
    });

    it('stops drawing a language a screen removes with null', () => {
        const chart = recordingRenderer();
        const Screen: React.FC = () => {
            useChatOverrides(REMOVE_CHART);
            return <MarkdownContent content={fence()} />;
        };
        const page = render(withRenderers({ chart: chart.renderer }, <Screen />));
        expect(page.querySelector('.cb-md-block')).toBeNull();
        expect(page.querySelector('pre')).not.toBeNull();
    });
});

const REMOVE_CHART: ChatbotConfig = { markdown: { blockRenderers: { chart: null } } };

describe('MarkdownContent — while the answer streams', () => {
    it('shows a skeleton until the fence closes, with the title once it has arrived', () => {
        const chart = recordingRenderer();
        const partial = 'Here:\n\n```chart\n{"type":"line","title":"Average score per month","data":{"re';
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={partial} streaming />));

        const skeleton = page.querySelector('.cb-md-block-skeleton');
        expect(skeleton).not.toBeNull();
        expect(skeleton!.textContent).toContain('Average score per month');
        expect(skeleton!.textContent).toContain('Preparing chart…');
        expect(chart.counts.renders).toBe(0);
    });

    it('draws a fence the answer ended without closing', () => {
        const chart = recordingRenderer();
        const unclosed = `Here:\n\n\`\`\`chart\n${CHART_BODY}`;
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={unclosed} streaming />));
        expect(page.querySelector('.host-chart')).toBeNull();

        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={unclosed} streaming={false} />));
        expect(page.querySelector('.cb-md-block-skeleton')).toBeNull();
        expect(page.querySelector('.host-chart')).not.toBeNull();
    });

    it('draws a closed fence at once, and tells it the turn is still in flight', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers(
            { chart: chart.renderer },
            <MarkdownContent content={`${fence()}\n\nAnd then`} streaming />
        ));
        expect(page.querySelector('.host-chart')).not.toBeNull();
        expect(chart.last().streaming).toBe(true);

        render(withRenderers(
            { chart: chart.renderer },
            <MarkdownContent content={`${fence()}\n\nAnd then`} streaming={false} turnInFlight />
        ));
        expect(chart.last().streaming).toBe(true);
    });

    it("uses the renderer's placeholder and reserves its height", () => {
        const Placeholder: React.FC<{ partialSource: string; label: string }> = ({ partialSource, label }) => (
            <span className="host-placeholder">{`${label}:${partialSource.length}`}</span>
        );
        const chart = recordingRenderer({ placeholder: Placeholder, minHeight: 240 });
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={'```chart\n{"ty'} streaming />));
        expect(page.querySelector('.host-placeholder')?.textContent).toBe('chart:4');
        expect((page.querySelector('.cb-md-block-pending') as HTMLElement).style.minHeight).toBe('240px');
    });

    it('draws a block once, however many tokens stream after it', () => {
        const chart = recordingRenderer();
        // Memoised, as a host's config must be: a new one would re-render every block.
        const config: ChatbotConfig = { markdown: { blockRenderers: { chart: chart.renderer } } };
        const head = `Scores rose.\n\n${fence()}\n\n`;
        const stream = (content: string) => (
            <ChatbotProvider config={config}><MarkdownContent content={content} streaming /></ChatbotProvider>
        );
        render(stream(head));
        const rendersAfterFirst = chart.counts.renders;

        for (const tail of ['Most', 'Mostly in', 'Mostly in March, when', 'Mostly in March, when the new sites opened.']) {
            render(stream(head + tail));
        }

        expect(chart.counts.mounts).toBe(1);
        expect(chart.counts.renders).toBe(rendersAfterFirst);
        expect(container!.textContent).toContain('the new sites opened.');
    });
});

describe('MarkdownContent — a block that cannot be drawn', () => {
    it('catches a renderer that throws and shows why, with the source', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const Throwing: React.FC<BlockRenderProps> = () => {
            throw new Error('FIELD_MISSING avg (fields: avg_score, count)');
        };
        const page = render(withRenderers(
            { chart: { component: Throwing, label: 'chart' } },
            <MarkdownContent content={`Before\n\n${fence()}\n\nAfter`} />
        ));

        const fallback = page.querySelector('.cb-md-block-fallback');
        expect(fallback?.getAttribute('role')).toBe('alert');
        expect(fallback?.textContent).toContain("Couldn't display this chart: FIELD_MISSING avg (fields: avg_score, count)");
        expect(fallback?.querySelector('details pre')?.textContent).toBe(CHART_BODY);
        // The title still says which block it was, and the rest of the answer is there.
        expect(page.querySelector('.cb-md-block-title')?.textContent).toBe('Average score per month');
        expect(page.textContent).toContain('Before');
        expect(page.textContent).toContain('After');
    });

    it('shows the fallback when the renderer gives up', () => {
        const Failing: React.FC<BlockRenderProps> = ({ fail }) => {
            React.useEffect(() => fail('REF_NOT_FOUND 1899af24'), [fail]);
            return <div className="host-chart" />;
        };
        const page = render(withRenderers({ chart: { component: Failing } }, <MarkdownContent content={fence()} />));
        expect(page.querySelector('.cb-md-block-fallback')?.textContent).toContain("Couldn't display this chart: REF_NOT_FOUND 1899af24");
        expect(page.querySelector('.host-chart')).toBeNull();
    });
});

describe('MarkdownContent — the frame', () => {
    it("shows the renderer's title and its actions, and runs one with the block and its message", () => {
        const runs: Array<{ element: HTMLElement; messageElement: HTMLElement | null }> = [];
        const download = vi.fn((ctx: { element: HTMLElement; messageElement: HTMLElement | null }) => {
            runs.push(ctx);
        });
        const save = vi.fn();
        const WithActions: React.FC<BlockRenderProps> = ({ setTitle, setActions }) => {
            React.useEffect(() => {
                setTitle('Average score per month');
                setActions([
                    { id: 'save', label: 'Save', icon: <span className="save-icon" />, placement: 'toolbar', run: save },
                    { id: 'png', label: 'Download PNG', run: download },
                ]);
            });
            return <div className="host-chart" />;
        };
        const page = render(withRenderers(
            { chart: { component: WithActions } },
            <div className="cb-message-content-wrapper"><MarkdownContent content={fence()} /></div>
        ));

        expect(page.querySelector('.cb-md-block-title')?.textContent).toBe('Average score per month');
        const saveButton = page.querySelector<HTMLButtonElement>('button[aria-label="Save"]');
        expect(saveButton?.querySelector('.save-icon')).not.toBeNull();
        act(() => saveButton!.click());
        expect(save).toHaveBeenCalledTimes(1);

        // Menu actions are behind "More actions", with "Copy source" last.
        expect(page.textContent).not.toContain('Download PNG');
        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click());
        const items = Array.from(page.querySelectorAll('[role="menuitem"]')).map(item => item.textContent);
        expect(items).toEqual(['Download PNG', 'Copy source']);

        act(() => (page.querySelector('[role="menuitem"]') as HTMLButtonElement).click());
        expect(download).toHaveBeenCalledTimes(1);
        expect(runs[0].element.tagName).toBe('FIGURE');
        expect(runs[0].messageElement?.className).toBe('cb-message-content-wrapper');
        expect(page.querySelector('[role="menu"]')).toBeNull();
    });

    it('settles when a renderer sets fresh actions on every render', () => {
        let renders = 0;
        const Eager: React.FC<BlockRenderProps> = ({ setActions }) => {
            renders += 1;
            React.useEffect(() => {
                setActions([{ id: 'csv', label: 'Download CSV', run: () => undefined }]);
            });
            return null;
        };
        render(withRenderers({ chart: { component: Eager } }, <MarkdownContent content={fence()} />));
        expect(renders).toBeLessThan(5);
    });

    it('runs the latest closure of an action whose label did not change', () => {
        const calls: number[] = [];
        let version = 0;
        const Counting: React.FC<BlockRenderProps & { tick: number }> = ({ setActions }) => {
            version += 1;
            const mine = version;
            React.useEffect(() => {
                setActions([{ id: 'go', label: 'Go', placement: 'toolbar', run: () => { calls.push(mine); } }]);
            });
            return null;
        };
        const page = render(withRenderers({ chart: { component: Counting as React.FC<BlockRenderProps> } }, <MarkdownContent content={fence()} />));
        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Go"]')!.click());
        expect(calls).toEqual([version]);
    });

    it('greys out a disabled action', () => {
        const Saved: React.FC<BlockRenderProps> = ({ setActions }) => {
            React.useEffect(() => {
                const actions: BlockAction[] = [{ id: 'save', label: 'Saved', placement: 'toolbar', disabled: true, run: vi.fn() }];
                setActions(actions);
            }, [setActions]);
            return null;
        };
        const page = render(withRenderers({ chart: { component: Saved } }, <MarkdownContent content={fence()} />));
        expect(page.querySelector<HTMLButtonElement>('button[aria-label="Saved"]')!.disabled).toBe(true);
    });

    it('copies the source', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} />));

        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!.click());
        await act(async () => {
            (Array.from(page.querySelectorAll('[role="menuitem"]')).pop() as HTMLButtonElement).click();
        });
        expect(writeText).toHaveBeenCalledWith(CHART_BODY);
    });

    it('draws the bare component when the renderer asks for no frame', () => {
        const chart = recordingRenderer({ frame: false });
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} />));
        expect(page.querySelector('.cb-md-block-bare .host-chart')).not.toBeNull();
        expect(page.querySelector('figure')).toBeNull();
    });
});

describe('MarkdownContent — expanded', () => {
    it('opens the block again in a dialog, and Escape closes it', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} />));

        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click());

        const dialog = document.body.querySelector<HTMLElement>('.cb-md-block-overlay [role="dialog"]');
        expect(dialog).not.toBeNull();
        expect(dialog!.getAttribute('aria-modal')).toBe('true');
        expect(dialog!.closest('.cb-root')).not.toBeNull();
        expect(dialog!.querySelector('.host-chart')).not.toBeNull();
        expect(chart.last().expanded).toBe(true);
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');

        act(() => {
            dialog!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        expect(document.body.querySelector('.cb-md-block-overlay')).toBeNull();
        expect(document.activeElement?.getAttribute('aria-label')).toBe('Expand');
    });

    // The user's report of 2026-10-14: expanded, the close button sat between
    // Save and "More actions". It ends the header now, as in every header of
    // the chat — the logical end, so the left end right-to-left.
    it('ends its header with the close button, after the actions and "More actions"', () => {
        const WithSave: React.FC<BlockRenderProps> = ({ setTitle, setActions }) => {
            React.useEffect(() => {
                setTitle('Average score per month');
                setActions([
                    { id: 'save', label: 'Save', icon: <span className="save-icon" />, placement: 'toolbar', run: vi.fn() },
                    { id: 'png', label: 'Download PNG', run: vi.fn() },
                ]);
            });
            return <div className="host-chart" />;
        };
        const page = render(withRenderers({ chart: { component: WithSave } }, <MarkdownContent content={fence()} />));
        const headerButtons = (root: ParentNode) => Array.from(root.querySelectorAll('.cb-md-block-header button'))
            .map(button => button.getAttribute('aria-label'));

        // In the answer, Expand stays beside the toolbar's actions.
        expect(headerButtons(page)).toEqual(['Save', 'Expand', 'More actions']);

        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click());
        const dialog = document.body.querySelector<HTMLElement>('.cb-md-block-overlay [role="dialog"]')!;
        expect(headerButtons(dialog)).toEqual(['Save', 'More actions', 'Close']);
        const header = dialog.querySelector('.cb-md-block-header')!;
        expect(header.firstElementChild?.textContent).toBe('Average score per month');
        // Nothing reorders it visually: the DOM order is the order on screen.
        expect(Array.from(header.querySelectorAll<HTMLElement>('button')).every(button => !button.style.order)).toBe(true);

        // And it still closes the overlay.
        act(() => dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
        expect(document.body.querySelector('.cb-md-block-overlay')).toBeNull();
    });

    it('lets the renderer open it', () => {
        let open: (() => void) | null = null;
        const Opener: React.FC<BlockRenderProps> = props => {
            open = props.openExpanded;
            return <div className={props.expanded ? 'big' : 'small'} />;
        };
        render(withRenderers({ chart: { component: Opener } }, <MarkdownContent content={fence()} />));
        act(() => open!());
        expect(document.body.querySelector('.cb-md-block-overlay .big')).not.toBeNull();
    });

    it('hands "Expand" to the host when it takes it', () => {
        const onExpandBlock = vi.fn(() => true);
        const chart = recordingRenderer();
        const page = render(withRenderers(
            { chart: chart.renderer },
            <MarkdownContent content={fence()} messageId="m-9" />,
            { markdown: { onExpandBlock } }
        ));

        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click());

        expect(onExpandBlock).toHaveBeenCalledWith({
            language: 'chart',
            source: CHART_BODY,
            meta: null,
            blockKey: blockKeyOf('chart', CHART_BODY),
            messageId: 'm-9',
        });
        expect(document.body.querySelector('.cb-md-block-overlay')).toBeNull();
    });
});

describe('MarkdownContent — the expanded dialog keeps Tab inside', () => {
    /** A key pressed where `target` is, as the browser sends it. */
    function press(target: EventTarget, key: string, options: KeyboardEventInit = {}): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
        act(() => {
            target.dispatchEvent(event);
        });
        return event;
    }

    // A host's block with a control of its own, and — expanded — a popup it
    // portals to the page, as a date picker or a menu would.
    const WithControls: React.FC<BlockRenderProps> = ({ expanded }) => (
        <div>
            <button type="button" className="host-zoom">Zoom</button>
            {expanded && createPortal(<button type="button" className="host-popup">Pick</button>, document.body)}
        </div>
    );

    it('goes round from the last control to the first, and Shift+Tab back', () => {
        const page = render(withRenderers({ chart: { component: WithControls } }, <MarkdownContent content={fence()} />));
        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click());

        const dialog = document.body.querySelector<HTMLElement>('.cb-md-block-overlay [role="dialog"]')!;
        const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
        const more = dialog.querySelector<HTMLButtonElement>('button[aria-label="More actions"]')!;
        const zoom = dialog.querySelector<HTMLButtonElement>('.host-zoom')!;
        expect(document.activeElement).toBe(close);

        // The header's first control is "More actions" since 2026-10-14: the
        // close button ends the header now, after the menu.
        act(() => zoom.focus());
        expect(press(zoom, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(more);
        expect(press(more, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(zoom);

        // In between, Tab is the browser's.
        act(() => close.focus());
        expect(press(close, 'Tab').defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(close);
    });

    it("leaves Tab in a popup the host's block portals out of it", () => {
        const page = render(withRenderers({ chart: { component: WithControls } }, <MarkdownContent content={fence()} />));
        act(() => page.querySelector<HTMLButtonElement>('button[aria-label="Expand"]')!.click());

        // React bubbles the popup's keys to the dialog; they are not the dialog's.
        const popup = document.body.querySelector<HTMLButtonElement>('.host-popup')!;
        expect(popup.closest('[role="dialog"]')).toBeNull();
        act(() => popup.focus());
        expect(press(popup, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(popup);
    });
});

describe('MarkdownContent — the theme and direction a block is given', () => {
    /** An OS colour preference the test changes, as `matchMedia` reports it. */
    function stubColorScheme(light: boolean) {
        const listeners = new Set<() => void>();
        const query = {
            get matches() {
                return light;
            },
            media: '(prefers-color-scheme: light)',
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        };
        vi.stubGlobal('matchMedia', vi.fn(() => query));
        return {
            set(next: boolean) {
                light = next;
                act(() => listeners.forEach(listener => listener()));
            },
            listening: () => listeners.size,
        };
    }

    it("follows the OS under 'system', and changes with it", () => {
        const scheme = stubColorScheme(true);
        const chart = recordingRenderer();
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} />));
        expect(chart.last().theme).toBe('light');
        expect(chart.counts.mounts).toBe(1);

        scheme.set(false);
        expect(chart.last().theme).toBe('dark');
        scheme.set(true);
        expect(chart.last().theme).toBe('light');
        expect(chart.counts.mounts).toBe(1);

        act(() => root?.unmount());
        root = null;
        container?.remove();
        container = null;
        expect(scheme.listening()).toBe(0);
    });

    it('is the chat\'s own theme when it names one, whatever the OS prefers', () => {
        stubColorScheme(true);
        const chart = recordingRenderer();
        render(withRenderers(
            { chart: chart.renderer },
            <ChatRoot theme="dark"><MarkdownContent content={fence()} /></ChatRoot>
        ));
        expect(chart.last().theme).toBe('dark');
    });

    it('is right-to-left under a right-to-left ancestor', () => {
        // jsdom resolves no `direction`; the browser's rule is the closest
        // `dir` of `ltr` or `rtl`, inherited by everything inside.
        const realStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
            const style = realStyle(element, pseudo);
            const direction = element.closest('[dir="rtl"], [dir="ltr"]')?.getAttribute('dir') ?? 'ltr';
            return new Proxy(style, {
                get(target, property) {
                    if (property === 'direction') return direction;
                    const value = Reflect.get(target, property);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        const arabic = recordingRenderer();
        const english = recordingRenderer();
        render(withRenderers(
            { chart: arabic.renderer, table: english.renderer },
            <>
                <div dir="rtl"><MarkdownContent content={fence()} /></div>
                <div dir="ltr"><MarkdownContent content={fence('{"title":"Inspectors"}', 'table')} /></div>
            </>
        ));
        expect(arabic.last().direction).toBe('rtl');
        expect(english.last().direction).toBe('ltr');
    });
});

describe('MarkdownContent — fence languages that are not renderers', () => {
    // Review of 2026-10-14: ```constructor found Object.prototype.constructor,
    // and React threw past every boundary, unmounting the transcript — on every
    // reload of a conversation whose message held such a fence.
    const INHERITED = ['constructor', 'toString', 'valueOf', '__proto__'];
    const answer = INHERITED.map(language => fence('x', language)).join('\n\nand\n\n');

    it('draws a fence named after an inherited member as code, with no renderers', () => {
        const page = render(<ChatbotProvider config={{}}><MarkdownContent content={answer} /></ChatbotProvider>);
        expect(page.querySelectorAll('pre')).toHaveLength(INHERITED.length);
        expect(page.querySelector('.cb-md-block')).toBeNull();
    });

    it('and with renderers, and outside a provider', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={`${answer}\n\n${fence()}`} />));
        expect(page.querySelectorAll('pre')).toHaveLength(INHERITED.length);
        expect(page.querySelectorAll('.cb-md-block .host-chart')).toHaveLength(1);
        act(() => root?.unmount());
        container?.remove();
        container = null;

        expect(render(<MarkdownContent content={answer} />).querySelectorAll('pre')).toHaveLength(INHERITED.length);
    });

    it('leaves a renderer with no component out, as code', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = render(withRenderers(
            { chart: { label: 'chart' } as unknown as BlockRenderer },
            <MarkdownContent content={`Before\n\n${fence()}`} />
        ));
        expect(page.querySelector('pre code')?.textContent).toContain('"type":"line"');
        expect(page.textContent).toContain('Before');
    });

    it('catches a component React cannot render, inside the block', () => {
        // An element is not a component, but it carries `$$typeof` like one:
        // the shape check lets it through, and React throws on it. The throw
        // must land below the block's error boundary, not in it.
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const notAComponent = { component: <div /> } as unknown as BlockRenderer;
        const page = render(withRenderers({ chart: notAComponent }, <MarkdownContent content={`Before\n\n${fence()}\n\nAfter`} />));
        expect(page.querySelector('.cb-md-block-fallback')?.textContent).toContain("Couldn't display this chart");
        expect(page.textContent).toContain('Before');
        expect(page.textContent).toContain('After');
    });
});

describe('MarkdownContent — what a block is known by', () => {
    // 2026-10-14: an answer that ended inside a fence, followed by a line
    // break, was drawn under one key and extracted (and indexed) under another.
    it.each([
        ['without a final line break', 'Here:\n\n```chart\n{"a":1}'],
        ['with one', 'Here:\n\n```chart\n{"a":1}\n'],
        ['with a blank line', 'Here:\n\n```chart\n{"a":1}\n\n'],
        ['with CRLF line breaks', 'Here:\r\n\r\n```chart\r\n{"a":1,\r\n"b":2}\r\n'],
        ['indented, in a list item', '- Here:\n\n  ```chart\n  {"a":1}\n'],
    ])('keys a fence the answer ended inside, %s, as extractBlocks does', (_name, answer) => {
        const chart = recordingRenderer();
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={answer} streaming={false} />));

        const [extracted] = extractBlocks(answer, ['chart']);
        expect(chart.counts.renders).toBeGreaterThan(0);
        expect(chart.last().source).toBe(extracted.source);
        expect(chart.last().blockKey).toBe(extracted.blockKey);
    });

    // Known divergences (markdownBlocks.ts, `scanFences`; review of
    // 2026-10-14): the platform's index is a port of the extraction, so the
    // extraction keeps its reading — pinned here so a change to either side
    // is a decision, not an accident.
    it('extracts more than it draws for an unclosed fence in a list item followed by less-indented text', () => {
        const chart = recordingRenderer();
        const answer = '- item\n\n  ```chart\n  {"x":1}\nafter';
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={answer} streaming={false} />));

        const [extracted] = extractBlocks(answer, ['chart']);
        expect(chart.last().source).toBe('{"x":1}');
        expect(extracted.source).toBe('{"x":1}\nafter');
        expect(chart.last().blockKey).not.toBe(extracted.blockKey);
    });

    it('extracts a fence inside an HTML block, which is drawn as HTML and not as a block', () => {
        const chart = recordingRenderer();
        const answer = '<div>\n```chart\n{"x":1}\n```\n</div>';
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={answer} streaming={false} />));

        expect(chart.counts.renders).toBe(0);
        expect(extractBlocks(answer, ['chart']).map(block => block.source)).toEqual(['{"x":1}']);
    });

    it('marks a drawn block with its key and turn, for "Show in chat" to find', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} jobUuid="job-7" />));
        const figure = page.querySelector<HTMLElement>('figure.cb-md-block')!;
        expect(figure.dataset.blockKey).toBe(blockKeyOf('chart', CHART_BODY));
        expect(figure.dataset.jobUuid).toBe('job-7');
    });

    it('keys a block of a CRLF answer as extractBlocks does', () => {
        const chart = recordingRenderer();
        const answer = 'Intro\r\n\r\n```chart\r\n{"a":1,\r\n"b":2}\r\n```\r\n';
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={answer} />));

        const [extracted] = extractBlocks(answer, ['chart']);
        expect(chart.last().source).toBe('{"a":1,\n"b":2}');
        expect(chart.last().source).toBe(extracted.source);
        expect(chart.last().blockKey).toBe(extracted.blockKey);
    });
});

describe('MarkdownContent — blocks={false}', () => {
    it('keeps every fence as code', () => {
        const chart = recordingRenderer();
        const page = render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} blocks={false} />));
        expect(page.querySelector('pre code')?.textContent).toContain('"type":"line"');
        expect(page.querySelector('.cb-md-block')).toBeNull();
        expect(chart.counts.renders).toBe(0);
    });
});

describe('MarkdownContent — the width a block is given', () => {
    it('is the body\'s content box, measured the same way first and after', () => {
        // The body is 300px wide inside 12px of padding on each side: 276px to draw in.
        let bodyWidth = 300;
        vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
            return this.classList.contains('cb-md-block-body') ? bodyWidth : 0;
        });
        const realStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
            const style = realStyle(element, pseudo);
            if (!element.classList.contains('cb-md-block-body')) return style;
            return new Proxy(style, {
                get(target, property) {
                    if (property === 'paddingLeft' || property === 'paddingRight') return '12px';
                    const value = Reflect.get(target, property);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        const observers: Array<{ callback: ResizeObserverCallback; element: Element | null }> = [];
        vi.stubGlobal('ResizeObserver', class {
            entry: { callback: ResizeObserverCallback; element: Element | null };
            constructor(callback: ResizeObserverCallback) {
                this.entry = { callback, element: null };
                observers.push(this.entry);
            }
            observe(element: Element) { this.entry.element = element; }
            disconnect() { this.entry.element = null; }
            unobserve() { /* not used */ }
        });

        const chart = recordingRenderer();
        render(withRenderers({ chart: chart.renderer }, <MarkdownContent content={fence()} />));
        expect(chart.last().width).toBe(276);

        // The observer reports the same box: nothing changes.
        const observer = observers.find(entry => entry.element?.classList.contains('cb-md-block-body'))!;
        const report = (width: number) => act(() => {
            observer.callback([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
        });
        const rendersBefore = chart.counts.renders;
        report(276);
        expect(chart.counts.renders).toBe(rendersBefore);

        bodyWidth = 424;
        report(400);
        expect(chart.last().width).toBe(400);
        expect(chart.counts.mounts).toBe(1);
    });
});
