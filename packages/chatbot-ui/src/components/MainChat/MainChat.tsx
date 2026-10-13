import React from 'react';
import './MainChat.css';
import { MessageBubble } from '../MessageBubble/MessageBubble';
import { ThinkingIndicator } from '../ThinkingIndicator/ThinkingIndicator';
import { WelcomeScreen } from '../WelcomeScreen/WelcomeScreen';
import { QuestionnaireForm } from '../Questionnaire/QuestionnaireForm';
import { useChatActions, useChatState, useIcons, useLabels } from '../../store/hooks';

const { useState, useRef, useLayoutEffect, useCallback } = React;

/** How far from the bottom still counts as "following the stream". */
const FOLLOW_THRESHOLD_PX = 50;
/** How far up the reader must be before the jump-to-latest button appears. */
const SCROLL_BUTTON_THRESHOLD_PX = 100;

export interface MainChatProps {
    /** Shown in the centre of an empty fullscreen chat, under the greeting. */
    emptyComposer?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

/**
 * The transcript: the welcome screen while the conversation is empty, then the
 * messages, the thinking indicator and any questionnaire the agent is asking.
 *
 * It follows the stream while the reader is at the bottom and stops following
 * once they scroll up to read, with a button to jump back.
 */
export const MainChat: React.FC<MainChatProps> = ({ emptyComposer, className = '', style }) => {
    const messages = useChatState(s => s.messages);
    const activeConversationId = useChatState(s => s.activeConversationId);
    const isBusy = useChatState(s => s.isThinking || s.isResuming);
    const registeredTools = useChatState(s => s.registeredTools);
    const pendingQuestions = useChatState(s => s.pendingQuestions);
    const staleClientCall = useChatState(s => s.staleClientCall);
    const actions = useChatActions();
    const labels = useLabels();
    const icons = useIcons();

    // Stable for the chat's lifetime, so a memoised bubble is not re-rendered
    // just because the transcript was.
    const onRetry = useCallback(() => {
        void actions.retryTurn();
    }, [actions]);
    const onContinue = useCallback(() => {
        void actions.continueTurn();
    }, [actions]);

    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const isProgrammaticScroll = useRef(false);

    const hasMessages = messages.length > 0;

    const scrollToBottomInstant = () => {
        if (!scrollRef.current) return;
        isProgrammaticScroll.current = true;
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        requestAnimationFrame(() => {
            isProgrammaticScroll.current = false;
        });
    };

    // The transcript's own scroll position, and nothing else's. This used to be
    // `scrollIntoView` on an element at the end, which scrolls *every*
    // scrollable ancestor until that element is visible — inside a host page
    // that includes the page itself, so jumping to the latest message pushed
    // the host's whole layout up and left blank space under it.
    const scrollToBottomSmooth = () => {
        const view = scrollRef.current;
        if (!view) return;
        setIsAtBottom(true);
        view.scrollTo({ top: view.scrollHeight, behavior: 'smooth' });
    };

    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        setShowScrollBtn(hasMessages && distanceFromBottom > SCROLL_BUTTON_THRESHOLD_PX);
        if (!isProgrammaticScroll.current) {
            setIsAtBottom(distanceFromBottom < FOLLOW_THRESHOLD_PX);
        }
    };

    // Another conversation, or a new empty one, is read from its own start: the
    // scroll view is shared, so without this a new chat opened from the bottom
    // of a long thread showed the welcome screen scrolled to *its* bottom, and a
    // thread picked while reading back through the last one stayed unfollowed.
    // A transcript starts following (the effect below then scrolls it to its
    // end); the welcome screen starts at its top.
    useLayoutEffect(() => {
        setIsAtBottom(true);
        setShowScrollBtn(false);
        if (!hasMessages && scrollRef.current) {
            isProgrammaticScroll.current = true;
            scrollRef.current.scrollTop = 0;
            requestAnimationFrame(() => {
                isProgrammaticScroll.current = false;
            });
        }
    }, [activeConversationId, hasMessages]);

    // Following applies to a transcript. The welcome screen grows too — a
    // quick-action category opening — and following it would scroll the
    // greeting out of view.
    useLayoutEffect(() => {
        if (isAtBottom && hasMessages) {
            scrollToBottomInstant();
        }
    }, [messages, isAtBottom, hasMessages]);

    useLayoutEffect(() => {
        if (!contentRef.current || !hasMessages) return undefined;
        let rafId: number | null = null;
        const observer = new ResizeObserver(() => {
            if (!isAtBottom) return;
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                scrollToBottomInstant();
                rafId = null;
            });
        });
        observer.observe(contentRef.current);
        return () => {
            observer.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [isAtBottom, hasMessages]);

    const lastMessage = messages[messages.length - 1];
    const showThinking = isBusy && (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.content);

    return (
        <div className={`cb-main-chat ${className}`} style={style}>
            <div className="cb-messages-area">
                <div className="cb-scroll-view" ref={scrollRef} onScroll={handleScroll}>
                    <div ref={contentRef}>
                        {hasMessages ? (
                            <>
                                {messages.map((message, index) => {
                                    if (message.role !== 'assistant') {
                                        return <MessageBubble key={message.id} {...message} shouldAnimate={false} />;
                                    }
                                    const isLiveTurn = index === messages.length - 1 && isBusy;
                                    return (
                                        <MessageBubble
                                            key={message.id}
                                            {...message}
                                            tools={message.tools ? { ...registeredTools, ...message.tools } : registeredTools}
                                            onConfirm={message.onConfirm ?? actions.confirmApproval}
                                            onReject={message.onReject ?? actions.rejectApproval}
                                            onRetry={message.onRetry ?? onRetry}
                                            onContinue={message.onContinue ?? onContinue}
                                            isTurnComplete={!isLiveTurn}
                                            shouldAnimate={false}
                                        />
                                    );
                                })}
                                {showThinking && (
                                    <div className="cb-main-chat-thinking">
                                        <ThinkingIndicator />
                                    </div>
                                )}
                            </>
                        ) : (
                            <WelcomeScreen composer={emptyComposer} />
                        )}
                    </div>
                </div>
                <div className={`cb-scroll-shadow-bottom ${!isAtBottom ? 'visible' : ''}`} />

                {hasMessages && (
                    <button
                        type="button"
                        className={`cb-scroll-bottom-btn ${showScrollBtn ? 'visible' : ''}`}
                        onClick={scrollToBottomSmooth}
                        aria-label={labels.scrollToLatest}
                        title={labels.scrollToLatest}
                    >
                        {icons.scrollDown}
                    </button>
                )}
            </div>

            {staleClientCall && !pendingQuestions && (
                <div role="status" className="cb-stale-client-call">
                    {labels.staleClientCall}
                </div>
            )}

            {pendingQuestions && (
                <QuestionnaireForm questions={pendingQuestions} onSubmit={actions.submitQuestionnaire} />
            )}
        </div>
    );
};

export const ChatMessages = MainChat;
