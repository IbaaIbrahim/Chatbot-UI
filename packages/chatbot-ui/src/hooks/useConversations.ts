import { useCallback, useEffect, useState } from 'react';
import { GatewayStreamClient } from '../api/GatewayStreamClient';
import { ConversationDetail, ConversationJob, ConversationStep, ConversationSummary } from '../api/types';
import { MessageProps, MessageStep } from '../components/MessageBubble/MessageBubble';

function extractTextFromContentBlocks(responsePayload: any): string {
    if (!responsePayload || typeof responsePayload !== 'object') return '';
    const blocks = responsePayload.content_blocks;
    if (!Array.isArray(blocks)) return '';

    const textParts: string[] = [];
    for (const block of blocks) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
            textParts.push(block.text);
        }
    }
    return textParts.join('\n\n');
}

function extractFinalText(steps: ConversationStep[]): string {
    // Walk backwards to find the last llm_call or final_synthesis with text content
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i];
        if (step.step_type === 'llm_call' || step.step_type === 'final_synthesis') {
            const text = extractTextFromContentBlocks(step.response_payload);
            if (text) return text;
        }
    }
    return '';
}

/**
 * The child a ``run_sub_agent`` step delegated to, from the same job's nested
 * list. The server sends both halves of the link — ``child_job_uuid`` on the
 * step, the job in ``sub_agent_jobs`` — so the block renders at the point in
 * the transcript where it was actually started, not appended at the end.
 */
function findSubAgentJob(
    step: ConversationStep,
    subAgentJobs: ConversationJob[]
): ConversationJob | undefined {
    if (!step.child_job_uuid) return undefined;
    return subAgentJobs.find(job => job.uuid === step.child_job_uuid);
}

function mapSteps(steps: ConversationStep[], subAgentJobs: ConversationJob[] = []): MessageStep[] {
    const messageSteps: MessageStep[] = [];

    for (const step of steps) {
        if (step.step_type === 'run_sub_agent') {
            const child = findSubAgentJob(step, subAgentJobs);
            messageSteps.push({
                id: step.uuid,
                type: 'sub-agent',
                agentName: child?.agent?.name || 'Sub-agent',
                // Recursive: a sub-agent may itself have delegated. Bounded by
                // MAX_SUB_AGENT_DEPTH server-side, so this cannot run away.
                subSteps: child ? mapSteps(child.steps, child.sub_agent_jobs ?? []) : [],
                content: child ? extractFinalText(child.steps) : '',
                toolStatus:
                    step.status === 'completed'
                        ? 'completed'
                        : step.status === 'running'
                            ? 'running'
                            : 'failed',
            });
        } else if (step.step_type === 'tool_call') {
            messageSteps.push({
                id: step.uuid,
                type: 'tool-call',
                toolName: step.tool_slug || 'Tool',
                toolArgs: step.tool_input,
                toolResult: step.tool_output,
                toolStatus: step.status === 'completed' ? 'completed' : 'failed',
            });
        } else if (step.step_type === 'llm_call' || step.step_type === 'final_synthesis') {
            const text = extractTextFromContentBlocks(step.response_payload);
            if (text) {
                messageSteps.push({
                    id: step.uuid,
                    type: 'text',
                    content: text,
                });
            } else {
                // No visible text content yet — render as a finished thinking block
                messageSteps.push({
                    id: step.uuid,
                    type: 'thinking',
                    content: '',
                    isFinished: true,
                });
            }
        }
    }

    return messageSteps;
}

export function jobsToMessageProps(
    jobs: ConversationJob[],
    storageApiUrl?: string
): MessageProps[] {
    const messages: MessageProps[] = [];

    for (const job of jobs) {
        // A handoff child has no user message: the *user* did not write its
        // prompt, another agent did. Rendering it would put words in their
        // mouth. Its assistant turn still shows, labelled with the agent that
        // took over.
        const isHandoffTurn = Boolean(job.triggered_by_job_uuid) && Boolean(job.handoff);

        // User message
        const attachments = job.attachments.map(att => ({
            id: att.uuid,
            type: (att.content_type?.startsWith('image/') ? 'image' : 'file') as 'image' | 'file',
            url: storageApiUrl
                ? `${storageApiUrl.replace(/\/$/, '')}/api/v1/attachments/jobs/${job.uuid}/files/${att.uuid}`
                : '',
            name: att.filename,
            size: att.size_bytes,
            contentType: att.content_type || undefined,
        }));

        if (!isHandoffTurn) {
            messages.push({
                id: job.uuid,
                role: 'user',
                content: job.user_prompt,
                attachments,
            });
        }

        // Assistant message
        const steps = mapSteps(job.steps, job.sub_agent_jobs ?? []);
        const finalText = extractFinalText(job.steps);

        // A handoff *parent* often has nothing to say — it decided to hand over
        // and stopped. An empty bubble is worse than none.
        if (!finalText && steps.length === 0) continue;

        messages.push({
            id: `${job.uuid}-assistant`,
            role: 'assistant',
            content: finalText,
            steps,
            senderName: job.agent?.name,
        });
    }

    return messages;
}

const PAGE_SIZE = 20;

export interface UseConversationsResult {
    conversations: ConversationSummary[];
    isLoading: boolean;
    isLoadingMore: boolean;
    hasMore: boolean;
    activeConversationId: string | null;
    fetchConversations: () => Promise<void>;
    loadMore: () => Promise<void>;
    selectConversation: (id: string) => Promise<MessageProps[] | null>;
    newChat: () => void;
}

export function useConversations(
    client: GatewayStreamClient | null,
    storageApiUrl?: string
): UseConversationsResult {
    const [conversations, setConversations] = useState<ConversationSummary[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [offset, setOffset] = useState(0);
    const [total, setTotal] = useState(0);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

    const hasMore = conversations.length < total;

    const fetchConversations = useCallback(async () => {
        if (!client) return;
        setIsLoading(true);
        setOffset(0);
        try {
            const resp = await client.getConversations(0, PAGE_SIZE);
            setConversations(resp.items);
            setTotal(resp.pagination.total);
        } catch (e) {
            console.error('[useConversations] failed to fetch conversations:', e);
        } finally {
            setIsLoading(false);
        }
    }, [client]);

    const loadMore = useCallback(async () => {
        if (!client || isLoadingMore || !hasMore) return;
        setIsLoadingMore(true);
        const nextOffset = offset + PAGE_SIZE;
        try {
            const resp = await client.getConversations(nextOffset, PAGE_SIZE);
            setConversations(prev => [...prev, ...resp.items]);
            setOffset(nextOffset);
            setTotal(resp.pagination.total);
        } catch (e) {
            console.error('[useConversations] failed to load more conversations:', e);
        } finally {
            setIsLoadingMore(false);
        }
    }, [client, isLoadingMore, hasMore, offset]);

    const selectConversation = useCallback(async (id: string): Promise<MessageProps[] | null> => {
        if (!client) return null;
        setIsLoading(true);
        try {
            const detail: ConversationDetail = await client.getConversationDetail(id);
            setActiveConversationId(id);
            client.setConversationId(id);
            return jobsToMessageProps(detail.jobs, storageApiUrl);
        } catch (e) {
            console.error('[useConversations] failed to load conversation:', e);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [client, storageApiUrl]);

    const newChat = useCallback(() => {
        setActiveConversationId(null);
        client?.setConversationId(null);
    }, [client]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    return {
        conversations,
        isLoading,
        isLoadingMore,
        hasMore,
        activeConversationId,
        fetchConversations,
        loadMore,
        selectConversation,
        newChat,
    };
}
