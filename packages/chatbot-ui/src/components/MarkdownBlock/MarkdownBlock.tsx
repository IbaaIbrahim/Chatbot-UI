import React from 'react';
import ReactDOM from 'react-dom';
import './MarkdownBlock.css';
import type {
    BlockAction,
    BlockDescriptor,
    BlockRenderer,
    BlockRenderProps,
} from '../../common/chatbotConfig';
import { readDirection, type TextDirection } from '../../common/direction';
import { FOCUSABLE, trapTab } from '../../common/focusTrap';
import { formatLabel } from '../../common/labels';
import { blockKeyOf, extractBlockTitle } from '../../common/markdownBlocks';
import { useStableId } from '../../common/useStableId';
import { useConfiguredLanguage, useIcons, useLabels, useMarkdownConfig } from '../../store/hooks';
import { themeAttribute, useChatPresentation } from '../ChatContainer/presentation';

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

/** Height the skeleton reserves while a fence streams, when the renderer names none. */
const DEFAULT_MIN_HEIGHT = 160;

export interface MarkdownBlockProps {
    language: string;
    /** The fence's body. */
    source: string;
    meta: string | null;
    /** The fence is closed, or the text around it is no longer streaming. */
    complete: boolean;
    renderer: BlockRenderer;
    /** The turn is still in flight — `BlockRenderProps.streaming`. */
    streaming: boolean;
    messageId: string;
    jobUuid: string | null;
    conversationId: string | null;
    /** Stable: reads the message's latest text when called. */
    getMessageSource: () => string;
}

/**
 * One fenced block a host draws: a skeleton while its fence streams, then the
 * host's component inside the library's frame.
 *
 * Memoised on its props, which are all plain values or stable references —
 * that is the whole point. While an answer streams, the markdown above this is
 * re-rendered on every token; a block whose fence has closed receives the same
 * props each time and never renders again, so a chart is drawn once rather
 * than once per token. `MarkdownContent` keeps those props stable (a
 * module-level `components` map, a stable `getMessageSource`), and the
 * renderer map's entries are the host's own constants.
 *
 * The frame is keyed on the block's key, so a block whose text changes after
 * it was drawn starts again with no title, actions or failure left over from
 * the text it replaced.
 */
const MarkdownBlockView: React.FC<MarkdownBlockProps> = props => {
    const label = props.renderer.label ?? props.language;
    if (!props.complete) {
        return <BlockSkeleton language={props.language} source={props.source} renderer={props.renderer} label={label} />;
    }
    return <BlockFrame key={blockKeyOf(props.language, props.source)} {...props} label={label} />;
};

export const MarkdownBlock = React.memo(MarkdownBlockView);

// --- While the fence streams ------------------------------------------------

/**
 * Drawn until the fence closes. Nothing is parsed or drawn from a partial
 * body: a half-written spec would flicker through invalid states, and its
 * references to tool results may not resolve until the turn is further on.
 * The title, when the body has got that far, is the one thing worth showing.
 */
const BlockSkeleton: React.FC<{ language: string; source: string; renderer: BlockRenderer; label: string }> = ({
    language,
    source,
    renderer,
    label,
}) => {
    const labels = useLabels();
    const minHeight = renderer.minHeight ?? DEFAULT_MIN_HEIGHT;
    const Placeholder = renderer.placeholder;
    if (Placeholder) {
        return (
            <div className="cb-md-block-pending" data-lang={language} style={{ minHeight }}>
                <Placeholder language={language} partialSource={source} label={label} />
            </div>
        );
    }
    const title = extractBlockTitle(source);
    return (
        <div
            className="cb-md-block cb-md-block-skeleton"
            data-lang={language}
            style={{ minHeight }}
            role="status"
            aria-busy="true"
        >
            {title && <div className="cb-md-block-skeleton-title" dir="auto">{title}</div>}
            <div className="cb-md-block-skeleton-shimmer" aria-hidden="true" />
            <div className="cb-md-block-skeleton-text">{formatLabel(labels.blockPreparing, { label })}</div>
        </div>
    );
};

// --- The drawn block ----------------------------------------------------------

interface BlockFrameProps extends MarkdownBlockProps {
    label: string;
    /** Drawn inside the expanded overlay. */
    expanded?: boolean;
    /** The overlay's close. */
    onClose?: () => void;
    /**
     * Where the message is, for an action over the whole answer. The overlay's
     * frame is in a portal far from it, so it asks the inline frame.
     */
    getMessageElement?: () => HTMLElement | null;
}

