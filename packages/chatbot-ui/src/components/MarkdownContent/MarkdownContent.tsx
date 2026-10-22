import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components, ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BlockRenderer } from '../../common/chatbotConfig';
import { isFenceClosed, normalizeLineEndings, rendererFor } from '../../common/markdownBlocks';
import { useActiveConversationId, useChatFormat, useMarkdownConfig } from '../../store/hooks';
import { MarkdownBlock } from '../MarkdownBlock/MarkdownBlock';

const { createContext, useCallback, useContext, useMemo, useRef } = React;

const REMARK_PLUGINS = [remarkGfm];

/**
 * What a `pre` needs to decide whether it is a host's block, and to draw it.
 *
 * Passed through context rather than closed over by the `components` map, and
 * this is the load-bearing decision of the whole feature. react-markdown
 * renders each element with the component the map names; a `pre` component
 * defined during render would be a new component type on every streamed token,
 * and React would unmount and remount every chart in the answer each time. The
 * map below is a module constant, so the component type never changes and the
 * values that do change reach it here.
 */
interface BlockScopeValue {
    /** The markdown being rendered — to read a fence's raw text by its offsets. */
    source: string;
    /** The text is still arriving: an unclosed fence is drawn as a skeleton. */
    streaming: boolean;
    /** The turn is still in flight — what renderers are told as `streaming`. */
    turnInFlight: boolean;
    messageId: string;
    renderers: Record<string, BlockRenderer>;
    getMessageSource: () => string;
    jobUuid: string | null;
    conversationId: string | null;
}

const BlockScope = createContext<BlockScopeValue | null>(null);

/** What `blocks={false}` draws with: no renderer, so every fence stays code. */
const NO_RENDERERS: Record<string, BlockRenderer> = Object.freeze(Object.create(null) as Record<string, BlockRenderer>);

interface HastNode {
    type?: string;
    tagName?: string;
    value?: string;
    children?: HastNode[];
    properties?: { className?: unknown };
    data?: { meta?: unknown };
    position?: { start?: { offset?: number }; end?: { offset?: number } };
}

function hastText(node: HastNode | undefined): string {
    if (!node) return '';
    if (node.type === 'text') return node.value ?? '';
    return Array.isArray(node.children) ? node.children.map(hastText).join('') : '';
}

/** `language-chart` → `chart`, as the parser marks a fence's `code` element. */
function fenceLanguage(code: HastNode): string | undefined {
    const className = code.properties?.className;
    const classes = Array.isArray(className)
        ? className
        : typeof className === 'string' ? className.split(/\s+/) : [];
    const marker = classes.find((name): name is string => typeof name === 'string' && name.startsWith('language-'));
    return marker ? marker.slice('language-'.length) : undefined;
}

/**
 * Every `pre` in the answer: a host's block when its fence's language has a
 * renderer, the ordinary code block otherwise.
 *
 * "Complete" is decided from the source text, not the parse: while text is
 * still arriving the parser treats an unclosed fence as running to the end, so
 * the fence's own closing line is the only evidence that its body is whole.
 * Once the text stops arriving a fence that never closed counts as closed —
 * the model ended its answer inside it, and the host should get the chance to
 * draw or to explain what it got.
 *
 * The renderer is looked up with `rendererFor` — the map's own, drawable
 * entries only — because the language is text from the answer: a plain
 * `renderers[language]` let ` ```constructor ` crash the transcript.
 */
const Pre = ({
    node: element,
    children,
    ...rest
}: React.ClassAttributes<HTMLPreElement> & React.HTMLAttributes<HTMLPreElement> & ExtraProps) => {
    const scope = useContext(BlockScope);
    const node = element as HastNode | undefined;
    const code = node?.children?.[0];
    const language = code?.type === 'element' && code.tagName === 'code' ? fenceLanguage(code) : undefined;
    const renderer = scope ? rendererFor(scope.renderers, language) : undefined;
    if (!scope || !code || !language || !renderer) return <pre {...rest}>{children}</pre>;

    // `\r\n` as `\n`, as `extractBlocks` reads it: the parser keeps the
    // carriage returns, and the block's `blockKey` must not depend on them.
    const body = normalizeLineEndings(hastText(code)).replace(/\n$/, '');
    const start = node?.position?.start?.offset;
    const end = node?.position?.end?.offset;
    const raw = typeof start === 'number' ? scope.source.slice(start, typeof end === 'number' ? end : undefined) : '';
    const complete = !scope.streaming || isFenceClosed(raw);
    const meta = typeof code.data?.meta === 'string' ? code.data.meta : null;

    return (
        <MarkdownBlock
            language={language}
            source={body}
            meta={meta}
            complete={complete}
            renderer={renderer}
            streaming={scope.turnInFlight}
            messageId={scope.messageId}
            jobUuid={scope.jobUuid}
            conversationId={scope.conversationId}
            getMessageSource={scope.getMessageSource}
        />
    );
};

