import React from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * An entry's text as its Markdown reads (since 4.5): a host's settings may
 * write it with an editor, and the Gateway keeps it as plain text with its
 * lines — `**bold**`, `*italic*`, `~~struck~~`, `- ` and `1. ` lists,
 * `[links](https://…)`. Only those are drawn; anything else is shown as its
 * text, and a link opens in a new tab. An entry typed here reads as typed.
 */

/** What an editor writes, and nothing else: no headings, images, tables or code. */
const ALLOWED_ELEMENTS = ['p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'a', 'br'];
const REMARK_PLUGINS = [remarkGfm];
const COMPONENTS: Components = {
    a: ({ node: _node, ...link }) => <a {...link} target="_blank" rel="noopener noreferrer" />,
};

export const StandingEntryText: React.FC<{ body: string }> = ({ body }) => (
    <div className="cb-standing-text">
        <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            allowedElements={ALLOWED_ELEMENTS}
            unwrapDisallowed
            components={COMPONENTS}
        >
            {body}
        </ReactMarkdown>
    </div>
);