/** The message a block sits in: the bubble's content column, or the markdown around it. */
function findMessageElement(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;
    return element.closest<HTMLElement>('.cb-message-content-wrapper')
        ?? element.closest<HTMLElement>('.cb-markdown-content');
}

/** The signature `setActions` compares: what the toolbar shows, not the closures behind it. */
function actionsSignature(actions: BlockAction[]): string {
    return actions
        .map(action => [action.id, action.label, action.placement ?? 'menu', action.disabled ? '1' : '0'].join('\u0001'))
        .join('\u0002');
}

const BlockFrame: React.FC<BlockFrameProps> = props => {
    const {
        language,
        source,
        meta,
        renderer,
        streaming,
        messageId,
        jobUuid,
        conversationId,
        getMessageSource,
        label,
        expanded = false,
        onClose,
        getMessageElement,
    } = props;
    const labels = useLabels();
    const icons = useIcons();
    const markdown = useMarkdownConfig();
    const presentation = useChatPresentation();
    const theme = useResolvedTheme();
    const titleId = useStableId('cb-md-block-title');

    const frameRef = useRef<HTMLElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    // A callback ref, so the same ref serves the `figure` and the bare `div`.
    const setFrame = useCallback((node: HTMLElement | null) => {
        frameRef.current = node;
    }, []);
    const expandButtonRef = useRef<HTMLButtonElement | null>(null);
    const width = useElementWidth(bodyRef);
    const direction = useDirection(frameRef);

    const [title, setTitleState] = useState<string | null>(null);
    const [failure, setFailure] = useState<string | null>(null);
    const [isOverlayOpen, setOverlayOpen] = useState(false);

    // The actions live in a ref and only their visible signature in state, so a
    // renderer that calls `setActions` from an effect on every render — with
    // fresh closures each time, as an inline array literal has — settles after
    // one render instead of looping. A click runs the latest closure by id.
    const actionsRef = useRef<BlockAction[]>([]);
    const [, setActionsSignature] = useState('');

    const blockKey = useMemo(() => blockKeyOf(language, source), [language, source]);
    const descriptor = useMemo<BlockDescriptor>(
        () => ({ language, source, meta, blockKey, messageId }),
        [language, source, meta, blockKey, messageId]
    );

    const setActions = useCallback((next: BlockAction[]) => {
        const list = Array.isArray(next) ? next.filter(action => action && action.id) : [];
        actionsRef.current = list;
        setActionsSignature(actionsSignature(list));
    }, []);
    const setTitle = useCallback((next: string | null) => {
        setTitleState(typeof next === 'string' && next.trim() ? next.trim() : null);
    }, []);
    const fail = useCallback((reason: string) => {
        setFailure(typeof reason === 'string' ? reason : String(reason ?? ''));
    }, []);

    // Stable for the renderer, current when called: "Expand" asks the host
    // first, and the descriptor it hands over is this render's.
    const openExpandedRef = useRef<() => void>(() => undefined);
    openExpandedRef.current = () => {
        if (expanded) return;
        if (markdown.onExpandBlock?.(descriptor)) return;
        setOverlayOpen(true);
    };
    const openExpanded = useCallback(() => openExpandedRef.current(), []);
    const closeOverlay = useCallback(() => setOverlayOpen(false), []);

    const messageElement = useCallback(
        () => (getMessageElement ? getMessageElement() : findMessageElement(frameRef.current)),
        [getMessageElement]
    );

    const runAction = useCallback((id: string) => {
        const action = actionsRef.current.find(candidate => candidate.id === id);
        const element = frameRef.current;
        if (!action || !element || action.disabled) return;
        try {
            const outcome = action.run({ element, messageElement: messageElement() });
            if (outcome && typeof (outcome as Promise<void>).catch === 'function') {
                (outcome as Promise<void>).catch(error => {
                    console.error(`[chatbot-ui] the '${id}' action of a ${language} block failed`, error);
                });
            }
        } catch (error) {
            console.error(`[chatbot-ui] the '${id}' action of a ${language} block failed`, error);
        }
    }, [language, messageElement]);

    const copySource = useCallback(() => {
        void copyText(source);
    }, [source]);

    // A render follows every change of signature; the closures stay in the ref.
    const actions = actionsRef.current;
    const toolbarActions = actions.filter(action => action.placement === 'toolbar');
    const menuActions = actions.filter(action => action.placement !== 'toolbar');
    const failed = failure !== null;
    const shownTitle = title ?? (failed ? extractBlockTitle(source) : null);

    const renderProps: BlockRenderProps = {
        ...descriptor,
        streaming,
        expanded,
        width,
        theme,
        direction,
        mode: presentation.mode,
        jobUuid,
        conversationId,
        getMessageSource,
        setActions,
        setTitle,
        openExpanded,
        fail,
    };

    const content = failed ? (
        <BlockFallback label={label} reason={failure} source={source} />
    ) : (
        <BlockErrorBoundary onError={fail}>
            <HostBlock component={renderer.component} renderProps={renderProps} />
        </BlockErrorBoundary>
    );

    const overlay = !expanded && isOverlayOpen ? (
        <BlockOverlay
            label={shownTitle ?? label}
            themeAttr={themeAttribute(presentation.theme)}
            onClose={closeOverlay}
            returnFocusTo={expandButtonRef}
        >
            <BlockFrame {...props} expanded onClose={closeOverlay} getMessageElement={messageElement} />
        </BlockOverlay>
    ) : null;

    if (renderer.frame === false) {
        return (
            <>
                <div
                    className="cb-md-block-bare"
                    data-lang={language}
                    ref={setFrame}
                    data-block-key={expanded ? undefined : blockKey}
                    data-job-uuid={expanded ? undefined : jobUuid ?? undefined}
                >
                    <div className="cb-md-block-bare-body" ref={bodyRef}>{content}</div>
                </div>
                {overlay}
            </>
        );
    }

    return (
        <>
            <figure
                className={`cb-md-block${expanded ? ' is-expanded' : ''}${failed ? ' has-failed' : ''}`}
                data-lang={language}
                ref={setFrame}
                // What "Show in chat" (the files panel) finds the block by:
                // its key and its turn. Not on an expanded copy, which is
                // drawn elsewhere.
                data-block-key={expanded ? undefined : blockKey}
                data-job-uuid={expanded ? undefined : jobUuid ?? undefined}
                // Named by its title, not by a figcaption: the header holds the
                // buttons too, and a caption's name would read them all out.
                aria-labelledby={shownTitle ? titleId : undefined}
                aria-label={shownTitle ? undefined : label}
            >
                <div className="cb-md-block-header">
                    <div id={titleId} className="cb-md-block-title" dir="auto" title={shownTitle ?? undefined}>
                        {shownTitle}
                    </div>
                    <div className="cb-md-block-toolbar">
                        {!failed && toolbarActions.map(action => (
                            <button
                                key={action.id}
                                type="button"
                                className={`cb-md-block-btn${action.icon ? '' : ' has-text'}`}
                                onClick={() => runAction(action.id)}
                                disabled={action.disabled}
                                aria-label={action.label}
                                title={action.label}
                            >
                                {action.icon ?? action.label}
                            </button>
                        ))}
                        {!expanded && !failed && (
                            <button
                                ref={expandButtonRef}
                                type="button"
                                className="cb-md-block-btn cb-md-block-expand"
                                onClick={openExpanded}
                                aria-label={labels.blockExpand}
                                title={labels.blockExpand}
                            >
                                {icons.expand}
                            </button>
                        )}
                        <BlockMenu
                            actions={failed ? [] : menuActions}
                            onRun={runAction}
                            onCopySource={copySource}
                        />
                        {/* The close button ends the header, after "More
                            actions" — the logical end, so on the left in a
                            right-to-left page. Until 2026-10-14 it sat between
                            the toolbar's actions and the menu. */}
                        {expanded && onClose && (
                            <button
                                type="button"
                                className="cb-md-block-btn cb-md-block-close"
                                onClick={onClose}
                                aria-label={labels.blockClose}
                                title={labels.blockClose}
                            >
                                {icons.close}
                            </button>
                        )}
                    </div>
                </div>
                <div className="cb-md-block-body" ref={bodyRef}>{content}</div>
            </figure>
            {overlay}
        </>
    );
};

