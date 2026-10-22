import { describe, expect, it } from 'vitest';
import { mergeChatbotConfig, resolveChatbotConfig, DEFAULT_CHATBOT_CONFIG } from './chatbotConfig';
import {
    createChatFormat,
    describeLabelledError,
    labelledError,
    languageFallbacks,
    missingTranslations,
    resolveLabels,
} from './i18n';
import {
    DEFAULT_LABELS,
    DEPRECATED_LABEL_ALIASES,
    LABEL_KEYS,
    PLURAL_LABEL_KEYS,
    formatCount,
    formatLabel,
    formatPlural,
    labelPlaceholders,
    pluralCategory,
    type ChatTranslations,
    type PluralLabel,
} from './labels';
import { describeStreamError } from '../hooks/useStreamChat';
import { summarizeActivity } from './activity';
import type { MessageStep } from '../components/MessageBubble/MessageBubble';

/**
 * The chat in any language (2026-10-18): which text each label shows for the
 * language in force, how a counting label picks its form, how numbers and
 * dates are written, and how the 4.1 names of the counting labels still work.
 */

const ARABIC_FILES: PluralLabel = {
    zero: 'لا ملفات',
    one: 'ملف واحد',
    two: 'ملفان',
    few: '{count} ملفات',
    many: '{count} ملفًا',
    other: '{count} ملف',
};

const TRANSLATIONS: ChatTranslations = {
    de: { newChat: 'Neuer Chat', starred: 'Markiert', filesItems: { one: '{count} Element', other: '{count} Elemente' } },
    'de-AT': { newChat: 'Neuer Plausch' },
    ar: { newChat: 'محادثة جديدة', filesItems: ARABIC_FILES },
    ru: { filesItems: { one: '{count} элемент', few: '{count} элемента', many: '{count} элементов', other: '{count} элемента' } },
    pl: { filesItems: { one: '{count} element', few: '{count} elementy', many: '{count} elementów', other: '{count} elementu' } },
};

describe('resolveLabels — which text a label shows', () => {
    it('is the library\'s English with nothing given', () => {
        const labels = resolveLabels();
        LABEL_KEYS.forEach(key => expect(labels[key]).toEqual(DEFAULT_LABELS[key]));
    });

    it('takes the language\'s translation, and English for what it leaves out', () => {
        const labels = resolveLabels('de', TRANSLATIONS);
        expect(labels.newChat).toBe('Neuer Chat');
        expect(labels.starred).toBe('Markiert');
        expect(labels.recents).toBe('Recents');
    });

    it('falls back from a regional tag to its base language, matching tags without regard to case', () => {
        const labels = resolveLabels('de-AT', TRANSLATIONS);
        expect(labels.newChat).toBe('Neuer Plausch');
        expect(labels.starred).toBe('Markiert');
        expect(resolveLabels('DE-at', TRANSLATIONS).newChat).toBe('Neuer Plausch');
        expect(resolveLabels('de_CH', TRANSLATIONS).newChat).toBe('Neuer Chat');
        expect(resolveLabels('de', { DE: { newChat: 'Gross' } }).newChat).toBe('Gross');
        expect(languageFallbacks('zh-Hant-TW')).toEqual(['zh-hant-tw', 'zh-hant', 'zh']);
    });

    it('lets an explicit label win in every language, as 4.1\'s labels did', () => {
        const labels = resolveLabels('de', TRANSLATIONS, { newChat: 'Start over' });
        expect(labels.newChat).toBe('Start over');
        expect(labels.starred).toBe('Markiert');
    });

    it('lets translations.en reword the English, also as the fallback of another language', () => {
        const translations: ChatTranslations = { ...TRANSLATIONS, en: { recents: 'Recent chats', newChat: 'New conversation' } };
        expect(resolveLabels('en-GB', translations).recents).toBe('Recent chats');
        expect(resolveLabels(undefined, translations).newChat).toBe('New conversation');
        expect(resolveLabels('de', translations).recents).toBe('Recent chats');
        expect(resolveLabels('de', translations).newChat).toBe('Neuer Chat');
    });

    it('treats an empty or blank value as missing', () => {
        const labels = resolveLabels('de', { de: { newChat: '', starred: '   ', recents: 'Zuletzt' } }, { recents: '' });
        expect(labels.newChat).toBe('New chat');
        expect(labels.starred).toBe('Starred');
        expect(labels.recents).toBe('Zuletzt');
    });

    it('drops empty plural forms, and fills a form a language does not name from its own other', () => {
        const labels = resolveLabels('ar', { ar: { filesItems: { one: 'ملف واحد', two: '', other: '{count} ملف' } } });
        expect(formatPlural(labels.filesItems, 1)).toBe('ملف واحد');
        expect(formatPlural(labels.filesItems, 2)).toBe('2 ملف');
    });

    it('gives a counting label as plural forms even when a text was given', () => {
        const labels = resolveLabels('de', { de: { credits: '{count} Kredite' } });
        expect(labels.credits).toEqual({ other: '{count} Kredite' });
        expect(formatPlural(labels.credits, 1)).toBe('1 Kredite');
    });

    it('resolves again for another language — a switch at runtime', () => {
        expect(resolveLabels('de', TRANSLATIONS).newChat).toBe('Neuer Chat');
        expect(resolveLabels('ar', TRANSLATIONS).newChat).toBe('محادثة جديدة');
        expect(resolveLabels('fr', TRANSLATIONS).newChat).toBe('New chat');
    });
});