/**
 * A block of text in its own direction (2026-10-18). The answer's container is
 * `dir="auto"` as a whole, so an answer that opens in English stayed
 * left-to-right throughout — an Arabic paragraph, list item or cell in it
 * read with its punctuation on the wrong side. Each block now resolves its
 * own direction from its first strong letter, as a paragraph of a mixed
 * document does in a word processor. Code is not prose and keeps `ltr`
 * (MessageBubble.css).
 */
function ownDirection<Tag extends 'p' | 'li' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'td' | 'th' | 'blockquote'>(tag: Tag) {
    const Block = ({ node: _node, ...rest }: React.ComponentPropsWithoutRef<Tag> & ExtraProps) =>
        React.createElement(tag, { dir: 'auto', ...rest });
    Block.displayName = `Markdown_${tag}`;
    return Block;
}

/** Never recreated — see {@link BlockScopeValue}. */
const COMPONENTS: Components = {
    pre: Pre,
    p: ownDirection('p'),
    li: ownDirection('li'),
    h1: ownDirection('h1'),
    h2: ownDirection('h2'),
    h3: ownDirection('h3'),
    h4: ownDirection('h4'),
    h5: ownDirection('h5'),
    h6: ownDirection('h6'),
    td: ownDirection('td'),
    th: ownDirection('th'),
    blockquote: ownDirection('blockquote'),
};

export interface MarkdownContentProps {
    /** The markdown. */
    content: string;
    /**
     * This text is still arriving. An unclosed fence is drawn as a skeleton
     * until its closing line arrives; with `false` it is drawn as it is.
     */
    streaming?: boolean;
    /**
     * The turn is still in flight, which renderers are told as `streaming` (a
     * reference to one of its steps may not have a result yet). Defaults to
     * `streaming`; a text that finished while its turn goes on passes `false`
     * and `true`.
     */
    turnInFlight?: boolean;
    messageId?: string;
    /** The job that produced the message, for a block to be saved against. */
    jobUuid?: string | null;
    /** Defaults to the provider's open conversation. */
    conversationId?: string | null;
    /** All text of the message, when this is one part of it. Defaults to `content`. */
    getMessageSource?: () => string;
    /**
     * Draw the host's blocks. `false` keeps every fence as code — what a
     * user's own message shows: blocks are how the assistant presents an
     * answer, and a fence the user pasted is text they wrote. Default `true`.
     */
    blocks?: boolean;
}

/**
 * The library's one markdown renderer: GitHub-flavoured markdown, with every
 * fence whose language the host registered (`config.markdown.blockRenderers`)
 * drawn by the host's component instead of as code.
 *
 * Every answer in the transcript goes through it, and a host can use it for
 * the same rendering elsewhere — a print view of one answer, say. It draws the
 * markdown alone; wrap it in `.cb-markdown-content` (and `dir="auto"`) for the
 * transcript's typography. Outside a provider it has no renderers, so fences
 * stay code.
 */
export const MarkdownContent: React.FC<MarkdownContentProps> = ({
    content,
    streaming = false,
    turnInFlight,
    messageId = '',
    jobUuid = null,
    conversationId,
    getMessageSource,
    blocks = true,
}) => {
    const { blockRenderers: configured } = useMarkdownConfig();
    const blockRenderers = blocks ? configured : NO_RENDERERS;
    const format = useChatFormat();
    // GFM footnotes: remark-rehype writes an English heading ("Footnotes")
    // and back-link names ("Back to reference 1") unless told otherwise. The
    // heading is for screen readers only, hidden by a class of the chat's own
    // rather than the host's `sr-only`, which not every host defines.
    const remarkRehypeOptions = useMemo(() => ({
        footnoteLabel: format.labels.footnotes,
        footnoteLabelProperties: { className: ['cb-visually-hidden'] },
        footnoteBackLabel: (referenceIndex: number, rereferenceIndex: number) => format.label(format.labels.footnoteBack, {
            reference: rereferenceIndex > 1
                ? `${format.number(referenceIndex + 1)}-${format.number(rereferenceIndex)}`
                : format.number(referenceIndex + 1),
        }),
    }), [format]);
    const activeConversationId = useActiveConversationId();

    // A stable reader of the latest content, so a block (memoised on its
    // props) is not re-rendered just because the text after it grew.
    const contentRef = useRef(content);
    contentRef.current = content;
    const readOwnContent = useCallback(() => contentRef.current, []);
    const readSource = getMessageSource ?? readOwnContent;

    const resolvedConversationId = conversationId !== undefined ? conversationId : activeConversationId;
    const inFlight = turnInFlight ?? streaming;

    const scope = useMemo<BlockScopeValue>(() => ({
        source: content,
        streaming,
        turnInFlight: inFlight,
        messageId,
        renderers: blockRenderers,
        getMessageSource: readSource,
        jobUuid,
        conversationId: resolvedConversationId,
    }), [content, streaming, inFlight, messageId, blockRenderers, readSource, jobUuid, resolvedConversationId]);

    return (
        <BlockScope.Provider value={scope}>
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} remarkRehypeOptions={remarkRehypeOptions} components={COMPONENTS}>
                {content}
            </ReactMarkdown>
        </BlockScope.Provider>
    );
};