// --- Menu ---------------------------------------------------------------------

const BlockMenu: React.FC<{
    actions: BlockAction[];
    onRun: (id: string) => void;
    onCopySource: () => void;
}> = ({ actions, onRun, onCopySource }) => {
    const labels = useLabels();
    const icons = useIcons();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const closeOnOutsidePointer = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', closeOnOutsidePointer);
        return () => document.removeEventListener('mousedown', closeOnOutsidePointer);
    }, [open]);

    const choose = (run: () => void) => () => {
        setOpen(false);
        run();
    };

    return (
        <div
            className="cb-md-block-menu-container"
            ref={containerRef}
            onKeyDown={event => {
                // Before the overlay's own Escape, which would close the
                // whole expanded view instead of just this menu.
                if (event.key === 'Escape' && open) {
                    event.stopPropagation();
                    setOpen(false);
                }
            }}
        >
            <button
                type="button"
                className="cb-md-block-btn cb-md-block-more"
                onClick={() => setOpen(value => !value)}
                aria-label={labels.blockMore}
                title={labels.blockMore}
                aria-haspopup="menu"
                aria-expanded={open}
            >
                {icons.more}
            </button>
            {open && (
                <div className="cb-md-block-menu" role="menu">
                    {actions.map(action => (
                        <button
                            key={action.id}
                            type="button"
                            role="menuitem"
                            className="cb-md-block-menu-item"
                            disabled={action.disabled}
                            onClick={choose(() => onRun(action.id))}
                        >
                            {action.icon && <span className="cb-md-block-menu-icon" aria-hidden="true">{action.icon}</span>}
                            <span>{action.label}</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        role="menuitem"
                        className="cb-md-block-menu-item"
                        onClick={choose(onCopySource)}
                    >
                        <span className="cb-md-block-menu-icon" aria-hidden="true">{icons.copy}</span>
                        <span>{labels.blockCopySource}</span>
                    </button>
                </div>
            )}
        </div>
    );
};

// --- Failure --------------------------------------------------------------------

/**
 * The host's component, one level below the error boundary.
 *
 * Not inlined as the boundary's own child, and that is the point: React
 * creates a child's fiber while it reconciles the parent, so a component type
 * it cannot render ("Element type is invalid") throws *in the boundary's own
 * work*, and React looks for a boundary from the boundary's parent upwards —
 * past this one, to none, unmounting the transcript. Rendered by this wrapper,
 * the same throw happens in the wrapper's work, below the boundary, which
 * catches it and shows the fallback. `mergeMarkdown` already drops a renderer
 * with no component; this covers whatever a check of the shape cannot see.
 */
const HostBlock: React.FC<{ component: React.ComponentType<BlockRenderProps>; renderProps: BlockRenderProps }> = ({
    component: Component,
    renderProps,
}) => <Component {...renderProps} />;

/**
 * Catches a renderer that throws, so one bad block costs one block and not the
 * whole answer — an uncaught error in render would unmount the transcript. A
 * class because only a class can be an error boundary, in React 17 as in 18.
 */
class BlockErrorBoundary extends React.Component<
    { onError: (reason: string) => void; children: React.ReactNode },
    { failed: boolean }
> {
    state = { failed: false };

    static getDerivedStateFromError(): { failed: boolean } {
        return { failed: true };
    }

    componentDidCatch(error: unknown): void {
        this.props.onError(error instanceof Error ? error.message : String(error));
    }

    render(): React.ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

/** What a block that could not be drawn shows: why, and the source it was given. */
const BlockFallback: React.FC<{ label: string; reason: string | null; source: string }> = ({ label, reason, source }) => {
    const labels = useLabels();
    const headline = reason
        ? formatLabel(labels.blockFailedReason, { label, reason })
        : formatLabel(labels.blockFailed, { label });
    return (
        <div className="cb-md-block-fallback" role="alert">
            <p className="cb-md-block-fallback-text" dir="auto">{headline}</p>
            <details className="cb-md-block-source">
                <summary>{labels.blockShowSource}</summary>
                <pre dir="ltr"><code>{source}</code></pre>
            </details>
        </div>
    );
};

// --- Expanded overlay -------------------------------------------------------------

/**
 * The expanded view: the same block, drawn again at the size of the screen.
 *
 * A portal on `document.body`, so it is not clipped by the chat's narrow
 * panel — which takes it outside `.cb-chat-container`, where the design tokens
 * are defined. The overlay therefore carries `.cb-root` and the chat's
 * `data-theme` itself, and a host's component reads the same tokens in both
 * places. A modal dialog: Escape and the backdrop close it, Tab stays inside
 * it, and focus returns to the Expand button afterwards.
 */
const BlockOverlay: React.FC<{
    label: string;
    themeAttr: 'light' | 'dark' | undefined;
    onClose: () => void;
    /** Where focus goes back to; without one, wherever it was when the overlay opened. */
    returnFocusTo?: React.RefObject<HTMLElement>;
    children: React.ReactNode;
}> = ({ label, themeAttr, onClose, returnFocusTo, children }) => {
    const dialogRef = useRef<HTMLDivElement>(null);
    // A portal outside the chat: it says the chat's language itself.
    const language = useConfiguredLanguage();

    useEffect(() => {
        const opener = typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null;
        const dialog = dialogRef.current;
        const first = dialog?.querySelector<HTMLElement>('.cb-md-block-close') ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
        first?.focus();
        const returnTarget = returnFocusTo ? returnFocusTo.current : opener;
        return () => {
            if (returnTarget && returnTarget.isConnected && typeof returnTarget.focus === 'function') returnTarget.focus();
        };
    }, [returnFocusTo]);

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
            return;
        }
        // Only a key pressed in the dialog itself: one from a portal a host's
        // component opened (a menu, a tooltip) bubbles here too, and keeps its
        // own Tab order.
        const dialog = dialogRef.current;
        if (dialog && event.target instanceof Node && dialog.contains(event.target)) trapTab(event, dialog);
    };

    if (typeof document === 'undefined') return null;
    return ReactDOM.createPortal(
        <div
            className="cb-root cb-md-block-overlay"
            data-theme={themeAttr}
            lang={language}
            onMouseDown={event => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                className="cb-md-block-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={label}
                ref={dialogRef}
                onKeyDown={onKeyDown}
            >
                {children}
            </div>
        </div>,
        document.body
    );
};

// --- A block drawn outside its message ----------------------------------------------

/** What {@link ExpandedBlock} draws: a block, its renderer, and the turn it came from. */
export interface ExpandedBlockProps {
    language: string;
    /** The fence's body, as the renderer draws it in the answer. */
    source: string;
    meta?: string | null;
    /** The host's renderer for `language` (`rendererFor(useMarkdownConfig().blockRenderers, language)`). */
    renderer: BlockRenderer;
    /** The turn's job — what the block's Save saves against. */
    jobUuid: string | null;
    /** The conversation the block was drawn in, whichever is open. */
    conversationId: string | null;
    /** The message it is in, when it is in the transcript; `''` otherwise. */
    messageId?: string;
    /**
     * The whole answer's text, when known; the block's own body otherwise.
     * Read when called: for a block of the turn under way, pass a reader of
     * the message's current text, not a copy.
     */
    getMessageSource?: () => string;
    /**
     * The block's turn is still under way — `BlockRenderProps.streaming`, as
     * the transcript tells the same block. Default `false`. The files panel
     * lists a closed fence of the live turn at once; drawn as finished, a
     * report offered its exports (and Save) over half an answer (review of
     * 2026-10-14).
     */
    streaming?: boolean;
    /** A close button ends the header; none without. */
    onClose?: () => void;
}

const noMessageElement = (): HTMLElement | null => null;

/**
 * One block drawn by its host renderer **outside its message**, as the
 * expanded overlay draws it: `expanded: true`, `streaming: false` (unless
 * its turn is still under way), with the
 * turn's `jobUuid`, its `conversationId` and the `blockKey` of `source` — so
 * the renderer's own Save saves it against its turn, and the block counts as
 * saved. What the files panel opens a block in (inside {@link BlockDialog})
 * and what the Artifacts view draws a not-saved block with, in the column.
 * It fills its container (a flex column).
 */
export const ExpandedBlock: React.FC<ExpandedBlockProps> = ({
    language,
    source,
    meta = null,
    renderer,
    jobUuid,
    conversationId,
    messageId = '',
    getMessageSource,
    streaming = false,
    onClose,
}) => {
    const sourceRef = useRef(source);
    sourceRef.current = source;
    const readerRef = useRef(getMessageSource);
    readerRef.current = getMessageSource;
    // Stable, as the transcript's is: the block is memoised on its props.
    const readMessage = useCallback(() => (readerRef.current ? readerRef.current() : sourceRef.current), []);
    return (
        <BlockFrame
            key={blockKeyOf(language, source)}
            language={language}
            source={source}
            meta={meta}
            complete
            renderer={renderer}
            streaming={streaming}
            messageId={messageId}
            jobUuid={jobUuid}
            conversationId={conversationId}
            getMessageSource={readMessage}
            label={renderer.label ?? language}
            expanded
            onClose={onClose}
            getMessageElement={noMessageElement}
        />
    );
};

/**
 * The expanded overlay — a modal dialog over the page, portalled to
 * `document.body` with `.cb-root` and the chat's theme — around `children`,
 * usually an {@link ExpandedBlock} with `onClose`. Escape and the scrim close
 * it, Tab stays inside it, and focus goes back to `returnFocusTo` (or to
 * where it was) afterwards.
 */
export const BlockDialog: React.FC<{
    /** The dialog's accessible name: the block's title, or its label. */
    label: string;
    onClose: () => void;
    returnFocusTo?: React.RefObject<HTMLElement>;
    children: React.ReactNode;
}> = ({ label, onClose, returnFocusTo, children }) => {
    const presentation = useChatPresentation();
    return (
        <BlockOverlay
            label={label}
            themeAttr={themeAttribute(presentation.theme)}
            onClose={onClose}
            returnFocusTo={returnFocusTo}
        >
            {children}
        </BlockOverlay>
    );
};

// --- Measurements -------------------------------------------------------------------

/**
 * The width a renderer can draw in: the element's content box — inside its
 * padding, without a scrollbar — in px. What a ResizeObserver's `contentRect`
 * reports, so the first measurement and every later one are of the same box.
 */
function contentBoxWidth(element: HTMLElement): number {
    let padding = 0;
    if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const style = window.getComputedStyle(element);
        padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    }
    return Math.max(0, element.clientWidth - padding);
}

/**
 * The element's content-box width in whole px, kept current with a
 * ResizeObserver where there is one.
 *
 * Until 2026-10-14 the first value was the border box (`getBoundingClientRect`,
 * padding included) and every later one the observer's content box: a chart
 * sized to the first `width` was 24px too wide (32px expanded), overflowed the
 * body and was drawn a second time when the observer fired.
 */
function useElementWidth(ref: React.RefObject<HTMLElement>): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        setWidth(Math.round(contentBoxWidth(element)));
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(entries => {
            const measured = entries[0]?.contentRect?.width ?? contentBoxWidth(element);
            setWidth(Math.round(measured));
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref]);
    return width;
}

