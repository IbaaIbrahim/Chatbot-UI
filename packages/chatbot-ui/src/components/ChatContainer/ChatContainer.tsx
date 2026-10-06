import React from 'react';
const { useState, useEffect, useRef, useLayoutEffect, useMemo } = React;
import './ChatContainer.css';
import { ChatHeader } from '../ChatHeader/ChatHeader';
import { ConversationSidebar } from '../ConversationSidebar/ConversationSidebar';
import { MainChat } from '../MainChat/MainChat';
import { useChatbot } from '../../context/ChatbotContext';

export type ChatMode = 'floating' | 'sidebar' | 'fullscreen';
export type ChatTheme = 'light' | 'dark' | 'system';

export interface ChatContainerProps {
    mode?: ChatMode;
    allowedModes?: ChatMode[];
    onSwitchMode?: (newMode: ChatMode) => void;
    isOpen?: boolean;
    embedded?: boolean;
    noBackground?: boolean;
    onClose?: () => void;
    onOpen?: () => void;
    children?: React.ReactNode;
    header?: React.ReactNode;
    drawerContent?: React.ReactNode;
    footer?: React.ReactNode;
    isDrawerOpen?: boolean;
    onDrawerOpenChange?: (isOpen: boolean) => void;
    headerActions?: React.ReactNode;
    brand?: React.ReactNode;
    theme?: ChatTheme;
    onManageMemory?: () => void;
    onViewUsage?: () => void;
    hasMessages?: boolean;
    onNewChat?: () => void;
    onCopyConversationId?: () => void;
    onDeleteThread?: () => void;
    onShare?: () => void;
    activeConversationId?: string | null;
}

const ALL_MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];