describe('plural labels', () => {
    it('choose the form by the language\'s rules: English', () => {
        const labels = resolveLabels('en');
        expect(formatPlural(labels.filesItems, 1, {}, 'en')).toBe('1 item');
        expect(formatPlural(labels.filesItems, 0, {}, 'en')).toBe('0 items');
        expect(formatPlural(labels.filesItems, 1250, {}, 'en')).toBe('1,250 items');
    });

    it('choose the form by the language\'s rules: Arabic, all six', () => {
        const labels = resolveLabels('ar', TRANSLATIONS);
        const say = (count: number) => formatPlural(labels.filesItems, count, {}, 'ar');
        expect(say(0)).toBe('لا ملفات');
        expect(say(1)).toBe('ملف واحد');
        expect(say(2)).toBe('ملفان');
        expect(say(3)).toContain('ملفات');
        expect(say(11)).toContain('ملفًا');
        expect(say(100)).toContain('ملف');
        expect(['zero', 'one', 'two', 'few', 'many', 'other'].map(category => category))
            .toEqual([0, 1, 2, 3, 11, 100].map(count => pluralCategory(count, 'ar')));
    });

    it('choose the form by the language\'s rules: Russian and Polish', () => {
        const ru = resolveLabels('ru', TRANSLATIONS);
        expect(formatPlural(ru.filesItems, 1, {}, 'ru')).toBe('1 элемент');
        expect(formatPlural(ru.filesItems, 3, {}, 'ru')).toBe('3 элемента');
        expect(formatPlural(ru.filesItems, 5, {}, 'ru')).toBe('5 элементов');
        expect(formatPlural(ru.filesItems, 21, {}, 'ru')).toBe('21 элемент');

        const pl = resolveLabels('pl', TRANSLATIONS);
        expect(formatPlural(pl.filesItems, 1, {}, 'pl')).toBe('1 element');
        expect(formatPlural(pl.filesItems, 22, {}, 'pl')).toBe('22 elementy');
        expect(formatPlural(pl.filesItems, 25, {}, 'pl')).toBe('25 elementów');
    });

    it('use the English rules for the English a missing translation fell back to', () => {
        // French counts 0 as `one`: the English "0 credit" would be wrong.
        const labels = resolveLabels('fr', TRANSLATIONS);
        expect(formatPlural(labels.credits, 0, {}, 'fr')).toBe('0 credits');
        expect(formatPlural(labels.credits, 1, {}, 'fr')).toBe('1 credit');
    });

    it('write the count for the language, and let a given value win', () => {
        expect(formatPlural(DEFAULT_LABELS.credits, 1250, {}, 'de')).toBe('1.250 credits');
        expect(formatPlural(DEFAULT_LABELS.credits, 2, { count: 'two' })).toBe('two credits');
        expect(formatPlural('{count} files', 3)).toBe('3 files');
    });

    it('are every counting label the library has, each with other', () => {
        expect(PLURAL_LABEL_KEYS).toEqual(expect.arrayContaining([
            'credits', 'steps', 'turns', 'creditsLeft', 'filesItems', 'filesSavedCount', 'uploadingFiles',
            'activityThoughts', 'activitySearches', 'activitySkillLoads', 'activityToolLoads',
            'activityRanToolTimes', 'activityRanTools', 'activityUsedAgents', 'activityFailed',
            'metaRefused', 'usageSubAgents', 'previewTruncated',
        ]));
        PLURAL_LABEL_KEYS.forEach(key => expect((DEFAULT_LABELS[key] as PluralLabel).other).toBeTruthy());
    });

    it('keep formatCount, English\'s one/other, for hosts that call it', () => {
        expect(formatCount(1, '{count} file', '{count} files')).toBe('1 file');
        expect(formatCount(0, '{count} file', '{count} files')).toBe('0 files');
    });
});