/**
 * The direction the browser resolved for the text around the block. Its
 * container is `dir="auto"`, so an Arabic answer is right-to-left and an
 * English one beside it is not; only the browser knows which this is.
 */
function useDirection(ref: React.RefObject<HTMLElement>): TextDirection {
    const [direction, setDirection] = useState<TextDirection>('ltr');
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        setDirection(readDirection(element));
    }, [ref]);
    return direction;
}

const LIGHT_QUERY = '(prefers-color-scheme: light)';

function prefersLight(): boolean {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        && window.matchMedia(LIGHT_QUERY).matches;
}

/**
 * The chat's theme as drawn: an explicit `light` or `dark`, or — for
 * `system` — what the OS asks for. Dark is the default the tokens fall back
 * to, so `system` without a light preference is dark.
 */
function useResolvedTheme(): 'light' | 'dark' {
    const { theme } = useChatPresentation();
    const [light, setLight] = useState(prefersLight);
    useEffect(() => {
        if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return undefined;
        }
        const query = window.matchMedia(LIGHT_QUERY);
        const onChange = () => setLight(query.matches);
        onChange();
        if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange);
            return () => query.removeEventListener('change', onChange);
        }
        query.addListener(onChange);
        return () => query.removeListener(onChange);
    }, [theme]);
    if (theme === 'system') return light ? 'light' : 'dark';
    return theme;
}

/** The clipboard where there is one; a hidden textarea where there is not. */
async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch {
        // Not permitted, or not a secure context: the old way below.
    }
    if (typeof document === 'undefined') return;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } finally {
        textarea.remove();
    }
}
