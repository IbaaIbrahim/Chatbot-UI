import {
    DEFAULT_LABELS,
    DEPRECATED_LABEL_ALIASES,
    LABEL_KEYS,
    PLURAL_CATEGORIES,
    PLURAL_LABEL_KEYS,
    formatLabel,
    formatNumber,
    formatPlural,
    isPluralLabel,
    setPluralLocale,
    canonicalLanguage,
    withDeprecatedNames,
    type ChatLabelInputs,
    type ChatLabels,
    type ChatTranslations,
    type DeprecatedLabelKey,
    type LabelKey,
    type LabelValue,
    type PluralLabel,
} from './labels';

/**
 * The chat's language (2026-10-18): which text each label shows, and how
 * numbers, dates, sizes and lists are written.
 *
 * A host passes `config.language` (a BCP 47 tag: `'ar'`, `'de-AT'`) and
 * `config.translations` (labels per language). Each label is resolved on its
 * own, the first source that has a text for it winning:
 *
 * 1. `config.labels[key]` — an explicit override, in every language (4.1's
 *    way of translating, kept);
 * 2. `translations[language][key]`, then the language's shorter tags
 *    (`'de-AT'` → `'de'`), matched without regard to case;
 * 3. `translations.en[key]` — the host's own English, when it rewords any;
 * 4. `DEFAULT_LABELS[key]` — the library's English.
 *
 * A missing key, `''` and a text of spaces fall through; so does a plural
 * label without `other`, whose forms instead patch the value found below it
 * (how a deprecated `creditsOne` alone still works). Resolution is a pure
 * function of the three inputs, run whenever a configuration layer changes,
 * so a language switched at runtime re-resolves every label at once.
 *
 * Formatting follows `config.language`, or — without one — the page's
 * `<html lang>`, as before 4.2.
 */

/** A tag as matched: lower-case, `_` read as `-`. */
function normaliseTag(tag: string): string {
    return tag.trim().replace(/_/g, '-').toLowerCase();
}

/** `'de-AT'` → `['de-at', 'de']`: the tag and each shorter one, longest first. */
export function languageFallbacks(language: string | null | undefined): string[] {
    if (!language || !language.trim()) return [];
    const parts = normaliseTag(language).split('-').filter(Boolean);
    return parts.map((_, index) => parts.slice(0, parts.length - index).join('-'));
}

/** The base language of a tag: `'de-AT'` → `'de'`. */
export function baseLanguage(language: string): string {
    return languageFallbacks(language).pop() ?? '';
}

type Forms = Partial<PluralLabel>;
/** One source's values by their current names, its empty values dropped. */
type SourceValues = Partial<Record<LabelKey, string | Forms>>;

/**
 * One map of labels as resolution reads it: its values by their current
 * names, and the forms its deprecated one/other names give — always a patch
 * over what is found beneath, even a pair that gives `other`.
 */
interface ReadSource {
    values: SourceValues;
    patches: Partial<Record<LabelKey, Forms>>;
}

interface Source extends ReadSource {
    /** The language the source is written in, for the plural rules: `undefined` for the overrides without a language. */
    locale: string | undefined;
}

function usableText(value: unknown): value is string {
    return typeof value === 'string' && value.trim() !== '';
}

/** A plural label's usable forms, or `null` when it has none. */
function cleanForms(value: unknown): Forms | null {
    if (!isPluralLabel(value)) return null;
    const forms: Forms = {};
    PLURAL_CATEGORIES.forEach(category => {
        const text = (value as Forms)[category];
        if (usableText(text)) forms[category] = text;
    });
    return Object.keys(forms).length > 0 ? forms : null;
}

/**
 * Whether resolution can use a value a host gave: a text that is not blank,
 * or plural forms with at least one such text. `''`, spaces, `null` and empty
 * forms are not — they fall through to the next source, and a configuration
 * layer giving one keeps the value of the layer beneath it.
 */
export function isUsableLabelValue(value: unknown): boolean {
    return usableText(value) || cleanForms(value) !== null;
}

const PLURAL_KEYS: ReadonlySet<string> = new Set(PLURAL_LABEL_KEYS);

/** What one source gives for `key`: a text, forms (complete or not), or nothing. */
function cleanValue(key: LabelKey, value: unknown): string | Forms | undefined {
    if (usableText(value)) return value;
    const forms = cleanForms(value);
    if (!forms) return undefined;
    if (PLURAL_KEYS.has(key)) return forms;
    // Forms for a label that does not count: its `other` is the text.
    return forms.other;
}

