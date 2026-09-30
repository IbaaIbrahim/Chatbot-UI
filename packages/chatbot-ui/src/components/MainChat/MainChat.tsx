import React from 'react';
const { useState, useRef, useLayoutEffect } = React;
import './MainChat.css';
import { MessageBubble, MessageProps } from '../MessageBubble/MessageBubble';
import { ThinkingIndicator } from '../ThinkingIndicator/ThinkingIndicator';
import { WelcomeScreen } from '../WelcomeScreen/WelcomeScreen';
import { QuestionnaireForm, QuestionSpec } from '../Questionnaire/QuestionnaireForm';
import type { ChatbotUIConfig } from '../../common/chatbotConfig';
import type { ChatMode } from '../ChatContainer/ChatContainer';
import type { ToolConfig } from '../../common/toolConfig';
import { useChatbot } from '../../context/ChatbotContext';

export interface MainChatProps {
    messages?: MessageProps[];
    isThinking?: boolean;
    isResuming?: boolean;
    userName?: string;
    config?: ChatbotUIConfig;
    mode?: ChatMode;
    tools?: Record<string, ToolConfig>;
    pendingQuestionnaire?: { questions: QuestionSpec[]; resolve: (formatted: string) => void } | null;
    onQuestionnaireSubmit?: (formatted: string) => void;
    staleClientCall?: boolean;
    onRetryTurn?: () => void;
    onContinueTurn?: () => void;
    onConfirmApproval?: (approvalUuid: string) => void;
    onRejectApproval?: (approvalUuid: string) => void;
    onSelectSuggestion?: (prompt: string) => void;
    emptyComposer?: React.ReactNode;
    welcomeActions?: any[];
    className?: string;
    style?: React.CSSProperties;
}

