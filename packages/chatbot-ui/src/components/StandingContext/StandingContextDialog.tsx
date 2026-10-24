import React from 'react';
import './StandingContextDialog.css';
import type { StandingEntry, StandingEntryKind } from '../../api/types';
import { formatLabel } from '../../common/labels';
import {
    anticipatedRefusal,
    characterLimit,
    endDateInstant,
    entryLength,
    MAX_INSTRUCTION_CHARS,
    MAX_MEMORIES,
    ownBudget,
    refusalLabel,
    refusalLimit,
    todayUtc,
    type StandingBudget,
    type StandingRefusal,
} from '../../common/standingContext';
import { useStableId } from '../../common/useStableId';
import { useChatActions, useChatFormat, useChatRuntime, useChatState, useIcons, useLabels } from '../../store/hooks';

const { useEffect, useRef, useState } = React;

const HTTP_NOT_FOUND = 404;
/** How long "Click again to delete" waits for the second click. */
const CONFIRM_DELETE_MS = 4000;

type LoadState =
    | { status: 'loading' }
    | { status: 'loaded' }
    // `unavailable`: the Gateway has no such route, which no retry will change.
    | { status: 'failed'; unavailable: boolean };

/** Which form is open: a new entry of a kind, or one entry being changed. One at a time. */
type OpenForm = { mode: 'add'; kind: StandingEntryKind } | { mode: 'edit'; uuid: string };

/** What a form submits: the text and the last day it applies (`''` for none). */
interface FormValues {
    body: string;
    endDate: string;
}

/**
 * "Memory & instructions" (since 4.4, ADR-021): the standing context every
 * conversation of the user is told — their own instructions and memories,
 * which they add, change and delete here, and their organisation's, which
 * they can read. Read afresh each time it opens
 * (`useChatActions().openStandingContext()`, or the header menu's entry).
 *
 * The limits are counted as the user types (`common/standingContext.ts`), and
 * the Gateway's own refusal — with its precise reason — is what is shown when
 * it disagrees. Memories the assistant saved say so.
 *
 * `ChatContainer` renders it; a host with its own layout renders it once
 * anywhere under the provider, inside a positioned element it should cover.
 */
export const StandingContextDialog: React.FC = () => {
    const isOpen = useChatState(s => s.isStandingContextOpen);
    // Mounted per opening, so each one starts from "loading" with fresh entries.
    return isOpen ? <StandingContextPanel /> : null;
};