const ALIAS_ENTRIES = Object.entries(DEPRECATED_LABEL_ALIASES) as Array<[DeprecatedLabelKey, { key: LabelKey; form?: keyof PluralLabel }]>;

/** A host's partial map as resolution reads it. Cached per object: a layer is resolved again on every change. */
const sourceCache = new WeakMap<object, ReadSource>();

const EMPTY_SOURCE: ReadSource = Object.freeze({ values: {}, patches: {} }) as ReadSource;

function readSource(input: Partial<ChatLabelInputs> | null | undefined): ReadSource {
    if (!input || typeof input !== 'object') return EMPTY_SOURCE;
    const cached = sourceCache.get(input);
    if (cached) return cached;
    const values: SourceValues = {};
    const patches: Partial<Record<LabelKey, Forms>> = {};
    const record = input as Record<string, unknown>;
    LABEL_KEYS.forEach(key => {
        const value = cleanValue(key, record[key]);
        if (value !== undefined) values[key] = value;
    });
    // The deprecated names: a pair's form patches, a whole value stands in for
    // its key — each only where the map does not give the key by its new name.
    ALIAS_ENTRIES.forEach(([alias, { key, form }]) => {
        const text = record[alias];
        if (!usableText(text)) return;
        if (!form) {
            if (values[key] === undefined) values[key] = text;
            return;
        }
        patches[key] = { ...(patches[key] ?? {}), [form]: text };
    });
    const read: ReadSource = { values, patches };
    sourceCache.set(input, read);
    return read;
}

type TranslationEntry = { tag: string; labels: Partial<ChatLabelInputs> };
const tagCache = new WeakMap<object, Map<string, TranslationEntry>>();

/** The translations' entries by normalised tag, the first of two spellings of one tag winning. */
function translationsByTag(translations: ChatTranslations | null | undefined): Map<string, TranslationEntry> {
    if (!translations || typeof translations !== 'object') return new Map();
    const cached = tagCache.get(translations);
    if (cached) return cached;
    const byTag = new Map<string, TranslationEntry>();
    Object.entries(translations).forEach(([tag, labels]) => {
        const normalised = normaliseTag(tag);
        if (normalised && labels && typeof labels === 'object' && !byTag.has(normalised)) {
            byTag.set(normalised, { tag: canonicalLanguage(tag) ?? tag, labels });
        }
    });
    tagCache.set(translations, byTag);
    return byTag;
}

/** One map, or several in layer order (the last wins), as a list highest precedence first. */
function layersOf<Layer>(given: Layer | readonly Layer[] | null | undefined): Layer[] {
    if (!given) return [];
    return Array.isArray(given) ? [...(given as readonly Layer[])].reverse() : [given as Layer];
}

/** The sources a label is looked up in, highest precedence first (the library's English is last, implicitly). */
function sourcesFor(
    language: string | null | undefined,
    translations: ChatTranslations | readonly ChatTranslations[] | null | undefined,
    overrides: Partial<ChatLabelInputs> | readonly Partial<ChatLabelInputs>[] | null | undefined,
): Source[] {
    const locale = canonicalLanguage(language);
    const sources: Source[] = layersOf(overrides).map(layer => ({ ...readSource(layer), locale }));
    const byTag = layersOf(translations).map(translationsByTag);
    const tags = languageFallbacks(language);
    if (!tags.includes('en')) tags.push('en');
    tags.forEach(tag => {
        byTag.forEach(layer => {
            const entry = layer.get(tag);
            if (entry) sources.push({ ...readSource(entry.labels), locale: entry.tag });
        });
    });
    return sources;
}

function isComplete(value: string | Forms): value is string | PluralLabel {
    return typeof value === 'string' || usableText(value.other);
}

const ENGLISH_SOURCE = (key: LabelKey): Source => ({
    values: { [key]: DEFAULT_LABELS[key] } as SourceValues,
    patches: {},
    locale: 'en',
});

/**
 * One label through the sources: the first complete value, with the forms of
 * every incomplete one above it — and every deprecated pair's — laid over it,
 * the higher source's form winning.
 */