export const MainChat: React.FC<MainChatProps> = ({
    messages: messagesProp,
    isThinking: isThinkingProp,
    isResuming: isResumingProp,
    userName: userNameProp,
    config: configProp,
    mode: modeProp,
    tools: toolsProp,
    pendingQuestionnaire: pendingQuestionnaireProp,
    onQuestionnaireSubmit: onQuestionnaireSubmitProp,
    staleClientCall: staleClientCallProp,
    onRetryTurn: onRetryTurnProp,
    onContinueTurn: onContinueTurnProp,
    onConfirmApproval: onConfirmApprovalProp,
    onRejectApproval: onRejectApprovalProp,
    onSelectSuggestion: onSelectSuggestionProp,
    emptyComposer,
    welcomeActions = [],
    className = '',
    style,
}) => {
    const context = useChatbot();

    const messages = messagesProp !== undefined ? messagesProp : (context?.messages ?? []);
    const isThinking = isThinkingProp !== undefined ? isThinkingProp : (context?.isThinking ?? false);
    const isResuming = isResumingProp !== undefined ? isResumingProp : (context?.isResuming ?? false);
    const userName = userNameProp !== undefined ? userNameProp : (context?.userName ?? 'User');
    const config = configProp !== undefined ? configProp : context?.config;
    const mode = modeProp !== undefined ? modeProp : (context?.mode ?? 'floating');
    const registeredTools = toolsProp !== undefined ? toolsProp : (context?.registeredTools ?? {});
    const pendingQuestionnaire = pendingQuestionnaireProp !== undefined ? pendingQuestionnaireProp : (context?.pendingQuestionnaire ?? null);
    const onQuestionnaireSubmit = onQuestionnaireSubmitProp !== undefined ? onQuestionnaireSubmitProp : context?.handleQuestionnaireSubmit;
    const staleClientCall = staleClientCallProp !== undefined ? staleClientCallProp : (context?.staleClientCall ?? false);

    const onRetry = onRetryTurnProp !== undefined ? onRetryTurnProp : (() => { void context?.retryTurn(); });
    const onContinue = onContinueTurnProp !== undefined ? onContinueTurnProp : (() => { void context?.continueTurn(); });
    const onConfirm = onConfirmApprovalProp !== undefined ? onConfirmApprovalProp : context?.confirmApproval;
    const onReject = onRejectApprovalProp !== undefined ? onRejectApprovalProp : context?.rejectApproval;

    const onSelectSuggestion = onSelectSuggestionProp !== undefined
        ? onSelectSuggestionProp
        : (prompt: string) => { void context?.sendMessage(prompt); };

    // Scroll engine
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const isProgrammaticScroll = useRef(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollEndRef = useRef<HTMLDivElement>(null);

    const hasMessages = messages.length > 0;

    const scrollToBottomInstant = () => {
        if (scrollRef.current) {
            isProgrammaticScroll.current = true;
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            requestAnimationFrame(() => {
                isProgrammaticScroll.current = false;
            });
        }
    };

    const scrollToBottomSmooth = () => {
        setIsAtBottom(true);
        scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleScroll = () => {
        if (!scrollRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        const distFromBottom = scrollHeight - scrollTop - clientHeight;

        const totalScrollable = scrollHeight - clientHeight;
        const progress = totalScrollable > 0 ? (scrollTop / totalScrollable) * 100 : 0;
        setScrollProgress(progress);

        setShowScrollBtn(hasMessages && distFromBottom > 100);

        if (!isProgrammaticScroll.current) {
            setIsAtBottom(distFromBottom < 50);
        }
    };

    useLayoutEffect(() => {
        if (isAtBottom) {
            scrollToBottomInstant();
        }
    }, [messages, isAtBottom]);

    useLayoutEffect(() => {
        if (!contentRef.current) return;
        let rafId: number | null = null;
        const observer = new ResizeObserver(() => {
            if (isAtBottom) {
                if (rafId !== null) {
                    cancelAnimationFrame(rafId);
                }
                rafId = requestAnimationFrame(() => {
                    scrollToBottomInstant();
                    rafId = null;
                });
            }
        });
        observer.observe(contentRef.current);
        return () => {
            observer.disconnect();
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
        };
    }, [isAtBottom]);

    const showThinking = (isThinking || isResuming) && (
        messages.length === 0 ||
        messages[messages.length - 1]?.role !== 'assistant' ||
        !messages[messages.length - 1]?.content
    );

    return (
        <div className={`cb-main-chat ${className}`} style={style}>
            <div className="cb-messages-area">
                <div className="cb-scroll-progress-container">
                    <div
                        className="cb-scroll-progress-bar"
                        style={{ width: `${scrollProgress}%` }}
                    />
                </div>
                <div className={`cb-scroll-shadow-top ${scrollProgress > 5 ? 'visible' : ''}`} />

                <div
                    className="cb-scroll-view"
                    ref={scrollRef}
                    onScroll={handleScroll}
                >
                    <div ref={contentRef}>
                        {messages.length === 0 ? (
                            <WelcomeScreen
                                userName={userName}
                                config={config}
                                mode={mode}
                                composer={emptyComposer}
                                onSelectSuggestion={onSelectSuggestion}
                                actions={welcomeActions}
                            />
                        ) : (
                            <>
                                {messages.map((msg, index) => {
                                    const isLiveTurn =
                                        index === messages.length - 1 &&
                                        msg.role === 'assistant' &&
                                        (isThinking || isResuming);

                                    const withTools =
                                        msg.role === 'assistant'
                                            ? {
                                                  ...msg,
                                                  tools: { ...registeredTools, ...(msg.tools ?? {}) },
                                                  onConfirm: msg.onConfirm ?? onConfirm,
                                                  onReject: msg.onReject ?? onReject,
                                                  isTurnComplete: !isLiveTurn,
                                                  onRetry: msg.onRetry ?? onRetry,
                                                  onContinue: msg.onContinue ?? onContinue,
                                              }
                                            : msg;
                                    return (
                                        <MessageBubble key={withTools.id} {...withTools} shouldAnimate={false} />
                                    );
                                })}
                                {showThinking && (
                                    <div style={{ paddingLeft: '16px' }}>
                                        <ThinkingIndicator />
                                    </div>
                                )}
                            </>
                        )}
                        <div ref={scrollEndRef} />
                    </div>
                </div>
                <div className={`cb-scroll-shadow-bottom ${!isAtBottom ? 'visible' : ''}`} />

                {hasMessages && (
                    <button
                        type="button"
                        className={`cb-scroll-bottom-btn ${showScrollBtn ? 'visible' : ''}`}
                        onClick={scrollToBottomSmooth}
                        aria-label="Scroll to latest message"
                    >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                    </button>
                )}
            </div>

            {staleClientCall && !pendingQuestionnaire && (
                <div
                    role="status"
                    style={{
                        padding: '8px 16px',
                        fontSize: 13,
                        opacity: 0.75,
                    }}
                >
                    This turn is waiting on a response from this page that can no longer be delivered.
                </div>
            )}

            {pendingQuestionnaire && onQuestionnaireSubmit && (
                <QuestionnaireForm
                    questions={pendingQuestionnaire.questions}
                    onSubmit={onQuestionnaireSubmit}
                />
            )}
        </div>
    );
};

export const ChatMessages = MainChat;
