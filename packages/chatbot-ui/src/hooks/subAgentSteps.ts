import { MessageStep, MessageStepType } from '../components/MessageBubble/MessageBubble';

/**
 * Where a live event belongs in a turn.
 *
 * One SSE connection now carries a whole conversation, not one job: when an
 * agent starts another, the child's tokens and tool calls arrive on the same
 * stream tagged with a job uuid the client has never seen. Appending them to
 * the assistant bubble would attribute a specialist's working to the agent the
 * user addressed.
 *
 * A path is the list of ``sub-agent`` step ids from the turn's root down to the
 * block an event belongs in. `[]` is the turn itself. Nesting is arbitrary
 * because a sub-agent may start one of its own, bounded server-side by
 * MAX_SUB_AGENT_DEPTH.
 *
 * Pure on purpose: this is the whole of the routing rule, it is the part that
 * is easy to get wrong, and none of it needs React to be exercised.
 */
export type StepPath = string[];

function withSubSteps(step: MessageStep, subSteps: MessageStep[]): MessageStep {
    return { ...step, subSteps };
}

/**
 * Apply `transform` to the step list at `path`, rebuilding the containers above
 * it. Returns the original array unchanged when the path names a block that is
 * not there — an event for a sub-agent whose ``sub_agent_started`` was missed
 * is dropped rather than being misfiled into the parent's transcript.
 */
function atPath(
    steps: MessageStep[],
    path: StepPath,
    transform: (steps: MessageStep[]) => MessageStep[]
): MessageStep[] {
    if (path.length === 0) return transform(steps);

    const [head, ...rest] = path;
    const index = steps.findIndex(step => step.id === head);
    if (index === -1) return steps;

    const next = [...steps];
    next[index] = withSubSteps(
        steps[index],
        atPath(steps[index].subSteps ?? [], rest, transform)
    );
    return next;
}

/** Append one step to the block at `path`. */
export function appendStepAt(
    steps: MessageStep[],
    path: StepPath,
    step: MessageStep
): MessageStep[] {
    return atPath(steps, path, current => [...current, step]);
}

/**
 * Patch the step with `stepId` inside the block at `path`.
 *
 * The id is searched at that level only. A step uuid is unique per job, and a
 * job is exactly one level, so a deeper match would mean the path was wrong —
 * better to change nothing than to update someone else's step.
 */
export function patchStepAt(
    steps: MessageStep[],
    path: StepPath,
    stepId: string,
    patch: Partial<MessageStep>
): MessageStep[] {
    return atPath(steps, path, current =>
        current.map(step => (step.id === stepId ? { ...step, ...patch } : step))
    );
}

/**
 * Append streamed text to the block at `path`, extending the step with
 * `stepId` rather than starting a new one per token.
 *
 * `type` is what the step is created as when it does not exist yet, so the
 * same accumulator serves answer text and a reasoning model's thinking — the
 * two differ only in which block they land in and how they are rendered, not
 * in how they arrive.
 */
export function appendTextAt(
    steps: MessageStep[],
    path: StepPath,
    chunk: string,
    stepId: string,
    type: MessageStepType = 'text'
): MessageStep[] {
    return atPath(steps, path, current => {
        const index = current.findIndex(step => step.id === stepId);
        if (index === -1) {
            return [...current, { id: stepId, type, content: chunk }];
        }
        const next = [...current];
        next[index] = {
            ...next[index],
            content: (next[index].content ?? '') + chunk,
        };
        return next;
    });
}