function resolveKey(key: LabelKey, sources: Source[]): LabelValue {
    let patch: Forms | null = null;
    let patchLocale: string | undefined;
    for (const { values, patches, locale } of [...sources, ENGLISH_SOURCE(key)]) {
        const value = values[key];
        if (value !== undefined && isComplete(value)) {
            if (!PLURAL_KEYS.has(key)) return value as string;
            const forms: PluralLabel = typeof value === 'string' ? { other: value } : { ...value };
            if (!patch) return setPluralLocale(forms, locale);
            return setPluralLocale({ ...forms, ...patch } as PluralLabel, patchLocale ?? locale);
        }
        // Incomplete here: this source's forms — its new name's over its
        // deprecated pair's — patch what is found beneath.
        const own: Forms = { ...(patches[key] ?? {}), ...((value as Forms | undefined) ?? {}) };
        if (Object.keys(own).length === 0) continue;
        patch = { ...own, ...(patch ?? {}) };
        patchLocale = patchLocale ?? locale;
    }
    return DEFAULT_LABELS[key] as LabelValue;
}

/**
 * Every label for `language`: `overrides` (the provider's `config.labels`),
 * then `translations` for the language and its shorter tags, then
 * `translations.en`, then the library's English. A language switched at
 * runtime is a call with another `language`. See this module's comment for
 * the rules; each plural label carries the language its forms are written in,
 * so `formatPlural` applies that language's rules even to the English a
 * missing translation fell back to.
 *
 * `translations` and `overrides` may each be a list of maps in layer order —
 * the configuration's layers, the last winning, an empty value in one
 * leaving the one beneath it in force. The result is readable by the
 * deprecated 4.1 names as well ({@link ChatLabels}).
 */
export function resolveLabels(
    language?: string | null,
    translations?: ChatTranslations | readonly ChatTranslations[] | null,
    overrides?: Partial<ChatLabelInputs> | readonly Partial<ChatLabelInputs>[] | null,
): ChatLabels {
    const sources = sourcesFor(language, translations, overrides);
    const labels = {} as Record<LabelKey, LabelValue>;
    LABEL_KEYS.forEach(key => {
        labels[key] = resolveKey(key, sources);
    });
    return withDeprecatedNames(labels) as unknown as ChatLabels;
}

/** Whether `language`'s own entries (its tag and shorter ones) say `key`. */
function languageHas(key: LabelKey, sources: Source[]): boolean {
    let forms: Forms = {};
    for (const { values, patches } of sources) {
        const value = values[key];
        if (value !== undefined && isComplete(value)) return true;
        forms = { ...(patches[key] ?? {}), ...((value as Forms | undefined) ?? {}), ...forms };
    }
    return usableText(forms.other);
}

/**
 * The labels a language's translations do not give — what a host's test can
 * hold at zero, or print as a translator's to-do list.
 *
 * With `language`, the keys neither its tag nor a shorter one has (`'de-AT'`
 * counts what `'de'` has). Without it, the same for every language in
 * `translations`, by the tag as written. A deprecated name counts for its new
 * key; a plural label counts once it has `other`.
 */
export function missingTranslations(translations: ChatTranslations | null | undefined, language: string): LabelKey[];
export function missingTranslations(translations: ChatTranslations | null | undefined): Record<string, LabelKey[]>;
export function missingTranslations(
    translations: ChatTranslations | null | undefined,
    language?: string,
): LabelKey[] | Record<string, LabelKey[]> {
    const byTag = translationsByTag(translations);
    const missingFor = (tag: string) => {
        const sources: Source[] = languageFallbacks(tag)
            .map(candidate => byTag.get(candidate))
            .filter((entry): entry is TranslationEntry => Boolean(entry))
            .map(entry => ({ ...readSource(entry.labels), locale: entry.tag }));
        return LABEL_KEYS.filter(key => !languageHas(key, sources));
    };
    if (language !== undefined) return missingFor(language);
    const result: Record<string, LabelKey[]> = {};
    Object.keys(translations ?? {}).forEach(tag => {
        result[tag] = missingFor(tag);
    });
    return result;
}

// --- Formatting ---------------------------------------------------------------

/** The page's language when it states one (`<html lang>`), canonical. */
export function pageLocale(): string | undefined {
    return typeof document !== 'undefined' && document.documentElement && document.documentElement.lang
        ? canonicalLanguage(document.documentElement.lang)
        : undefined;
}

/**
 * The language the chat writes numbers and dates in: its own, else the
 * page's — canonical either way (`'ru_RU'` is written as `'ru-RU'`).
 */
export function formattingLocale(language: string | null | undefined): string | undefined {
    return canonicalLanguage(language) ?? pageLocale();
}

export { canonicalLanguage };

