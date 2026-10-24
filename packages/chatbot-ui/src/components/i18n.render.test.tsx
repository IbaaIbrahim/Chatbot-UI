// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { StreamChatClient } from '../api/StreamClient';
import type { ChatbotConfig } from '../common/chatbotConfig';
import type { ChatTranslations } from '../common/labels';
import { ChatbotProvider } from '../context/ChatbotContext';
import { useChatFormat, useChatLanguage, useLabels } from '../store/hooks';
import { AttachmentViewerModal } from './AttachmentViewer/AttachmentViewer';
import { ChatContainer } from './ChatContainer/ChatContainer';
import { ChatRoot } from './ChatRoot/ChatRoot';
import { Composer } from './Composer/Composer';
import { MarkdownContent } from './MarkdownContent/MarkdownContent';
import { MessageBubble, type MessageStep } from './MessageBubble/MessageBubble';

// The attachment viewer's PDF library needs DOMMatrix, which jsdom lacks.
vi.mock('react-pdf', () => ({
    Document: () => null,
    Page: () => null,
    pdfjs: { GlobalWorkerOptions: {}, version: 'test' },
}));

/**
 * The chat in the host's language (2026-10-18), on screen: the labels of
 * `config.translations` for `config.language`, English for what a language
 * leaves out, a switch followed at once, `lang` on the chat, and `dir="auto"`
 * on text whose direction may differ from the page's — without moving the
 * chat, whose layout keeps the page's direction.
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
    document.documentElement.removeAttribute('lang');
    vi.restoreAllMocks();
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

async function settle(): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
    });
}

const TRANSLATIONS: ChatTranslations = {
    de: {
        greetingTitle: 'Was möchtest du tun?',
        composerPlaceholder: 'Beschreibe, was du tun willst…',
        activityThoughts: { one: 'einmal gedacht', other: '{count}-mal gedacht' },
    },
    ar: {
        greetingTitle: 'ماذا تريد أن تفعل؟',
        composerPlaceholder: 'صف ما تريد فعله…',
        activityThoughts: {
            zero: 'لم يفكر',
            one: 'فكّر مرة',
            two: 'فكّر مرتين',
            few: 'فكّر {count} مرات',
            many: 'فكّر {count} مرة',
            other: 'فكّر {count} مرة',
        },
    },
};

const SUGGESTIONS: ChatbotConfig['suggestions'] = [
    { id: 's1', text: 'What changed this week?', icon: 'pin' },
];

function chat(config: ChatbotConfig, mode: 'floating' | 'fullscreen' = 'floating', client?: StreamChatClient) {
    return (
        <ChatbotProvider config={config} client={client}>
            <ChatContainer mode={mode} footer={<Composer />} />
        </ChatbotProvider>
    );
}

const panel = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-chat-container')!;
const greeting = (page: HTMLElement) => page.querySelector<HTMLElement>('.cb-welcome-title')!;
const composer = (page: HTMLElement) => page.querySelector<HTMLTextAreaElement>('.cb-composer-textarea');

describe('the chat in a language', () => {
    it('shows the translation for config.language, and says it with lang', () => {
        const page = render(chat({ language: 'de', translations: TRANSLATIONS, suggestions: SUGGESTIONS }));

        expect(greeting(page).textContent).toBe('Was möchtest du tun?');
        expect(panel(page).getAttribute('lang')).toBe('de');
        // Left out of the German: the library's English.
        expect(page.querySelector('.cb-composer-footer-note')?.textContent).toBe('This is AI, and can make mistakes. Verify results.');
    });

    it('follows a switch of language at once, and falls back to English for one it has no translation for', () => {
        let page = render(chat({ language: 'de', translations: TRANSLATIONS }));
        expect(greeting(page).textContent).toBe('Was möchtest du tun?');

        page = render(chat({ language: 'ar', translations: TRANSLATIONS }));
        expect(greeting(page).textContent).toBe('ماذا تريد أن تفعل؟');
        expect(panel(page).getAttribute('lang')).toBe('ar');

        page = render(chat({ language: 'fr', translations: TRANSLATIONS }));
        expect(greeting(page).textContent).toBe('What would you like to do?');
        expect(panel(page).getAttribute('lang')).toBe('fr');
    });

    it('sets no lang of its own without a language, and keeps 4.1\'s labels as overrides', () => {
        const page = render(chat({ labels: { greetingTitle: 'Hallo!' }, translations: TRANSLATIONS, language: 'ar' }));
        expect(greeting(page).textContent).toBe('Hallo!');

        const plain = render(chat({}));
        expect(panel(plain).hasAttribute('lang')).toBe(false);
    });

    it('formats in the page\'s language without one, and in its own with one', () => {
        document.documentElement.setAttribute('lang', 'de');
        const seen: Array<string | undefined> = [];
        const Probe: React.FC = () => {
            seen.push(useChatLanguage());
            seen.push(useChatFormat().number(1250));
            return null;
        };
        render(<ChatbotProvider config={{}}><Probe /></ChatbotProvider>);
        expect(seen.slice(-2)).toEqual(['de', '1.250']);

        render(<ChatbotProvider config={{ language: 'en' }}><Probe /></ChatbotProvider>);
        expect(seen.slice(-2)).toEqual(['en', '1,250']);
    });

    it('keeps the layout in the page\'s direction, whatever the language', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const page = render(chat({ language: 'en' }));
        expect(panel(page).classList.contains('cb-dir-rtl')).toBe(true);
        expect(panel(page).hasAttribute('dir')).toBe(false);
        expect(panel(page).getAttribute('lang')).toBe('en');
    });

    it('says its language on ChatRoot, and on the viewer, which is a portal outside the chat', () => {
        // No token: the viewer's fetch fails, and says so on the console.
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const page = render(
            <ChatbotProvider config={{ language: 'ar', translations: { ar: { attachmentName: 'مرفق' } } }}>
                <ChatRoot><span /></ChatRoot>
                <AttachmentViewerModal attachment={{ id: 'a', type: 'file', url: '/x' }} isOpen onClose={() => undefined} />
            </ChatbotProvider>
        );
        expect(page.querySelector('.cb-root')?.getAttribute('lang')).toBe('ar');
        const overlay = document.body.querySelector<HTMLElement>('.cb-attachment-viewer-overlay')!;
        expect(overlay.getAttribute('lang')).toBe('ar');
        expect(overlay.querySelector('.cb-attachment-viewer-filename')?.textContent).toBe('مرفق');
    });

    it('counts in the language\'s plural forms: Arabic\'s dual', () => {
        const thought = (id: string): MessageStep => ({ id, type: 'thinking', content: '…', isFinished: true });
        const page = render(
            <ChatbotProvider config={{ language: 'ar', translations: TRANSLATIONS }}>
                <MessageBubble id="m" role="assistant" shouldAnimate={false} steps={[thought('a'), thought('b'), { id: 'x', type: 'text', content: 'تم.' }]} />
            </ChatbotProvider>
        );
        expect(page.querySelector('.cb-activity-text')?.textContent).toBe('فكّر مرتين');
    });

    it('still reads a 4.1 host\'s one/other labels', () => {
        const thought = (id: string): MessageStep => ({ id, type: 'thinking', content: '…', isFinished: true });
        const page = render(
            <ChatbotProvider config={{ labels: { activityThoughtOne: 'einmal gedacht', activityThoughtOther: '{count}-mal gedacht' } }}>
                <MessageBubble id="m" role="assistant" shouldAnimate={false} steps={[thought('a'), thought('b'), thought('c'), { id: 'x', type: 'text', content: 'OK' }]} />
            </ChatbotProvider>
        );
        expect(page.querySelector('.cb-activity-text')?.textContent).toBe('3-mal gedacht');
    });

    it('re-renders what reads the labels when the language changes', () => {
        const Probe: React.FC = () => <span className="probe">{useLabels().newChat}</span>;
        let page = render(<ChatbotProvider config={{ language: 'de', translations: { de: { newChat: 'Neuer Chat' } } }}><Probe /></ChatbotProvider>);
        expect(page.querySelector('.probe')?.textContent).toBe('Neuer Chat');
        page = render(<ChatbotProvider config={{ language: 'en', translations: { de: { newChat: 'Neuer Chat' } } }}><Probe /></ChatbotProvider>);
        expect(page.querySelector('.probe')?.textContent).toBe('New chat');
    });
});

describe('text in its own direction (dir="auto")', () => {
    it('is the greeting, the suggestions and the composer', () => {
        document.documentElement.setAttribute('dir', 'rtl');
        const page = render(chat({ suggestions: SUGGESTIONS }));

        expect(greeting(page).getAttribute('dir')).toBe('auto');
        expect(page.querySelector('.cb-suggestion-text')?.getAttribute('dir')).toBe('auto');
        expect(composer(page)?.getAttribute('dir')).toBe('auto');
        // Aligned as the chat is, not by its own direction.
        expect(greeting(page).classList.contains('cb-bidi')).toBe(true);
    });

    it('is the quick actions and the feature cards', () => {
        const page = render(chat({
            quickActions: [{ id: 'q', label: 'Summarise', prompts: [{ id: 'p', label: 'Last week' }] }],
            featureCards: [{ id: 'f', title: 'Reports', description: 'Draft one.', icon: 'chart' }],
        }, 'fullscreen'));

        const pill = page.querySelector<HTMLButtonElement>('.cb-welcome-quick-action-pill')!;
        expect(pill.querySelector('[dir="auto"]')?.textContent).toBe('Summarise');
        act(() => pill.click());
        expect(page.querySelector('.cb-welcome-prompt-text')?.getAttribute('dir')).toBe('auto');
        expect(page.querySelector('.cb-feature-card-title')?.getAttribute('dir')).toBe('auto');
        expect(page.querySelector('.cb-feature-card-desc')?.getAttribute('dir')).toBe('auto');
    });

    it('is every paragraph, list item, heading and cell of an answer — and not code', () => {
        const page = render(
            <MarkdownContent content={'# Title\n\nAn English line.\n\n- واحد\n- two\n\n> quoted\n\n| a | b |\n| - | - |\n| ج | d |\n\n```\ncode\n```'} />
        );
        ['h1', 'p', 'li', 'blockquote', 'th', 'td'].forEach(tag => {
            const elements = Array.from(page.querySelectorAll(tag));
            expect(`${tag}: ${elements.length > 0}`).toBe(`${tag}: true`);
            elements.forEach(element => expect(`${tag}: ${element.getAttribute('dir')}`).toBe(`${tag}: auto`));
        });
        expect(page.querySelector('pre')?.hasAttribute('dir')).toBe(false);
    });

    it('is a conversation\'s title in the sidebar', async () => {
        const now = new Date().toISOString();
        const client = {
            sendMessage: async () => undefined,
            getConversationId: () => null,
            setConversationId: () => undefined,
            getConversations: async (_offset: number, _limit: number, options?: { starred?: boolean }) => ({
                items: options?.starred ? [] : [{ uuid: 'c1', title: 'تقرير الفحص', created_at: now, updated_at: now }],
                pagination: { total: options?.starred ? 0 : 1, page: 1, per_page: 20, pages: 1 },
            }),
            getConversationDetail: async (id: string) => ({ uuid: id, title: '', created_at: '', updated_at: '', jobs: [] }),
        } as unknown as StreamChatClient;
        const page = render(
            <ChatbotProvider config={{}} client={client} defaultSidebarOpen>
                <ChatContainer mode="fullscreen" />
            </ChatbotProvider>
        );
        await settle();

        const title = page.querySelector<HTMLElement>('.cb-conversation-title');
        expect(title?.textContent).toBe('تقرير الفحص');
        expect(title?.getAttribute('dir')).toBe('auto');
        expect(page.querySelector('.cb-drawer-search-input')?.getAttribute('dir')).toBe('auto');
    });

    it('is an attachment\'s name and an error\'s text in a message', () => {
        const page = render(
            <ChatbotProvider config={{}}>
                <MessageBubble
                    id="u"
                    role="user"
                    content="see"
                    steps={[{ id: 's', type: 'text', content: 'see' }]}
                    attachments={[{ id: 'f', type: 'file', url: '/f', name: 'تقرير.pdf', size: 2048 }]}
                />
                <MessageBubble id="a" role="assistant" steps={[{ id: 'e', type: 'error', content: 'Quota exceeded', recovery: 'retry' }]} />
            </ChatbotProvider>
        );
        expect(page.querySelector('.cb-att-chip-name')?.getAttribute('dir')).toBe('auto');
        expect(page.querySelector('.cb-att-chip-size')?.textContent).toBe('2.0 KB');
        expect(page.querySelector('.cb-error-text')?.getAttribute('dir')).toBe('auto');
    });
});