describe('the 4.1 names of the counting labels', () => {
    it('fill the plural label\'s forms', () => {
        const labels = resolveLabels(undefined, undefined, { creditsOne: '{count} Kredit', creditsOther: '{count} Kredite' });
        expect(labels.credits).toEqual({ one: '{count} Kredit', other: '{count} Kredite' });
    });

    it('patch only the form given, the rest from beneath', () => {
        const labels = resolveLabels('de', TRANSLATIONS, { filesItemsOne: 'ein Ding' });
        expect(formatPlural(labels.filesItems, 1)).toBe('ein Ding');
        expect(formatPlural(labels.filesItems, 4)).toBe('4 Elemente');
        expect(resolveLabels(undefined, undefined, { stepsOne: 'one step' }).steps).toEqual({ one: 'one step', other: '{count} steps' });
    });

    it('rename the labels that were not pairs', () => {
        const labels = resolveLabels(undefined, undefined, {
            activityRanOne: 'lief {name}',
            activityRanRepeated: 'lief {name} {count}-mal',
            activityRanOther: '{count} Werkzeuge',
            activityAgentOne: 'nutzte {name}',
            activityAgentOther: '{count} Agenten',
        });
        expect(labels.activityRanTool).toBe('lief {name}');
        expect(labels.activityRanToolTimes).toEqual({ other: 'lief {name} {count}-mal' });
        expect(labels.activityRanTools).toEqual({ other: '{count} Werkzeuge' });
        expect(labels.activityUsedAgent).toBe('nutzte {name}');
        expect(labels.activityUsedAgents).toEqual({ other: '{count} Agenten' });
    });

    it('lose to the new name given beside them', () => {
        const labels = resolveLabels(undefined, undefined, { creditsOne: 'old', credits: { one: 'new', other: 'news' } });
        expect(labels.credits).toEqual({ one: 'new', other: 'news' });
    });

    it('work in a translation too', () => {
        const labels = resolveLabels('de', { de: { turnsOne: '{count} Runde', turnsOther: '{count} Runden' } });
        expect(formatPlural(labels.turns, 3, {}, 'de')).toBe('3 Runden');
    });

    it('still read in the activity header', () => {
        const thought: MessageStep = { id: 't', type: 'thinking', isFinished: true };
        const labels = resolveLabels('de', undefined, { activityThoughtOne: 'einmal gedacht', activityThoughtOther: '{count}-mal gedacht' });
        expect(summarizeActivity([thought, { ...thought, id: 't2' }], labels, undefined, 'de')).toBe('2-mal gedacht');
        expect(summarizeActivity([thought], labels, undefined, 'de')).toBe('Einmal gedacht');
    });

    it('each name a label that exists', () => {
        Object.values(DEPRECATED_LABEL_ALIASES).forEach(({ key }) => expect(LABEL_KEYS).toContain(key));
    });

    it('patch the forms beneath even when a lone one gives other: "1 credit" stays as 4.1 showed it', () => {
        const credits = resolveLabels(undefined, undefined, { creditsOther: '{count} kredits' }).credits;
        expect(formatPlural(credits, 1)).toBe('1 credit');
        expect(formatPlural(credits, 3)).toBe('3 kredits');
        const thoughts = resolveLabels(undefined, undefined, { activityThoughtOther: 'pondered {count} times' }).activityThoughts;
        expect(formatPlural(thoughts, 1)).toBe('thought once');
        expect(formatPlural(thoughts, 2)).toBe('pondered 2 times');
        const items = resolveChatbotConfig([{ labels: { filesItemsOther: '{count} things' } }]).labels.filesItems;
        expect(formatPlural(items, 1)).toBe('1 item');
        // Over a translation, the translation's other forms stay too.
        const german = resolveLabels('de', { de: { credits: { one: '{count} Guthabenpunkt', other: '{count} Guthabenpunkte' } } }, { creditsOther: '{count} Credits' }).credits;
        expect(formatPlural(german, 1, {}, 'de')).toBe('1 Guthabenpunkt');
        expect(formatPlural(german, 4, {}, 'de')).toBe('4 Credits');
    });

    it('can still be read, as the texts 4.1 had, and are not among the keys', () => {
        const labels = resolveLabels('de', TRANSLATIONS);
        expect(labels.creditsOne).toBe('{count} credit');
        expect(labels.creditsOther).toBe('{count} credits');
        expect(labels.filesItemsOne).toBe('{count} Element');
        expect(labels.activityRanRepeated).toBe('ran {name} {count} times');
        expect(DEFAULT_LABELS.stepsOther).toBe('{count} steps');
        expect(formatCount(3, labels.creditsOne, labels.creditsOther)).toBe('3 credits');
        expect(formatCount(1, labels.creditsOne, labels.creditsOther)).toBe('1 credit');
        expect(Object.keys(labels)).toEqual([...LABEL_KEYS]);
        expect(Object.keys(labels)).not.toContain('creditsOne');
        expect(JSON.stringify(labels)).not.toContain('creditsOne');
    });

    it('leave formatLabel working on a label that counts since 4.2', () => {
        expect(formatLabel(DEFAULT_LABELS.uploadingFiles, { count: 3 })).toBe('Uploading 3 files…');
        expect(formatLabel(DEFAULT_LABELS.uploadingFiles, { count: 1 })).toBe('Uploading 1 file…');
        expect(formatLabel(DEFAULT_LABELS.metaRefused, { count: 2 })).toBe('2 refused');
        expect(formatLabel(DEFAULT_LABELS.previewTruncated, { shown: 5, total: 9 })).toBe('First 5 of 9 rows');
    });

    it('still fill the activity header from a hand-made 4.1 object', () => {
        const thought: MessageStep = { id: 't', type: 'thinking', isFinished: true };
        const call = (id: string, toolSlug: string): MessageStep => ({ id, type: 'tool-call', toolSlug, toolStatus: 'completed' });
        // What a 4.1 host built by hand: the old pairs, no new names.
        const { activityThoughts, activitySearches, activitySkillLoads, activityToolLoads, activityRanTool,
            activityRanToolTimes, activityRanTools, activityUsedAgent, activityUsedAgents, ...rest } = DEFAULT_LABELS;
        const legacy = {
            ...rest,
            activityThoughtOne: 'thought once (4.1)',
            activityThoughtOther: 'thought {count} times (4.1)',
            activityRanOne: 'ran {name} (4.1)',
            activityRanOther: 'ran {count} tools (4.1)',
        };
        expect(summarizeActivity([thought, { ...thought, id: 't2' }], legacy)).toBe('Thought 2 times (4.1)');
        expect(summarizeActivity([thought, call('c1', 'web_search')], legacy)).toBe('Thought once (4.1) · ran Web search (4.1)');
        expect(summarizeActivity([call('c1', 'web_search'), call('c2', 'fetch_web_page')], legacy)).toBe('Ran 2 tools (4.1)');
        // The ones it does not give are the library's English.
        expect(summarizeActivity([call('c1', 'search_tools'), call('c2', 'load_skill')], legacy)).toBe('Searched once · loaded a skill');
    });
});