const StandingContextPanel: React.FC = () => {
    const { services } = useChatRuntime();
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();
    const [entries, setEntries] = useState<StandingEntry[]>([]);
    const [state, setState] = useState<LoadState>({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const [openForm, setOpenForm] = useState<OpenForm | null>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const titleId = useStableId('cb-standing-title');

    useEffect(() => {
        let cancelled = false;
        setState({ status: 'loading' });
        services.standingContext.list().then(
            read => {
                if (cancelled) return;
                setEntries(read);
                setState({ status: 'loaded' });
            },
            (error: { status?: number }) => {
                if (!cancelled) setState({ status: 'failed', unavailable: error?.status === HTTP_NOT_FOUND });
            }
        );
        return () => {
            cancelled = true;
        };
    }, [services, attempt]);

    useEffect(() => {
        closeRef.current?.focus();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') actions.closeStandingContext();
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [actions]);

    const saved = (entry: StandingEntry) => {
        setEntries(previous => {
            const index = previous.findIndex(existing => existing.uuid === entry.uuid);
            if (index === -1) return [...previous, entry];
            const next = [...previous];
            next[index] = entry;
            return next;
        });
        setOpenForm(null);
    };
    const removed = (uuid: string) => setEntries(previous => previous.filter(entry => entry.uuid !== uuid));

    const own = entries.filter(entry => entry.editable);
    const organization = entries.filter(entry => !entry.editable);

    return (
        <div
            className="cb-standing-overlay"
            onMouseDown={event => {
                if (event.target === event.currentTarget) actions.closeStandingContext();
            }}
        >
            <div className="cb-standing-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
                <div className="cb-standing-header">
                    <span className="cb-standing-header-icon" aria-hidden>{icons.standingContext}</span>
                    <h2 id={titleId} className="cb-standing-title">{labels.standingContext}</h2>
                    <button
                        ref={closeRef}
                        type="button"
                        className="cb-standing-close"
                        onClick={actions.closeStandingContext}
                        aria-label={labels.close}
                        title={labels.close}
                    >
                        {icons.close}
                    </button>
                </div>
                <p className="cb-standing-intro">{labels.standingContextIntro}</p>

                <div className="cb-standing-body" aria-live="polite">
                    {state.status === 'loading' && (
                        <div className="cb-standing-skeleton" aria-label={labels.loading}>
                            <span className="cb-standing-skeleton-line is-wide" />
                            <span className="cb-standing-skeleton-line" />
                            <span className="cb-standing-skeleton-line" />
                        </div>
                    )}
                    {state.status === 'failed' && (
                        <div className="cb-standing-message">
                            <p>{state.unavailable ? labels.standingUnavailable : labels.standingLoadFailed}</p>
                            {!state.unavailable && (
                                <button type="button" className="cb-standing-button" onClick={() => setAttempt(n => n + 1)}>
                                    {labels.retry}
                                </button>
                            )}
                        </div>
                    )}
                    {state.status === 'loaded' && (
                        <>
                            {(['instruction', 'memory'] as const).map(kind => (
                                <OwnSection
                                    key={kind}
                                    kind={kind}
                                    entries={own}
                                    openForm={openForm}
                                    onOpenForm={setOpenForm}
                                    onSaved={saved}
                                    onRemoved={removed}
                                />
                            ))}
                            {organization.length > 0 && <OrganizationSection entries={organization} />}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

/** A section's own texts — all plain strings, so each can be shown as it is. */
type SectionLabel =
    | 'standingInstructions'
    | 'standingInstructionsHint'
    | 'standingNoInstructions'
    | 'standingAddInstruction'
    | 'standingMemories'
    | 'standingMemoriesHint'
    | 'standingNoMemories'
    | 'standingAddMemory';

const SECTION_LABELS: Record<StandingEntryKind, { title: SectionLabel; hint: SectionLabel; empty: SectionLabel; add: SectionLabel }> = {
    instruction: {
        title: 'standingInstructions',
        hint: 'standingInstructionsHint',
        empty: 'standingNoInstructions',
        add: 'standingAddInstruction',
    },
    memory: {
        title: 'standingMemories',
        hint: 'standingMemoriesHint',
        empty: 'standingNoMemories',
        add: 'standingAddMemory',
    },
};

interface OwnSectionProps {
    kind: StandingEntryKind;
    /** All the user's own entries; the section shows its kind's. */
    entries: StandingEntry[];
    openForm: OpenForm | null;
    onOpenForm: (form: OpenForm | null) => void;
    onSaved: (entry: StandingEntry) => void;
    onRemoved: (uuid: string) => void;
}

/** The user's own instructions, or their memories: listed, changeable, and one more to add. */
const OwnSection: React.FC<OwnSectionProps> = ({ kind, entries, openForm, onOpenForm, onSaved, onRemoved }) => {
    const { services } = useChatRuntime();
    const format = useChatFormat();
    const { labels } = format;
    const sectionLabels = SECTION_LABELS[kind];
    const headingId = useStableId('cb-standing-section');
    const ofKind = entries.filter(entry => entry.kind === kind);
    const budget = ownBudget(entries);
    const usage = kind === 'memory'
        ? formatLabel(labels.standingMemoriesUsed, {
            used: format.number(budget.memories),
            limit: format.number(MAX_MEMORIES),
        })
        : formatLabel(labels.standingInstructionsUsed, {
            used: format.number(budget.instructionChars),
            limit: format.number(MAX_INSTRUCTION_CHARS),
        });
    const isAdding = openForm?.mode === 'add' && openForm.kind === kind;

    return (
        <section className="cb-standing-section" aria-labelledby={headingId}>
            <div className="cb-standing-section-head">
                <h3 id={headingId} className="cb-standing-section-title">{labels[sectionLabels.title]}</h3>
                <span className="cb-standing-usage">{usage}</span>
            </div>
            <p className="cb-standing-hint">{labels[sectionLabels.hint]}</p>

            {ofKind.length === 0 && !isAdding && (
                <p className="cb-standing-empty">{labels[sectionLabels.empty]}</p>
            )}
            {ofKind.length > 0 && (
                <ul className="cb-standing-list">
                    {ofKind.map(entry =>
                        openForm?.mode === 'edit' && openForm.uuid === entry.uuid ? (
                            <li key={entry.uuid} className="cb-standing-item is-editing">
                                <EntryForm
                                    kind={kind}
                                    initial={{ body: entry.body, endDate: entry.expires_on ?? '' }}
                                    budget={ownBudget(entries, entry.uuid)}
                                    isNew={false}
                                    onSubmit={values =>
                                        services.standingContext
                                            .update(entry.uuid, { body: values.body, expires_on: values.endDate || null })
                                            .then(onSaved)
                                    }
                                    onCancel={() => onOpenForm(null)}
                                />
                            </li>
                        ) : (
                            <OwnEntry
                                key={entry.uuid}
                                entry={entry}
                                onEdit={() => onOpenForm({ mode: 'edit', uuid: entry.uuid })}
                                onRemoved={onRemoved}
                            />
                        )
                    )}
                </ul>
            )}

            {isAdding ? (
                <EntryForm
                    kind={kind}
                    initial={{ body: '', endDate: '' }}
                    budget={budget}
                    isNew
                    onSubmit={values =>
                        services.standingContext
                            .create({ kind, body: values.body, expires_on: values.endDate || null })
                            .then(onSaved)
                    }
                    onCancel={() => onOpenForm(null)}
                />
            ) : (
                <button type="button" className="cb-standing-add" onClick={() => onOpenForm({ mode: 'add', kind })}>
                    {labels[sectionLabels.add]}
                </button>
            )}
        </section>
    );
};

/** When an entry stops applying, and whether the assistant saved it. */
const EntryMeta: React.FC<{ entry: StandingEntry }> = ({ entry }) => {
    const format = useChatFormat();
    const { labels } = format;
    if (!entry.expires_on && entry.source !== 'agent') return null;
    return (
        <span className="cb-standing-meta">
            {entry.expires_on && (
                entry.expired ? (
                    <span className="cb-standing-badge is-expired">{labels.standingExpired}</span>
                ) : (
                    <span className="cb-standing-badge">
                        {formatLabel(labels.standingUntil, { date: format.date(endDateInstant(entry.expires_on)) })}
                    </span>
                )
            )}
            {entry.source === 'agent' && (
                <span className="cb-standing-badge is-assistant">{labels.standingSavedByAssistant}</span>
            )}
        </span>
    );
};

interface OwnEntryProps {
    entry: StandingEntry;
    onEdit: () => void;
    onRemoved: (uuid: string) => void;
}

/** One of the user's own entries, with Edit and a two-click Delete. */
const OwnEntry: React.FC<OwnEntryProps> = ({ entry, onEdit, onRemoved }) => {
    const { services } = useChatRuntime();
    const labels = useLabels();
    const icons = useIcons();
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (!confirming) return undefined;
        const timer = window.setTimeout(() => setConfirming(false), CONFIRM_DELETE_MS);
        return () => window.clearTimeout(timer);
    }, [confirming]);

    const remove = () => {
        if (!confirming) {
            setConfirming(true);
            return;
        }
        setConfirming(false);
        setDeleting(true);
        setFailed(false);
        services.standingContext.remove(entry.uuid).then(
            () => onRemoved(entry.uuid),
            (error: { status?: number }) => {
                setDeleting(false);
                // Already gone is what was asked for.
                if (error?.status === HTTP_NOT_FOUND) onRemoved(entry.uuid);
                else setFailed(true);
            }
        );
    };

    return (
        <li className={`cb-standing-item${entry.expired ? ' is-expired' : ''}`}>
            <div className="cb-standing-item-main">
                <span className="cb-standing-text">{entry.body}</span>
                <EntryMeta entry={entry} />
                {failed && <span className="cb-standing-error" role="alert">{labels.standingErrorDelete}</span>}
            </div>
            <div className="cb-standing-item-actions">
                <button
                    type="button"
                    className="cb-standing-icon-button"
                    onClick={onEdit}
                    disabled={deleting}
                    aria-label={formatLabel(labels.actionOnItem, { action: labels.edit, item: entry.body })}
                    title={labels.edit}
                >
                    {icons.rename}
                </button>
                <button
                    type="button"
                    className={`cb-standing-icon-button is-danger${confirming ? ' is-confirming' : ''}`}
                    onClick={remove}
                    disabled={deleting}
                    aria-label={confirming
                        ? labels.standingConfirmDelete
                        : formatLabel(labels.actionOnItem, { action: labels.standingDelete, item: entry.body })}
                    title={confirming ? labels.standingConfirmDelete : labels.standingDelete}
                >
                    {confirming ? <span className="cb-standing-confirm-text">{labels.standingConfirmDelete}</span> : icons.delete}
                </button>
            </div>
        </li>
    );
};

interface EntryFormProps {
    kind: StandingEntryKind;
    initial: FormValues;
    /** What the user's other entries in force take: the limits are what is left. */
    budget: StandingBudget;
    isNew: boolean;
    onSubmit: (values: FormValues) => Promise<void>;
    onCancel: () => void;
}

/** A new entry, or a change to one: the text, and an optional last day. */
const EntryForm: React.FC<EntryFormProps> = ({ kind, initial, budget, isNew, onSubmit, onCancel }) => {
    const format = useChatFormat();
    const { labels } = format;
    const [values, setValues] = useState<FormValues>(initial);
    const [refusal, setRefusal] = useState<StandingRefusal | null>(null);
    const [saving, setSaving] = useState(false);
    const textId = useStableId('cb-standing-text');
    const dateId = useStableId('cb-standing-date');
    const hintId = useStableId('cb-standing-hint');
    const textRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        textRef.current?.focus();
    }, []);

    const length = entryLength(values.body);
    const limit = characterLimit(kind, budget);
    const today = todayUtc();

    const submit = (event: React.FormEvent) => {
        event.preventDefault();
        const anticipated = anticipatedRefusal(kind, values.body, budget, isNew)
            ?? (values.endDate && values.endDate < today ? 'standingErrorExpiry' : null);
        if (anticipated) {
            setRefusal(anticipated);
            return;
        }
        setSaving(true);
        setRefusal(null);
        onSubmit(values).catch((error: unknown) => {
            setSaving(false);
            setRefusal(refusalLabel(error, kind, 'standingErrorSave'));
        });
    };

    return (
        <form className="cb-standing-form" onSubmit={submit}>
            <label htmlFor={textId} className="cb-standing-visually-hidden">
                {labels[SECTION_LABELS[kind].add]}
            </label>
            <textarea
                id={textId}
                ref={textRef}
                className="cb-standing-textarea"
                rows={kind === 'memory' ? 2 : 3}
                value={values.body}
                placeholder={kind === 'memory' ? labels.standingMemoryPlaceholder : labels.standingInstructionPlaceholder}
                aria-describedby={hintId}
                onChange={event => setValues({ ...values, body: event.target.value })}
            />
            <div id={hintId} className="cb-standing-form-hint">
                <span>{labels.standingOneLine}</span>
                <span className={length > limit ? 'is-over' : undefined}>
                    {formatLabel(labels.standingCharacters, { count: format.number(length), limit: format.number(limit) })}
                </span>
            </div>
            <div className="cb-standing-date-row">
                <label htmlFor={dateId} className="cb-standing-date-label">{labels.standingUntilLabel}</label>
                <input
                    id={dateId}
                    type="date"
                    className="cb-standing-date"
                    min={today}
                    value={values.endDate}
                    onChange={event => setValues({ ...values, endDate: event.target.value })}
                />
                {values.endDate && (
                    <button
                        type="button"
                        className="cb-standing-link"
                        onClick={() => setValues({ ...values, endDate: '' })}
                    >
                        {labels.standingNoEndDate}
                    </button>
                )}
            </div>
            {refusal && (
                <p className="cb-standing-error" role="alert">
                    {formatLabel(labels[refusal], { limit: format.number(refusalLimit(refusal)) })}
                </p>
            )}
            <div className="cb-standing-form-actions">
                <button type="button" className="cb-standing-button" onClick={onCancel} disabled={saving}>
                    {labels.cancel}
                </button>
                <button type="submit" className="cb-standing-button is-primary" disabled={saving}>
                    {labels.standingSave}
                </button>
            </div>
        </form>
    );
};

/** The organisation's entries in force: what every conversation is told, which only its administrators change. */
const OrganizationSection: React.FC<{ entries: StandingEntry[] }> = ({ entries }) => {
    const labels = useLabels();
    const headingId = useStableId('cb-standing-organization');
    return (
        <section className="cb-standing-section" aria-labelledby={headingId}>
            <div className="cb-standing-section-head">
                <h3 id={headingId} className="cb-standing-section-title">{labels.standingOrganization}</h3>
            </div>
            <p className="cb-standing-hint">{labels.standingOrganizationHint}</p>
            <ul className="cb-standing-list">
                {entries.map(entry => (
                    <li key={entry.uuid} className="cb-standing-item is-readonly">
                        <div className="cb-standing-item-main">
                            <span className="cb-standing-text">{entry.body}</span>
                            <EntryMeta entry={entry} />
                        </div>
                    </li>
                ))}
            </ul>
        </section>
    );
};
