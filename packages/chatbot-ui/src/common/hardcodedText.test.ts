import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * No English written into the library's code (2026-10-18).
 *
 * Every word the chat shows is a label (`common/labels.ts`), so a host can
 * translate all of it — `config.translations` and `config.language`. This test
 * parses every source file (`src/**\/*.ts` and `*.tsx`, tests and `labels.ts`
 * — the English itself — left out) and fails on text a translation could
 * never reach.
 *
 * **In JSX** (components):
 *
 * - **JSX text** with a letter in it: `<button>Cancel</button>`;
 * - **the attributes and props a person reads or hears** ({@link TEXT_ATTRIBUTES}:
 *   `aria-label`, `title`, `placeholder`, `alt`, `label`, `tooltip`,
 *   `heading`, `data-tooltip`…), and **an expression among an element's
 *   children**. There, a literal that is *the value shown* — the whole
 *   expression, a branch of `?:`, an operand of `||`/`??`/`&&`/`+`, a part
 *   of a template — is flagged when it has any letter (`aria-label={open ?
 *   'close' : 'open'}`, `{'OK'}`), and so is a name that a `const` of the same
 *   file gives such a literal (`const EMPTY = 'Nothing here'` … `{EMPTY}`).
 *   A literal deeper in (a call's argument, an object's value) is flagged
 *   when it is prose ({@link isProse}): `formatLabel(x, { name: 'Some Body' })`.
 *
 * **Everywhere else** — a `.ts` module, or the code of a component outside
 * its JSX — a literal that reads as a sentence ({@link isSentence}: two words
 * or more) is flagged unless it is a message for a developer: an argument of
 * `console.*`, of an `…Error` constructor, of `labelledError`, or a thrown
 * literal. That is how the activity lines, the transcript's notices and the
 * tool names were found to be English in a first pass that read only
 * components.
 *
 * {@link ALLOWED} lists what is deliberately not a label, each with why. Keep
 * it short: the answer to a new finding is a label with its English default,
 * not an entry here.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url));

/** Read aloud or shown: the attributes — and the custom components' props — whose value is text for a person. */
const TEXT_ATTRIBUTES = new Set([
    'aria-label',
    'aria-description',
    'aria-roledescription',
    'aria-valuetext',
    'aria-placeholder',
    'title',
    'placeholder',
    'alt',
    'label',
    'text',
    'heading',
    'tooltip',
    'description',
    'caption',
    'subtitle',
    'data-tooltip',
    'data-title',
]);

/**
 * Findings that are not English for a person: a file, the text as reported
 * (or a pattern for several), and why.
 *
 * An entry needs a reason a translator could accept: the text is never shown
 * to a person — it is the model's to read, or a developer's.
 */
const ALLOWED: ReadonlyArray<{ file: string; text: string | RegExp; why: string }> = [
    {
        file: 'api/GatewayStreamClient.ts',
        text: /^'(The application's answer was too large|'\{…\}' failed in this application|No handler for '\{…\}' is registered|The application could not describe its tools)/,
        why: "A client tool's or a host request's answer: the model reads it and words its own reply in the user's language.",
    },
    {
        file: 'common/hostCatalogue.ts',
        text: /^'(A "definitions" host request|A "skill" host request|Unknown host request op|A host request must be an object)/,
        why: "The answer to a malformed host request: the platform's model reads it; nothing shows it.",
    },
    {
        file: 'api/StorageClient.ts',
        text: /^'it (cannot be written as JSON|is \{…\} bytes|holds a NUL character|nests deeper)/,
        why: 'Why a spec is left out of a save, written to the console (`dropSpec`).',
    },
    {
        file: 'api/StorageClient.ts',
        text: "'Storage API {…}'",
        why: "A StorageRequestError's message for a developer; its label (`storageRequestFailed`) is what a person reads.",
    },
    {
        file: 'context/ChatbotContext.tsx',
        text: /^'ChatbotProvider (streamUrl|storageApiUrl)'$/,
        why: 'Prop names in a console warning about a local-network URL.',
    },
    {
        file: 'store/hooks.ts',
        text: /^'(chatbot-ui: this component or hook must be rendered|\(or <ChatApp>)/,
        why: 'The error a developer gets for a hook used outside the provider.',
    },
];