describe('missingTranslations', () => {
    it('lists what a language lacks, counting its base language', () => {
        const missing = missingTranslations(TRANSLATIONS, 'de-AT');
        expect(missing).not.toContain('newChat');
        expect(missing).not.toContain('starred');
        expect(missing).not.toContain('filesItems');
        expect(missing).toContain('recents');
        expect(missing).toHaveLength(LABEL_KEYS.length - 3);
    });

    it('lists every language\'s, by its tag, without one', () => {
        const all = missingTranslations({ de: { newChat: 'Neu' }, ar: {} });
        expect(Object.keys(all)).toEqual(['de', 'ar']);
        expect(all.de).toHaveLength(LABEL_KEYS.length - 1);
        expect(all.ar).toEqual(LABEL_KEYS);
    });

    it('counts a deprecated name for its label, once it has other', () => {
        expect(missingTranslations({ de: { creditsOne: 'x' } }, 'de')).toContain('credits');
        expect(missingTranslations({ de: { creditsOne: 'x', creditsOther: 'y' } }, 'de')).not.toContain('credits');
    });
});

describe('labelPlaceholders', () => {
    it('lists a label\'s placeholders over all its forms', () => {
        expect(labelPlaceholders(DEFAULT_LABELS.fileTooLarge)).toEqual(['max', 'size']);
        expect(labelPlaceholders(DEFAULT_LABELS.activityThoughts)).toEqual(['count']);
        expect(labelPlaceholders(DEFAULT_LABELS.newChat)).toEqual([]);
    });
});