export const ChatContainer: React.FC<ChatContainerProps> = ({
    mode: modeProp,
    allowedModes,
    onSwitchMode: onSwitchModeProp,
    theme: themeProp,
    isOpen: isOpenProp,
    embedded = false,
    noBackground = false,
    onClose: onCloseProp,
    onOpen: onOpenProp,
    children,
    header,
    drawerContent,
    footer,
    isDrawerOpen: controlledIsDrawerOpen,
    hasMessages: hasMessagesProp,
    onDrawerOpenChange,
    headerActions,
    brand,
    onManageMemory,
    onViewUsage,
    onNewChat: onNewChatProp,
    onCopyConversationId: onCopyConversationIdProp,
    onDeleteThread: onDeleteThreadProp,
    onShare: onShareProp,
    activeConversationId: activeConversationIdProp,
}) => {
    const context = useChatbot();

    const mode = modeProp !== undefined ? modeProp : (context?.mode ?? 'floating');
    const theme = themeProp !== undefined ? themeProp : (context?.theme ?? 'system');
    const isOpen = isOpenProp !== undefined ? isOpenProp : (context?.isOpen ?? true);
    const onClose = onCloseProp !== undefined ? onCloseProp : context?.onClose;
    const onOpen = onOpenProp !== undefined ? onOpenProp : context?.onOpen;
    const onSwitchMode = onSwitchModeProp !== undefined ? onSwitchModeProp : context?.onSwitchMode;
    const onShare = onShareProp !== undefined ? onShareProp : context?.onShare;
    const onNewChat = onNewChatProp !== undefined ? onNewChatProp : context?.newChat;
    const activeConversationId = activeConversationIdProp !== undefined ? activeConversationIdProp : context?.activeConversationId;
    const onCopyConversationId = onCopyConversationIdProp !== undefined ? onCopyConversationIdProp : context?.copyConversationId;
    const onDeleteThread = onDeleteThreadProp !== undefined ? onDeleteThreadProp : (context && activeConversationId ? () => context.deleteConversation(activeConversationId) : undefined);
    const hasMessages = hasMessagesProp !== undefined ? hasMessagesProp : Boolean(context?.messages && context.messages.length > 0);

    const [mounted, setMounted] = useState(false);
    const [internalIsDrawerOpen, setInternalIsDrawerOpen] = useState(false);

    const effectiveAllowedModes = allowedModes && allowedModes.length > 0 ? allowedModes : ALL_MODES;
    const effectiveMode = effectiveAllowedModes.includes(mode) ? mode : effectiveAllowedModes[0];

    const isDrawerOpen = controlledIsDrawerOpen !== undefined
        ? controlledIsDrawerOpen
        : (context ? context.isDrawerOpen : internalIsDrawerOpen);

    const setIsDrawerOpen = (open: boolean) => {
        setInternalIsDrawerOpen(open);
        if (context) {
            context.setIsDrawerOpen(open);
        }
        onDrawerOpenChange?.(open);
    };

    // Scroll engine for legacy children (when children is not MainChat)
    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const isProgrammaticScroll = useRef(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const scrollEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

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
    }, [children, isAtBottom]);

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

    useEffect(() => {
        if (!isDrawerOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsDrawerOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isDrawerOpen]);

    const isMainChatChild = useMemo(() => {
        let found = false;
        React.Children.forEach(children, (child) => {
            if (React.isValidElement(child)) {
                if (
                    child.type === MainChat ||
                    (child.type as any)?.displayName === 'MainChat' ||
                    (child.props as any)?.className?.includes('cb-main-chat')
                ) {
                    found = true;
                }
            }
        });
        return found;
    }, [children]);

    if (!mounted) return null;

    if (!isOpen && effectiveMode === 'floating' && !embedded) {
        return (
            <button
                type="button"
                className="cb-chat-launcher cb-launcher-btn"
                data-theme={theme === 'system' ? undefined : theme}
                onClick={() => onOpen?.()}
                aria-label="Open chat"
            >
                <div className="cb-launcher-sparkle-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                        <path
                            d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
                            fill="currentColor"
                        />
                    </svg>
                </div>
            </button>
        );
    }

    const containerClasses = [
        'cb-chat-container',
        `cb-mode-${effectiveMode}`,
        isOpen ? 'cb-open' : 'cb-closed',
        embedded ? 'cb-embedded' : null,
        noBackground ? 'cb-no-background' : null,
    ].filter(Boolean).join(' ');

    const renderedHeader = header !== undefined ? header : (
        <ChatHeader
            brand={brand}
            headerActions={headerActions}
            showShare={Boolean(onShare)}
            onShare={onShare}
            showNewChat={hasMessages && Boolean(onNewChat)}
            onNewChat={onNewChat}
            showMoreMenu={true}
            onManageMemory={onManageMemory}
            onViewUsage={onViewUsage}
            onSwitchMode={onSwitchMode}
            allowedModes={effectiveAllowedModes}
            currentMode={effectiveMode}
            onCopyConversationId={onCopyConversationId}
            activeConversationId={activeConversationId}
            onDeleteThread={onDeleteThread}
            showClose={Boolean(onClose)}
            onClose={onClose}
            isDrawerOpen={isDrawerOpen}
            onToggleDrawer={() => setIsDrawerOpen(!isDrawerOpen)}
        />
    );

    return (
        <div className={containerClasses} data-theme={theme === 'system' ? undefined : theme}>
            <div className="cb-chat-body-wrapper">
                <div className={`cb-drawer-wrapper ${isDrawerOpen ? 'open' : ''}`}>
                    <div className="cb-drawer-content">
                        {drawerContent ?? <ConversationSidebar onClose={() => setIsDrawerOpen(false)} />}
                    </div>
                    <div className="cb-drawer-backdrop" onClick={() => setIsDrawerOpen(false)}></div>
                </div>

                <div className="cb-chat-content">
                    {renderedHeader}
                    {isMainChatChild ? (
                        children
                    ) : (
                        <div className="cb-messages-area">
                            {/* <div className="cb-scroll-progress-container">
                                <div
                                    className="cb-scroll-progress-bar"
                                    style={{ width: `${scrollProgress}%` }}
                                />
                            </div>
                            <div className={`cb-scroll-shadow-top ${scrollProgress > 5 ? 'visible' : ''}`} /> */}

                            <div
                                className="cb-scroll-view"
                                ref={scrollRef}
                                onScroll={handleScroll}
                            >
                                <div ref={contentRef}>
                                    {children}
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
                    )}

                    {footer && (
                        <div className="cb-chat-footer">
                            {footer}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
