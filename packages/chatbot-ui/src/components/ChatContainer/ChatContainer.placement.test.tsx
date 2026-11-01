// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatbotProvider } from '../../context/ChatbotContext';
import { ChatApp } from '../App/App';
import { ChatRoot } from '../ChatRoot/ChatRoot';
import { ChatContainer } from './ChatContainer';
import { ChatPresentation, ChatSide, useChatPresentation } from './presentation';
import type { ChatMode } from './presentation';
import { readDirection } from '../../common/direction';
import { useChatState } from '../../store/hooks';

// The attachment viewer's PDF library needs DOMMatrix, which jsdom lacks.
vi.mock('react-pdf', () => ({
    Document: () => null,
    Page: () => null,
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

/**
 * Which edge the chat attaches to (`side`) and which way the page runs (the
 * direction the chat inherits), as the classes the stylesheet places it by:
 * `cb-side-end` / `cb-side-start` and `cb-dir-ltr` / `cb-dir-rtl` on the panel
 * and on the launcher, in every mode, embedded or not — and the same two
 * values in the presentation the chat's widgets read. The geometry those
 * classes produce is ChatContainer.styles.test.ts's.
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
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('dir');
    vi.restoreAllMocks();
});

function render(element: React.ReactElement, host?: HTMLElement): HTMLElement {
    if (!container) {
        container = document.createElement('div');
        (host ?? document.body).appendChild(container);
        root = createRoot(container);
    }
    act(() => root!.render(element));
    return container;
}

/** A page region in the given direction, in the document. */
function region(dir: 'ltr' | 'rtl'): HTMLElement {
    const element = document.createElement('div');
    element.setAttribute('dir', dir);
    document.body.appendChild(element);
    return element;
}

/** Records the presentation the chat's widgets are given. */
function presentationProbe() {
    const seen: ChatPresentation[] = [];
    const Probe: React.FC = () => {
        seen.push(useChatPresentation());
        return null;
    };
    return { Probe, last: () => seen[seen.length - 1] };
}

interface ChatOptions {
    mode?: ChatMode;
    side?: ChatSide;
    embedded?: boolean;
    open?: boolean;
    header?: React.ReactNode;
}

/** A bare container: no header or sidebar, a stand-in transcript. */
function chat({ mode = 'floating', side, embedded = false, open = true, header = null }: ChatOptions = {}) {
    return (
        <ChatbotProvider config={{}} open={open}>
            <ChatContainer mode={mode} side={side} embedded={embedded} header={header} sidebar={null}>
                <div className="transcript" />
            </ChatContainer>
        </ChatbotProvider>
    );
}

const panel = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-chat-container');
const launcher = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-launcher-btn');
const classesOf = (element: Element | null) => (element ? Array.from(element.classList) : []);

describe('ChatContainer — side and direction', () => {
    it("defaults to the end of a left-to-right page, as every chat before 4.2 was placed", () => {
        const page = render(chat());
        expect(classesOf(panel(page))).toEqual(expect.arrayContaining(['cb-side-end', 'cb-dir-ltr']));
        expect(classesOf(panel(page))).not.toContain('cb-side-start');
        expect(classesOf(panel(page))).not.toContain('cb-dir-rtl');
    });

    const MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];
    const SIDES: ChatSide[] = ['end', 'start'];
    const DIRECTIONS = ['ltr', 'rtl'] as const;

    describe.each(MODES)('%s', mode => {
        describe.each([false, true])('embedded: %s', embedded => {
            it.each(SIDES.flatMap(side => DIRECTIONS.map(dir => [side, dir] as const)))(
                'side %s in a %s page',
                (side, dir) => {
                    const page = render(chat({ mode, side, embedded }), region(dir));
                    const element = panel(page);
                    expect(classesOf(element)).toEqual(expect.arrayContaining([
                        'cb-chat-container',
                        `cb-mode-${mode}`,
                        `cb-side-${side}`,
                        `cb-dir-${dir}`,
                    ]));
                    expect(element!.classList.contains('cb-embedded')).toBe(embedded);
                    // One of each, never both.
                    expect(classesOf(element).filter(name => name.startsWith('cb-side-'))).toHaveLength(1);
                    expect(classesOf(element).filter(name => name.startsWith('cb-dir-'))).toHaveLength(1);
                }
            );
        });
    });

    it.each(SIDES.flatMap(side => DIRECTIONS.map(dir => [side, dir] as const)))(
        "places a closed floating chat's launcher by side %s in a %s page",
        (side, dir) => {
            const page = render(chat({ side, open: false }), region(dir));
            expect(panel(page)).toBeNull();
            expect(classesOf(launcher(page))).toEqual(expect.arrayContaining([
                'cb-chat-launcher',
                'cb-launcher-btn',
                `cb-side-${side}`,
                `cb-dir-${dir}`,
            ]));
        }
    );

    it('reads the direction again when the launcher gives way to the panel, and back', () => {
        const host = region('rtl');
        let page = render(chat({ side: 'start', open: false }), host);
        expect(classesOf(launcher(page))).toContain('cb-dir-rtl');

        page = render(chat({ side: 'start', open: true }), host);
        expect(launcher(page)).toBeNull();
        expect(classesOf(panel(page))).toEqual(expect.arrayContaining(['cb-side-start', 'cb-dir-rtl']));

        page = render(chat({ side: 'start', open: false }), host);
        expect(classesOf(launcher(page))).toEqual(expect.arrayContaining(['cb-side-start', 'cb-dir-rtl']));
    });

    it('treats a side that is not one (from a JavaScript host) as the default end', () => {
        const page = render(chat({ side: 'left' as unknown as ChatSide }));
        expect(classesOf(panel(page))).toContain('cb-side-end');
        expect(panel(page)!.className).not.toContain('cb-side-left');
    });

    it('changes side when the host passes another, without remounting the chat', () => {
        let page = render(chat({ mode: 'sidebar', embedded: true, side: 'end' }));
        const first = panel(page);
        page = render(chat({ mode: 'sidebar', embedded: true, side: 'start' }));
        expect(panel(page)).toBe(first);
        expect(classesOf(first)).toContain('cb-side-start');
        expect(classesOf(first)).not.toContain('cb-side-end');
    });
});

describe('ChatContainer — the direction it inherits', () => {
    it('is right-to-left under <html dir="rtl">, as Flowdit sets it for Arabic', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const page = render(chat());
        expect(classesOf(panel(page))).toContain('cb-dir-rtl');
    });

    it('is the nearest dir: left-to-right inside a left-to-right region of a right-to-left page', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const page = render(chat(), region('ltr'));
        expect(classesOf(panel(page))).toContain('cb-dir-ltr');
    });

    it("is what the browser computed, so a host stylesheet's `direction` counts as well as `dir`", () => {
        // jsdom resolves no `direction`; stand in for a stylesheet that sets
        // it on a class, with no `dir` attribute anywhere.
        const realStyle = window.getComputedStyle.bind(window);
        vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
            const style = realStyle(element, pseudo);
            const direction = element.closest('.host-rtl') ? 'rtl' : 'ltr';
            return new Proxy(style, {
                get(target, property) {
                    if (property === 'direction') return direction;
                    const value = Reflect.get(target, property);
                    return typeof value === 'function' ? value.bind(target) : value;
                },
            });
        });
        const host = document.createElement('div');
        host.className = 'host-rtl';
        document.body.appendChild(host);
        const page = render(chat(), host);
        expect(classesOf(panel(page))).toContain('cb-dir-rtl');
    });

    it('follows a dir the host changes after the chat is drawn, without a render of its own', async () => {
        const page = render(chat({ side: 'start' }));
        expect(classesOf(panel(page))).toContain('cb-dir-ltr');

        await act(async () => {
            document.documentElement.setAttribute('dir', 'rtl');
            // The observer reports in a microtask.
            await Promise.resolve();
        });
        expect(classesOf(panel(page))).toEqual(expect.arrayContaining(['cb-dir-rtl', 'cb-side-start']));

        await act(async () => {
            document.documentElement.setAttribute('dir', 'ltr');
            await Promise.resolve();
        });
        expect(classesOf(panel(page))).toContain('cb-dir-ltr');
    });

    it('stops listening once unmounted', async () => {
        const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
        render(chat());
        act(() => root?.unmount());
        root = null;
        expect(disconnect).toHaveBeenCalled();
    });

    it('gives the widgets inside the side and the direction through the presentation', () => {
        const probe = presentationProbe();
        render(chat({ mode: 'sidebar', side: 'start', header: <probe.Probe /> }), region('rtl'));
        expect(probe.last()).toMatchObject({ mode: 'sidebar', side: 'start', direction: 'rtl' });
    });
});

