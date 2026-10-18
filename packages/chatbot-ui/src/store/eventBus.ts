import type { ChatEventBus, ChatEventHandler, ChatEventMap, ChatEventType } from './types';

/**
 * One provider's event channel. A handler that throws is reported and skipped,
 * so one host listener cannot stop the others or the action that emitted.
 */
export function createEventBus(): ChatEventBus {
    const handlers = new Map<ChatEventType, Set<(payload: unknown) => void>>();

    return {
        emit: <Type extends ChatEventType>(type: Type, payload: ChatEventMap[Type]) => {
            handlers.get(type)?.forEach(handler => {
                try {
                    handler(payload);
                } catch (error) {
                    console.error(`[chatbot-ui] a '${type}' event handler threw`, error);
                }
            });
        },
        on: <Type extends ChatEventType>(type: Type, handler: ChatEventHandler<Type>) => {
            const forType = handlers.get(type) ?? new Set<(payload: unknown) => void>();
            const untyped = handler as (payload: unknown) => void;
            forType.add(untyped);
            handlers.set(type, forType);
            return () => {
                forType.delete(untyped);
            };
        },
    };
}