function isAllowed({ file, text }: { file: string; text: string }): boolean {
    return ALLOWED.some(entry => entry.file === file
        && (typeof entry.text === 'string' ? entry.text === text : entry.text.test(text)));
}

/** Never scanned: the English itself, and the package's list of exports. */
const SKIPPED = new Set(['common/labels.ts', 'index.ts']);

function sourceFiles(directory: string): string[] {
    return readdirSync(directory).flatMap(name => {
        const path = join(directory, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
    });
}

function hasLetter(text: string): boolean {
    return /\p{L}/u.test(text);
}

/**
 * A literal that reads as words: one with a letter and a space in or around
 * it (" — failed", " (Esc)"), or a capitalised word ("File", "Sub-agent").
 */
function isProse(text: string): boolean {
    if (!hasLetter(text)) return false;
    return /\s/.test(text) || /^\p{Lu}\p{Ll}/u.test(text);
}

/**
 * A literal that reads as a sentence: two words or more, a word being letters
 * only (an apostrophe inside, a mark of punctuation after). Stricter than
 * {@link isProse}, for code that is not JSX: `'cb-activity is-running'`,
 * `'Content-Type'` and `'Bearer '` are not sentences; `'Saved {n} files'` is.
 */
function isSentence(text: string): boolean {
    const words = text.split(/\s+/).filter(token => /^[("“'‘]?\p{L}[\p{L}'’]*[.,!?:;…)"”'’]*$/u.test(token));
    return words.length >= 2;
}

/** A literal compared, matched or used as a key: a value, not text. */
function isKeyPosition(child: ts.Node): boolean {
    const parent = child.parent;
    return (ts.isPropertyAssignment(parent) && parent.name === child)
        || ts.isElementAccessExpression(parent)
        || ts.isLiteralTypeNode(parent)
        || ts.isImportDeclaration(parent)
        || ts.isExportDeclaration(parent)
        || ts.isExternalModuleReference(parent)
        || (ts.isBinaryExpression(parent) && [
            ts.SyntaxKind.EqualsEqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken,
            ts.SyntaxKind.ExclamationEqualsToken,
            ts.SyntaxKind.InKeyword,
        ].includes(parent.operatorToken.kind))
        || ts.isCaseClause(parent);
}

/**
 * The literal parts of an expression — string literals and the fixed parts
 * of template literals — without descending into nested JSX (checked on its
 * own) or into a key position (`labels['close']`, `{ count: 1 }`).
 */
function literalParts(node: ts.Node): string[] {
    const parts: string[] = [];
    const visit = (child: ts.Node) => {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) return;
        if (ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) {
            if (!isKeyPosition(child)) parts.push(child.text);
            return;
        }
        if (ts.isTemplateExpression(child)) {
            parts.push(child.head.text, ...child.templateSpans.map(span => span.literal.text));
            child.templateSpans.forEach(span => visit(span.expression));
            return;
        }
        ts.forEachChild(child, visit);
    };
    visit(node);
    return parts;
}

/** A template's text, its substitutions as `{…}`: what it reads as. */
function templateText(node: ts.TemplateExpression): string {
    return node.head.text + node.templateSpans.map(span => `{…}${span.literal.text}`).join('');
}

/**
 * The literals an expression shows as they are — itself, a branch of `?:`, an
 * operand of `||`, `??`, `&&` or `+`, a template's text, an element of an
 * array — and, through `consts`, what a name of the file's `const`s holds.
 */
function shownLiterals(node: ts.Expression, consts: Map<string, ts.Expression>, seen = new Set<string>()): string[] {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
        return shownLiterals(node.expression, consts, seen);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
        return [templateText(node), ...node.templateSpans.flatMap(span => shownLiterals(span.expression, consts, seen))];
    }
    if (ts.isConditionalExpression(node)) {
        return [...shownLiterals(node.whenTrue, consts, seen), ...shownLiterals(node.whenFalse, consts, seen)];
    }
    if (ts.isBinaryExpression(node) && [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.PlusToken,
    ].includes(node.operatorToken.kind)) {
        const left = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? [] : shownLiterals(node.left, consts, seen);
        return [...left, ...shownLiterals(node.right, consts, seen)];
    }
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap(element => shownLiterals(element as ts.Expression, consts, seen));
    if (ts.isIdentifier(node) && consts.has(node.text) && !seen.has(node.text)) {
        seen.add(node.text);
        return shownLiterals(consts.get(node.text)!, consts, seen);
    }
    return [];
}

/** Every `const` of the file whose name is a plain identifier, by name, with what it is set to. */
function constsOf(source: ts.SourceFile): Map<string, ts.Expression> {
    const consts = new Map<string, ts.Expression>();
    const visit = (node: ts.Node) => {
        if (ts.isVariableDeclarationList(node) && (node.flags & ts.NodeFlags.Const)) {
            node.declarations.forEach(declaration => {
                if (ts.isIdentifier(declaration.name) && declaration.initializer) {
                    consts.set(declaration.name.text, declaration.initializer);
                }
            });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return consts;
}

/** Inside an argument of a call that writes for a developer: `console.*`, an `…Error`, `labelledError`, or thrown. */
function isDeveloperMessage(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (ts.isThrowStatement(current)) return true;
        if (ts.isNewExpression(current) && /Error$/.test(current.expression.getText())) return true;
        if (ts.isCallExpression(current)) {
            const callee = current.expression.getText();
            if (/^console\./.test(callee) || callee === 'labelledError' || /Error$/.test(callee)) return true;
        }
        if (ts.isFunctionLike(current) || ts.isSourceFile(current)) return false;
    }
    return false;
}

function isInJsx(node: ts.Node): boolean {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
        if (ts.isJsxElement(current) || ts.isJsxSelfClosingElement(current) || ts.isJsxFragment(current)) return true;
        if (ts.isSourceFile(current)) return false;
    }
    return false;
}

interface Finding {
    file: string;
    line: number;
    text: string;
}

function findHardcodedText(file: string, text: string): Finding[] {
    const jsx = file.endsWith('.tsx');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const consts = constsOf(source);
    const findings: Finding[] = [];
    const report = (node: ts.Node, text: string) => {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        findings.push({ file, line: line + 1, text: text.replace(/\s+/g, ' ').trim() });
    };
    /** An expression whose value a person reads: its shown literals by any letter, its others by prose. */
    const checkShown = (node: ts.Node, expression: ts.Expression, describe: (text: string) => string) => {
        const shown = shownLiterals(expression, consts);
        shown.filter(hasLetter).forEach(literal => report(node, describe(literal)));
        literalParts(expression)
            .filter(part => isProse(part) && !shown.some(literal => literal.includes(part)))
            .forEach(part => report(node, describe(part)));
    };

    const visit = (node: ts.Node) => {
        if (ts.isJsxText(node)) {
            // `&#x26A0;` is a character, not the letters of its reference.
            const text = node.text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, ' ');
            if (hasLetter(text)) report(node, node.text);
        } else if (ts.isJsxAttribute(node)) {
            const name = node.name.getText(source);
            if (TEXT_ATTRIBUTES.has(name) && node.initializer) {
                if (ts.isStringLiteral(node.initializer)) {
                    if (hasLetter(node.initializer.text)) report(node, `${name}="${node.initializer.text}"`);
                } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
                    checkShown(node, node.initializer.expression, literal => `${name}={…'${literal}'…}`);
                }
            }
        } else if (ts.isJsxExpression(node) && node.expression
            && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
            checkShown(node, node.expression, literal => `{…'${literal}'…}`);
        } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))
            && !isInJsx(node) && !isKeyPosition(node) && !isDeveloperMessage(node)) {
            const literal = ts.isTemplateExpression(node) ? templateText(node) : node.text;
            if (isSentence(literal)) report(node, `'${literal}'`);
            // A template's substitutions are expressions of their own.
            if (ts.isTemplateExpression(node)) node.templateSpans.forEach(span => visit(span.expression));
            return;
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return findings;
}