describe('ChatApp — side', () => {
    it("passes it to the container, and defaults to 'end'", () => {
        let page = render(<ChatApp mode="sidebar" embedded />);
        expect(classesOf(panel(page))).toContain('cb-side-end');

        act(() => root?.unmount());
        container?.remove();
        root = null;
        container = null;

        page = render(<ChatApp mode="sidebar" embedded side="start" />, region('rtl'));
        expect(classesOf(panel(page))).toEqual(expect.arrayContaining(['cb-side-start', 'cb-dir-rtl', 'cb-embedded']));
    });

    it('is a placement prop, not a provider prop: no "ignored" warning under a provider', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = render(
            <ChatbotProvider config={{}}>
                <ChatApp mode="floating" side="start" />
            </ChatbotProvider>
        );
        expect(classesOf(panel(page))).toContain('cb-side-start');
        expect(warn.mock.calls.filter(([message]) => String(message).includes('ignored'))).toEqual([]);
    });
});

/**
 * `launcher`: the host's own floating button, or none — for a host that opens
 * the chat from a control of its own, such as a button in its header.
 */
describe('ChatContainer and ChatApp — the launcher', () => {
    const closedFloating = (launcher?: React.ReactNode) => (
        <ChatbotProvider config={{}} open={false}>
            <ChatContainer mode="floating" launcher={launcher} header={null} sidebar={null}>
                <div className="transcript" />
            </ChatContainer>
        </ChatbotProvider>
    );

    it('draws nothing for a closed floating chat when the host passes null', () => {
        const page = render(closedFloating(null));
        expect(launcher(page)).toBeNull();
        expect(panel(page)).toBeNull();
        expect(page.innerHTML).toBe('');
    });

    it("draws the host's launcher, as it is, in place of the round button", () => {
        const page = render(closedFloating(<button type="button" className="host-launcher">AI</button>));
        expect(launcher(page)).toBeNull();
        expect(page.querySelector('.host-launcher')).not.toBeNull();
        expect(page.querySelector('.host-launcher')!.classList.contains('cb-chat-launcher')).toBe(false);
    });

    it('keeps the round button when the host passes nothing', () => {
        const page = render(closedFloating());
        expect(classesOf(launcher(page))).toContain('cb-chat-launcher');
    });

    it('leaves the open chat alone', () => {
        const page = render(
            <ChatbotProvider config={{}} open>
                <ChatContainer mode="floating" launcher={null} header={null} sidebar={null}>
                    <div className="transcript" />
                </ChatContainer>
            </ChatbotProvider>
        );
        expect(panel(page)).not.toBeNull();
    });

    it('is passed on by ChatApp, as a placement prop: no "ignored" warning under a provider', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const page = render(
            <ChatbotProvider config={{}} open={false}>
                <ChatApp mode="floating" launcher={null} />
            </ChatbotProvider>
        );
        expect(launcher(page)).toBeNull();
        expect(page.innerHTML).toBe('');
        expect(warn.mock.calls.filter(([message]) => String(message).includes('ignored'))).toEqual([]);
    });
});