/**
 * A share as a percentage: whole percents from 10%, one decimal under it,
 * and 100% from 99.5% up.
 */
export function formatPercent(ratio: number, language?: string): string {
    const percent = ratio * 100;
    if (percent >= 99.5) return formatNumber(1, language, { style: 'percent', maximumFractionDigits: 0 });
    return percent < 10
        ? formatNumber(ratio, language, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })
        : formatNumber(ratio, language, { style: 'percent', maximumFractionDigits: 0 });
}

const listFormats = new Map<string, { format: (items: string[]) => string } | null>();

/**
 * Names joined as the language joins them in a short list: "a, b" in English,
 * "a und b" in German, "a وb" in Arabic. `', '` where `Intl.ListFormat` is
 * missing.
 */
export function formatList(items: string[], language?: string): string {
    const key = language ?? '';
    let format = listFormats.get(key);
    if (format === undefined) {
        try {
            const ListFormat = (Intl as unknown as { ListFormat?: new (locale?: string, options?: object) => { format: (items: string[]) => string } }).ListFormat;
            format = ListFormat ? new ListFormat(canonicalLanguage(language), { type: 'conjunction', style: 'narrow' }) : null;
        } catch {
            format = null;
        }
        listFormats.set(key, format);
    }
    return format ? format.format(items) : items.join(', ');
}

type SizeLabels = Pick<ChatLabels, 'fileSizeBytes' | 'fileSizeKilobytes' | 'fileSizeMegabytes'>;

/** A file's size: "512 B", "2.0 KB", "1.5 MB" — the units are labels, the number the language's. */
export function formatFileSize(bytes: number, labels: SizeLabels = DEFAULT_LABELS, language?: string): string {
    const oneDecimal = { minimumFractionDigits: 1, maximumFractionDigits: 1 };
    if (bytes < 1024) return formatLabel(labels.fileSizeBytes, { size: formatNumber(bytes, language) });
    if (bytes < 1024 * 1024) {
        return formatLabel(labels.fileSizeKilobytes, { size: formatNumber(bytes / 1024, language, oneDecimal) });
    }
    return formatLabel(labels.fileSizeMegabytes, { size: formatNumber(bytes / (1024 * 1024), language, oneDecimal) });
}

type DurationLabels = Pick<ChatLabels, 'durationSeconds' | 'durationMinutes'>;

/** How long something took: "45 s", "5 min 3 s". */
export function formatDuration(totalSeconds: number, labels: DurationLabels = DEFAULT_LABELS, language?: string): string {
    const whole = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
    const minutes = Math.floor(whole / 60);
    const seconds = whole % 60;
    return minutes > 0
        ? formatLabel(labels.durationMinutes, { minutes: formatNumber(minutes, language), seconds: formatNumber(seconds, language) })
        : formatLabel(labels.durationSeconds, { seconds: formatNumber(seconds, language) });
}

type TokenLabels = Pick<ChatLabels, 'tokensThousands' | 'tokensMillions'>;

/** A token count, short: "999", "1.2k", "12k", "1.5M". */
export function formatTokenCount(count: number, labels: TokenLabels = DEFAULT_LABELS, language?: string): string {
    if (count >= 1_000_000) {
        return formatLabel(labels.tokensMillions, { value: formatNumber(count / 1_000_000, language, { maximumFractionDigits: 1 }) });
    }
    if (count >= 10_000) {
        return formatLabel(labels.tokensThousands, { value: formatNumber(Math.round(count / 1000), language) });
    }
    if (count >= 1_000) {
        return formatLabel(labels.tokensThousands, {
            value: formatNumber(count / 1000, language, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        });
    }
    return formatNumber(count, language);
}

/** A date and time: "Oct 14, 2026, 09:30". `''` for no date. */
export function formatDateTime(iso: string, language?: string): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    try {
        return new Date(time).toLocaleString(canonicalLanguage(language), options);
    } catch {
        return new Date(time).toLocaleString(undefined, options);
    }
}

/** A date: "Oct 14, 2026". `''` for no date. */
export function formatDate(iso: string, language?: string): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric' };
    try {
        return new Date(time).toLocaleDateString(canonicalLanguage(language), options);
    } catch {
        return new Date(time).toLocaleDateString(undefined, options);
    }
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * When, relative within the week ("now", "5 minutes ago", "yesterday") in the
 * language, a short date after ("Oct 13"; with the year when it is not this
 * one). `''` for no date. A date ahead of the clock reads as now. Whole units
 * elapsed, rounded down: 59.6 minutes is "59 minutes ago", never "60 minutes
 * ago" where "1 hour ago" comes next.
 */