/** Every finding in the library's source. */
function scanSource(): Finding[] {
    return sourceFiles(SRC)
        .map(path => ({ path, file: relative(SRC, path).split('\\').join('/') }))
        .filter(({ file }) => !SKIPPED.has(file))
        .flatMap(({ path, file }) => findHardcodedText(file, readFileSync(path, 'utf8')));
}

describe('the library', () => {
    it('shows no English that is not a label', () => {
        const findings = scanSource()
            .filter(finding => !isAllowed(finding))
            .map(({ file, line, text }) => `${file}:${line}: ${text}`);

        expect(findings).toEqual([]);
    });

    it('allows nothing it does not find', () => {
        // A stale entry would let the same text back in unnoticed.
        const all = scanSource();
        ALLOWED.forEach(entry => expect(`${entry.file}: ${String(entry.text)}: ${all.some(finding => finding.file === entry.file
            && (typeof entry.text === 'string' ? entry.text === finding.text : entry.text.test(finding.text)))}`)
            .toBe(`${entry.file}: ${String(entry.text)}: true`));
    });

    it('finds what it is for, in a component', () => {
        // The scanner itself, on a component written the wrong way.
        const probe = [
            "const EMPTY_TEXT = 'Nothing here yet';",
            'export const P = ({ name, failed, done, open, labels }: any) => {',
            "    const toggle = open ? 'Close' : 'Open';",
            '    return (',
            '    <div title={`${labels.close} (Esc)`}>',
            "        <img alt={name || 'Attachment'} />",
            '        <input placeholder="Search" aria-label={labels.search} />',
            '        <button>Cancel</button>',
            "        {failed ? ' — failed' : ''}",
            "        {failed === 'Running now' ? labels.show : labels.hide}",
            "        <span className=\"cb-x\">{'·'}{formatLabel(labels.x, { count: 2, name: 'Some Body' })}</span>",
            '        <span aria-hidden="true">&#x26A0; &#8249;</span>',
            '        <p>{EMPTY_TEXT}</p>',
            "        <button aria-label={open ? 'close' : 'open'} title={toggle} />",
            "        {done ? 'done' : 'pending'}",
            "        {'OK'}",
            "        {icon('pin')}",
            '        <Tip tooltip="Copy the link" heading="Hello there" />',
            '        <span data-tooltip="Copied to clipboard" className="cb-a cb-b" />',
            '    </div>',
            '    );',
            '};',
        ].join('\n');
        const findings = findHardcodedText('probe.tsx', probe).map(({ text }) => text);

        expect(findings).toEqual([
            // The const itself, outside JSX: a sentence.
            "'Nothing here yet'",
            "title={…'{…} (Esc)'…}",
            "alt={…'Attachment'…}",
            'placeholder="Search"',
            'Cancel',
            "{…' — failed'…}",
            "{…'Some Body'…}",
            "{…'Nothing here yet'…}",
            "aria-label={…'close'…}",
            "aria-label={…'open'…}",
            "title={…'Close'…}",
            "title={…'Open'…}",
            "{…'done'…}",
            "{…'pending'…}",
            "{…'OK'…}",
            'tooltip="Copy the link"',
            'heading="Hello there"',
            'data-tooltip="Copied to clipboard"',
        ]);
    });

    it('finds what it is for, in a module', () => {
        const probe = [
            "import { x } from './some module';",
            'export const probeNotice = (n: number) => `Saved ${n} files`;',
            "export const line = 'thought once';",
            "export const header = { 'Content-Type': 'application/json', Authorization: `Bearer ${x}` };",
            "export const classes = 'cb-activity is-running';",
            "export const state: 'not yet' | 'done' = 'done';",
            "if (x === 'the same words') console.warn('[chatbot-ui] a message for a developer');",
            "export const fail = () => { throw new Error('A message for a developer'); };",
            "export const named = () => labelledError('errorStreamLost', 'Stream connection lost');",
        ].join('\n');
        const findings = findHardcodedText('probe.ts', probe).map(({ text }) => text);

        expect(findings).toEqual([
            "'Saved {…} files'",
            "'thought once'",
        ]);
    });
});