describe('createChatFormat — numbers, sizes, dates and lists in the language', () => {
    const NOW = Date.parse('2026-10-18T12:00:00Z');
    const ago = (ms: number) => new Date(NOW - ms).toISOString();

    it('writes English as before 4.2', () => {
        const format = createChatFormat(DEFAULT_LABELS, 'en');
        expect(format.number(1250)).toBe('1,250');
        expect(format.fileSize(512)).toBe('512 B');
        expect(format.fileSize(2048)).toBe('2.0 KB');
        expect(format.fileSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
        expect(format.percent(0.123)).toBe('12%');
        expect(format.percent(0.05)).toBe('5.0%');
        expect(format.percent(0.996)).toBe('100%');
        expect(format.list(['a', 'b'])).toBe('a, b');
        expect(format.duration(45)).toBe('45 s');
        expect(format.duration(303)).toBe('5 min 3 s');
        expect(format.tokens(999)).toBe('999');
        expect(format.tokens(1234)).toBe('1.2k');
        expect(format.tokens(12_345)).toBe('12k');
        expect(format.tokens(1_500_000)).toBe('1.5M');
        expect(format.tokens(2_000_000)).toBe('2M');
        expect(format.relativeDate(ago(5 * 60 * 1000), NOW)).toBe('5 minutes ago');
    });

    it('writes German as German', () => {
        const labels = resolveLabels('de', { de: { fileSizeKilobytes: '{size} KB' } });
        const format = createChatFormat(labels, 'de');
        expect(format.locale).toBe('de');
        expect(format.number(1250)).toBe('1.250');
        expect(format.fileSize(2048)).toBe('2,0 KB');
        expect(format.percent(0.12)).toMatch(/^12\s?%$/);
        expect(format.list(['a', 'b'])).toBe('a und b');
        expect(format.relativeDate(ago(5 * 60 * 1000), NOW)).toBe('vor 5 Minuten');
        expect(format.dateTime('2026-10-14T09:30:00Z')).toMatch(/2026/);
        expect(format.date('2026-10-14T09:30:00Z')).toMatch(/Okt/);
        expect(format.plural(labels.credits, 1250)).toBe('1.250 credits');
    });

    it('writes the units a language gives', () => {
        const labels = resolveLabels('ar', { ar: { fileSizeKilobytes: '{size} ك.ب', durationSeconds: '{seconds} ث' } });
        const format = createChatFormat(labels, 'ar');
        expect(format.fileSize(2048)).toContain('ك.ب');
        expect(format.duration(7)).toContain('ث');
    });

    it('falls back to the page\'s language without one', () => {
        // No document here: the runtime's own locale.
        expect(createChatFormat(DEFAULT_LABELS).locale).toBeUndefined();
    });
});

describe('the configuration\'s language', () => {
    it('resolves the labels over every layer, and again when a layer switches the language', () => {
        const base = resolveChatbotConfig([{ language: 'de', translations: TRANSLATIONS }]);
        expect(base.language).toBe('de');
        expect(base.labels.newChat).toBe('Neuer Chat');

        const switched = mergeChatbotConfig(base, { language: 'ar' });
        expect(switched.labels.newChat).toBe('محادثة جديدة');

        // A screen's own translations, merged per language and key.
        const screen = mergeChatbotConfig(base, { translations: { de: { composerPlaceholder: 'Frag zur Liste…' } } });
        expect(screen.labels.composerPlaceholder).toBe('Frag zur Liste…');
        expect(screen.labels.newChat).toBe('Neuer Chat');
    });

    it('keeps the labels object when a layer says nothing about them', () => {
        const base = resolveChatbotConfig([{ language: 'de', translations: TRANSLATIONS }]);
        expect(mergeChatbotConfig(base, { header: { close: false } }).labels).toBe(base.labels);
        expect(DEFAULT_CHATBOT_CONFIG.labels).toBe(DEFAULT_LABELS);
    });

    it('takes an empty language for none', () => {
        const base = resolveChatbotConfig([{ language: 'de', translations: TRANSLATIONS }, { language: '' }]);
        expect(base.language).toBe('de');
    });

    it('lays a layer\'s forms without other over the text beneath', () => {
        const config = resolveChatbotConfig([
            { labels: { credits: '{count} Kredite' } },
            { labels: { credits: { one: 'ein Kredit' } as PluralLabel } },
        ]);
        expect(config.labels.credits).toEqual({ one: 'ein Kredit', other: '{count} Kredite' });
    });

    it('merges a layer\'s labels key by key', () => {
        const config = resolveChatbotConfig([
            { labels: { credits: { one: '{count} Kredit', other: '{count} Kredite' } } },
            { labels: { newChat: 'Neu' } },
        ]);
        expect(config.labels.newChat).toBe('Neu');
        expect(config.labels.credits).toEqual({ one: '{count} Kredit', other: '{count} Kredite' });
    });

    it('lets a later layer\'s deprecated names win over an earlier layer\'s new name', () => {
        const config = resolveChatbotConfig([
            { labels: { credits: { one: '{count} credit', other: '{count} credits' } } },
            { labels: { creditsOne: 'ONE (screen layer)', creditsOther: 'MANY {count} (screen layer)' } },
        ]);
        expect(formatPlural(config.labels.credits, 1)).toBe('ONE (screen layer)');
        expect(formatPlural(config.labels.credits, 3)).toBe('MANY 3 (screen layer)');
        // And a lone one patches only its form of the layer beneath.
        const lone = resolveChatbotConfig([
            { labels: { credits: { one: '{count} Kredit', other: '{count} Kredite' } } },
            { labels: { creditsOther: '{count} Credits' } },
        ]);
        expect(formatPlural(lone.labels.credits, 1)).toBe('1 Kredit');
        expect(formatPlural(lone.labels.credits, 3)).toBe('3 Credits');
    });

    it('keeps the lower layer\'s text where an upper layer gives an empty one', () => {
        const translated = resolveChatbotConfig([
            { language: 'ar', translations: { ar: { newChat: 'جديد' } } },
            { translations: { ar: { newChat: '' } } },
        ]);
        expect(translated.labels.newChat).toBe('جديد');
        const overridden = resolveChatbotConfig([{ labels: { newChat: 'Fresh' } }, { labels: { newChat: '  ' } }]);
        expect(overridden.labels.newChat).toBe('Fresh');
        // A layer of empty values only says nothing: the labels stay the same object.
        expect(mergeChatbotConfig(overridden, { labels: { newChat: '' } }).labels).toBe(overridden.labels);
    });

    it('reads a tag written with `_` as BCP 47, for the labels, the plural rules and the formats', () => {
        const forms: PluralLabel = { one: '{count} кредит', few: '{count} кредита', many: '{count} кредитов', other: '{count} кредита' };
        for (const tag of ['ru', 'ru-RU', 'ru_RU']) {
            const config = resolveChatbotConfig([{ language: tag, translations: { ru: { credits: forms } } }]);
            expect(formatPlural(config.labels.credits, 5, {}, config.language)).toBe('5 кредитов');
            expect(createChatFormat(config.labels, config.language).number(1234567.5)).toBe(new Intl.NumberFormat('ru').format(1234567.5));
        }
        expect(resolveChatbotConfig([{ language: 'pt_br' }]).language).toBe('pt-BR');
        expect(resolveLabels('pt_BR', { 'pt-BR': { newChat: 'Nova conversa' } }).newChat).toBe('Nova conversa');
    });
});

describe('errors the chat names', () => {
    it('are described by their label, in the language in force', () => {
        const labels = resolveLabels('de', { de: { errorRequestRefused: 'Abgelehnt ({status}).', errorTryAgain: 'Bitte erneut.' } });
        const error = labelledError('errorRequestRefused', 'The request was refused (403).', { status: 403 });
        expect(describeLabelledError(error, labels)).toBe('Abgelehnt (403).');
        expect(describeStreamError(error, labels, 'de')).toBe('Abgelehnt (403).\n\nBitte erneut.');
        expect(describeStreamError(undefined, labels)).toBe(DEFAULT_LABELS.errorGeneric);
        // A server's reason is shown as it came.
        expect(describeStreamError(new Error('Quota exceeded'), labels)).toBe('Quota exceeded\n\nBitte erneut.');
    });
});