/**
 * `welcomeIcon`: the mark above an empty conversation's greeting, passed the
 * way `launcherIcon` is — on the instance, else `config.icons.welcome`, else
 * the sparkle (2026-10-29: the host's assistant icon, not the library's).
 */
describe('ChatApp — the welcome icon', () => {
    const badge = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-welcome-sparkle-badge');
    const emptyChat = (props: { welcomeIcon?: React.ReactNode; icons?: { welcome: React.ReactNode } } = {}) => (
        <ChatbotProvider config={props.icons ? { icons: props.icons } : {}} open>
            <ChatApp mode="floating" welcomeIcon={props.welcomeIcon} />
        </ChatbotProvider>
    );

    it('draws the sparkle when the host passes nothing', () => {
        const page = render(emptyChat());
        expect(badge(page)!.querySelector('svg path')).not.toBeNull();
    });

    it("draws the host's icon, and it wins over config.icons.welcome", () => {
        const page = render(emptyChat({
            welcomeIcon: <i className="host-mark" />,
            icons: { welcome: <i className="config-mark" /> },
        }));
        expect(badge(page)!.querySelector('.host-mark')).not.toBeNull();
        expect(badge(page)!.querySelector('.config-mark')).toBeNull();
    });

    it('falls back to config.icons.welcome', () => {
        const page = render(emptyChat({ icons: { welcome: <i className="config-mark" /> } }));
        expect(badge(page)!.querySelector('.config-mark')).not.toBeNull();
    });

    it('is passed on by ChatApp, as a placement prop: no "ignored" warning under a provider', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        render(emptyChat({ welcomeIcon: <i className="host-mark" /> }));
        expect(warn.mock.calls.filter(([message]) => String(message).includes('ignored'))).toEqual([]);
    });

    it('is hidden from screen readers: the greeting under it says what it is', () => {
        const page = render(emptyChat({ welcomeIcon: <i className="host-mark" /> }));
        expect(badge(page)!.getAttribute('aria-hidden')).toBe('true');
    });
});

/**
 * The conversation sidebar across presentations (2026-10-22): open as
 * fullscreen's column it is part of the page; the same state in an overlay is
 * a drawer over the transcript. Leaving the column closes it, and a column
 * coming back reopens it if it was open as the last one was left.
 */