export function formatRelativeDate(iso: string, now: number = Date.now(), language?: string): string {
    const time = Date.parse(iso);
    if (Number.isNaN(time)) return '';
    const elapsed = Math.max(0, now - time);
    if (elapsed < 7 * DAY_MS && typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
        try {
            const relative = new Intl.RelativeTimeFormat(canonicalLanguage(language), { numeric: 'auto' });
            if (elapsed < MINUTE_MS) return relative.format(0, 'second');
            if (elapsed < HOUR_MS) return relative.format(-Math.floor(elapsed / MINUTE_MS), 'minute');
            if (elapsed < DAY_MS) return relative.format(-Math.floor(elapsed / HOUR_MS), 'hour');
            return relative.format(-Math.floor(elapsed / DAY_MS), 'day');
        } catch {
            // A language the engine cannot format in: the short date below.
        }
    }
    const date = new Date(time);
    try {
        return date.toLocaleDateString(canonicalLanguage(language), {
            month: 'short',
            day: 'numeric',
            year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric',
        });
    } catch {
        return date.toLocaleDateString();
    }
}

/**
 * Writing in the chat's language: its labels and its locale together, for a
 * component — or a host's block renderer — that shows numbers, dates, sizes
 * or counts. From `useChatFormat()`.
 */
export interface ChatFormat {
    /** The labels in force. */
    labels: ChatLabels;
    /** The locale numbers and dates are written in: `config.language`, else the page's `<html lang>`. */
    locale: string | undefined;
    /** A label's `{placeholders}` filled. */
    label: (template: string, values?: Record<string, string | number>) => string;
    /** A counting label for `count` (see `formatPlural`). */
    plural: (label: LabelValue, count: number, values?: Record<string, string | number>) => string;
    number: (value: number, options?: Intl.NumberFormatOptions) => string;
    percent: (ratio: number) => string;
    list: (items: string[]) => string;
    fileSize: (bytes: number) => string;
    duration: (seconds: number) => string;
    tokens: (count: number) => string;
    date: (iso: string) => string;
    dateTime: (iso: string) => string;
    relativeDate: (iso: string, now?: number) => string;
}

/** {@link ChatFormat} for these labels and this language (`undefined`: the page's). */
export function createChatFormat(labels: ChatLabels, language?: string | null): ChatFormat {
    const locale = formattingLocale(language);
    return {
        labels,
        locale,
        label: (template, values) => formatLabel(template, values),
        plural: (label, count, values) => formatPlural(label, count, values, locale),
        number: (value, options) => formatNumber(value, locale, options),
        percent: ratio => formatPercent(ratio, locale),
        list: items => formatList(items, locale),
        fileSize: bytes => formatFileSize(bytes, labels, locale),
        duration: seconds => formatDuration(seconds, labels, locale),
        tokens: count => formatTokenCount(count, labels, locale),
        date: iso => formatDate(iso, locale),
        dateTime: iso => formatDateTime(iso, locale),
        relativeDate: (iso, now) => formatRelativeDate(iso, now, locale),
    };
}

// --- Errors the chat can name -----------------------------------------------------

/**
 * An error that says which label describes it to a person. A client throws
 * one (`labelledError`) where its message is for a developer — "Gateway
 * unreachable: TypeError: Failed to fetch" — and the transcript shows the
 * label instead, in the chat's language.
 */
export interface LabelledError extends Error {
    labelKey: LabelKey;
    labelValues?: Record<string, string | number>;
}

/** An `Error` with `message` for the console and `key` for the person. */
export function labelledError(key: LabelKey, message: string, values?: Record<string, string | number>): LabelledError {
    const error = new Error(message) as LabelledError;
    error.labelKey = key;
    if (values) error.labelValues = values;
    return error;
}

/** The label an error names, filled — or `null` when it names none. */
export function describeLabelledError(error: unknown, labels: ChatLabels, language?: string): string | null {
    const key = (error as Partial<LabelledError> | null)?.labelKey;
    if (!key || !(key in labels)) return null;
    const value = labels[key] as LabelValue;
    const values = (error as LabelledError).labelValues ?? {};
    return typeof value === 'string' ? formatLabel(value, values) : formatPlural(value, Number(values.count ?? 0), values, language);
}
