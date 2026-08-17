/**
 * Normalising a tool's output for a frontend handler.
 *
 * A ``lib.tools.BaseTool.execute`` returns a **string**, and the orchestrator
 * forwards it to the ``tool_result`` SSE event verbatim, so a tool that emits
 * ``json.dumps(result)`` reaches the browser as JSON text rather than an
 * object. Every consumer that hands a result to application code has to make
 * the same decision about that, which is why it lives here rather than being
 * re-implemented per call site.
 */

/**
 * Parse a ``tool_output`` into the value an application handler expects.
 *
 * A JSON string is parsed; anything else — an already-decoded object, a plain
 * prose result, ``null`` — is returned untouched. Unparseable text is passed
 * through rather than discarded: a tool whose result *is* free text is
 * legitimate, and swallowing it would leave the handler with nothing.
 */
export function parseToolOutput(output: any): any {
    if (typeof output !== 'string') return output;
    try {
        return JSON.parse(output);
    } catch {
        return output;
    }
}