describe('ChatContainer — the sidebar when the column comes and goes', () => {
    /** A viewport whose width the test sets, as `matchMedia` reports it. */
    function viewport(wide: boolean) {
        const listeners = new Set<() => void>();
        const query = {
            matches: wide,
            addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
            removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
        };
        vi.stubGlobal('matchMedia', vi.fn(() => query));
        return {
            resize(next: boolean) {
                query.matches = next;
                act(() => listeners.forEach(listener => listener()));
            },
        };
    }

    const sidebar = { open: false };
    const SidebarProbe: React.FC = () => {
        sidebar.open = useChatState(s => s.isSidebarOpen);
        return null;
    };

    function chatIn(mode: ChatMode, defaultSidebarOpen = false) {
        return (
            <ChatbotProvider config={{}} open defaultSidebarOpen={defaultSidebarOpen}>
                <ChatContainer mode={mode} header={null} sidebar={<div className="probe-sidebar" />}>
                    <div className="transcript" />
                </ChatContainer>
                <SidebarProbe />
            </ChatbotProvider>
        );
    }
    const drawer = (page: HTMLElement) => page.querySelector('.cb-drawer-wrapper');

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('closes the sidebar when fullscreen, with its column open, is left for an overlay', () => {
        viewport(true);
        let page = render(chatIn('fullscreen', true));
        expect(sidebar.open).toBe(true);

        page = render(chatIn('floating', true));
        expect(sidebar.open).toBe(false);
        expect(drawer(page)!.classList.contains('open')).toBe(false);

        // And a docked panel likewise: its drawer is an overlay too.
        page = render(chatIn('fullscreen', true));
        expect(sidebar.open).toBe(true);
        page = render(chatIn('sidebar', true));
        expect(sidebar.open).toBe(false);
    });

    it('reopens the column when fullscreen comes back, as it was left', () => {
        viewport(true);
        render(chatIn('fullscreen', true));
        render(chatIn('floating', true));
        expect(sidebar.open).toBe(false);

        const page = render(chatIn('fullscreen', true));
        expect(sidebar.open).toBe(true);
        expect(drawer(page)!.classList.contains('open')).toBe(true);
    });

    it('keeps a column the user had shut, shut', () => {
        viewport(true);
        render(chatIn('fullscreen'));
        render(chatIn('floating'));
        render(chatIn('fullscreen'));
        expect(sidebar.open).toBe(false);
    });

    it('closes it when the viewport narrows under a fullscreen chat, and reopens it as it widens', () => {
        const screen = viewport(true);
        render(chatIn('fullscreen', true));
        screen.resize(false);
        expect(sidebar.open).toBe(false);
        screen.resize(true);
        expect(sidebar.open).toBe(true);
    });

    it('leaves a sidebar opened in an overlay alone: only the column leaving closes it', () => {
        viewport(true);
        render(chatIn('floating', true));
        expect(sidebar.open).toBe(true);
        // Into fullscreen it becomes the column, still open.
        render(chatIn('fullscreen', true));
        expect(sidebar.open).toBe(true);
    });
});

describe('ChatRoot — side and direction', () => {
    it('stamps both on the root and gives them to the widgets inside', () => {
        const probe = presentationProbe();
        const page = render(<ChatRoot side="start"><probe.Probe /></ChatRoot>, region('rtl'));
        const rootElement = page.querySelector('.cb-root');
        expect(classesOf(rootElement)).toEqual(expect.arrayContaining(['cb-root', 'cb-side-start', 'cb-dir-rtl']));
        expect(probe.last()).toMatchObject({ side: 'start', direction: 'rtl' });
    });

    it("defaults to 'end' in the page's direction, and keeps the host's class", () => {
        const page = render(<ChatRoot className="host-hero"><span /></ChatRoot>);
        expect(classesOf(page.querySelector('.cb-root'))).toEqual(['cb-root', 'cb-side-end', 'cb-dir-ltr', 'host-hero']);
    });
});

describe('readDirection', () => {
    it("is the computed direction where the browser resolves one, the nearest dir where it does not", () => {
        const rtl = region('rtl');
        const inner = document.createElement('span');
        inner.setAttribute('dir', 'auto');
        rtl.appendChild(inner);
        // `dir="auto"` is not a direction of its own here: the nearest explicit one is.
        expect(readDirection(inner)).toBe('rtl');
        expect(readDirection(region('ltr'))).toBe('ltr');
        expect(readDirection(document.body)).toBe('ltr');

        vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ direction: 'ltr' }) as CSSStyleDeclaration);
        expect(readDirection(inner)).toBe('ltr');
    });
});
