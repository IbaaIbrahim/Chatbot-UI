import React from 'react';
const { useState, useEffect, useRef, useLayoutEffect } = React;
import './ChatContainer.css';

export type ChatMode = 'floating' | 'sidebar' | 'fullscreen';

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

export type ChatTheme = 'light' | 'dark' | 'system';

const ALL_MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];

export const ChatContainer: React.FC<ChatContainerProps> = ({
    mode = 'floating',
    allowedModes,
    onSwitchMode,
    theme = 'system',
    isOpen = true,
    embedded = false,
    noBackground = false,
    onClose,
    onOpen,
    children,
    drawerContent,
    footer,
    isDrawerOpen: controlledIsDrawerOpen,
    hasMessages = false,
    onDrawerOpenChange,
    headerActions,
    brand,
    onManageMemory,
    onViewUsage,
    onNewChat,
    onCopyConversationId,
    onDeleteThread,
    onShare,
    activeConversationId,
}) => {
    const [mounted, setMounted] = useState(false);
    const [internalIsDrawerOpen, setInternalIsDrawerOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [copiedId, setCopiedId] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const effectiveAllowedModes = allowedModes && allowedModes.length > 0 ? allowedModes : ALL_MODES;
    const effectiveMode = effectiveAllowedModes.includes(mode) ? mode : effectiveAllowedModes[0];

    const isDrawerOpen = controlledIsDrawerOpen !== undefined ? controlledIsDrawerOpen : internalIsDrawerOpen;

    const setIsDrawerOpen = (open: boolean) => {
        setInternalIsDrawerOpen(open);
        onDrawerOpenChange?.(open);
    };

    const [showScrollBtn, setShowScrollBtn] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollProgress, setScrollProgress] = useState(0);
    const [isAtBottom, setIsAtBottom] = useState(true);
    const isProgrammaticScroll = useRef(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
        if (!isMenuOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMenuOpen]);

    const handleCycleMode = () => {
        setIsMenuOpen(false);
        if (effectiveAllowedModes.length <= 1) return;
        const currentIndex = effectiveAllowedModes.indexOf(effectiveMode);
        const nextIndex = (currentIndex + 1) % effectiveAllowedModes.length;
        const nextMode = effectiveAllowedModes[nextIndex];
        onSwitchMode?.(nextMode);
    };

    // Instant scroll for auto-scroll during streaming
    const scrollToBottomInstant = () => {
        if (scrollRef.current) {
            isProgrammaticScroll.current = true;
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            requestAnimationFrame(() => {
                isProgrammaticScroll.current = false;
            });
        }
    };

    // Smooth scroll for manual button
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

    const contentRef = useRef<HTMLDivElement>(null);
    const scrollEndRef = useRef<HTMLDivElement>(null);

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

    React.useEffect(() => {
        if (!isDrawerOpen && !isMenuOpen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsDrawerOpen(false);
                setIsMenuOpen(false);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isDrawerOpen, isMenuOpen, setIsDrawerOpen]);

    if (!mounted) return null;

    if (!isOpen && effectiveMode === 'floating' && !embedded) {
        return (
            <button
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

    return (
        <div className={containerClasses} data-theme={theme === 'system' ? undefined : theme}>
            <div className="cb-chat-header">
                <div className="cb-header-left">
                    <button
                        className="cb-header-btn cb-drawer-toggle-btn"
                        onClick={() => setIsDrawerOpen(!isDrawerOpen)}
                        aria-label={isDrawerOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={isDrawerOpen}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                    {brand ?? (
                        <div className="cb-brand-wrapper">
                            <div className="cb-header-sparkle">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path
                                        d="M12 2L14.2 9.8L22 12L14.2 14.2L12 22L9.8 14.2L2 12L9.8 9.8L12 2Z"
                                        fill="url(#cb-sparkle-gradient-hdr)"
                                    />
                                    <defs>
                                        <linearGradient id="cb-sparkle-gradient-hdr" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                                            <stop stopColor="#6366F1" />
                                            <stop offset="0.5" stopColor="#38BDF8" />
                                            <stop offset="1" stopColor="#F59E0B" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                            </div>
                            <span className="cb-brand">AI Assistant</span>
                        </div>
                    )}
                </div>

                <div className="cb-actions">
                    {headerActions}

                    {onShare && (
                        <button
                            type="button"
                            className="cb-header-btn cb-share-btn"
                            onClick={onShare}
                            title="Share conversation"
                            aria-label="Share conversation"
                        >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                                <polyline points="16 6 12 2 8 6" />
                                <line x1="12" y1="2" x2="12" y2="15" />
                            </svg>
                        </button>
                    )}

                    {/* New chat button at top right, visible after first message */}
                    {hasMessages && onNewChat && (
                        <button
                            type="button"
                            className="cb-header-new-chat-btn"
                            onClick={onNewChat}
                            title="Start a new chat"
                            aria-label="New chat"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                            </svg>
                            <span>New chat</span>
                        </button>
                    )}

                    {/* More options menu (3 dots) matching Image 4 & context menu */}
                    <div className="cb-header-menu-container" ref={menuRef}>
                        <button
                            className="cb-header-btn cb-more-btn"
                            onClick={() => setIsMenuOpen(!isMenuOpen)}
                            aria-label="More options"
                            aria-expanded={isMenuOpen}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                                <circle cx="12" cy="12" r="2" />
                                <circle cx="19" cy="12" r="2" />
                                <circle cx="5" cy="12" r="2" />
                            </svg>
                        </button>

                        {isMenuOpen && (
                            <div className="cb-header-dropdown-menu" role="menu">
                                <button
                                    className="cb-header-menu-item"
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        onManageMemory?.();
                                    }}
                                    role="menuitem"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                        <polyline points="14 2 14 8 20 8" />
                                        <line x1="16" y1="13" x2="8" y2="13" />
                                        <line x1="16" y1="17" x2="8" y2="17" />
                                        <polyline points="10 9 9 9 8 9" />
                                    </svg>
                                    <span>Manage memory</span>
                                </button>

                                {effectiveAllowedModes.length > 1 && (
                                    <button
                                        className="cb-header-menu-item"
                                        onClick={handleCycleMode}
                                        role="menuitem"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="15 3 21 3 21 9" />
                                            <polyline points="9 21 3 21 3 15" />
                                            <line x1="21" y1="3" x2="14" y2="10" />
                                            <line x1="3" y1="21" x2="10" y2="14" />
                                        </svg>
                                        <span>Switch view</span>
                                    </button>
                                )}

                                <button
                                    className="cb-header-menu-item"
                                    onClick={() => {
                                        setIsMenuOpen(false);
                                        onViewUsage?.();
                                    }}
                                    role="menuitem"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="12" cy="12" r="10" />
                                        <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                    <span>View my usage</span>
                                </button>

                                <button
                                    className="cb-header-menu-item"
                                    onClick={() => {
                                        if (activeConversationId && navigator.clipboard) {
                                            void navigator.clipboard.writeText(activeConversationId);
                                        }
                                        onCopyConversationId?.();
                                        setCopiedId(true);
                                        setTimeout(() => setCopiedId(false), 2000);
                                    }}
                                    role="menuitem"
                                >
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                    </svg>
                                    <span>{copiedId ? 'Copied ID!' : 'Copy conversation ID'}</span>
                                </button>

                                {onDeleteThread && (
                                    <button
                                        className="cb-header-menu-item cb-header-menu-item-danger"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            onDeleteThread();
                                        }}
                                        role="menuitem"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <polyline points="3 6 5 6 21 6" />
                                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                            <line x1="10" y1="11" x2="10" y2="17" />
                                            <line x1="14" y1="11" x2="14" y2="17" />
                                        </svg>
                                        <span>Delete thread</span>
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    {onClose && (
                        <button className="cb-minimize-btn" onClick={onClose} aria-label="Close chat">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    )}
                </div>
            </div>

            <div className="cb-chat-body-wrapper">
                <div className={`cb-drawer-wrapper ${isDrawerOpen ? 'open' : ''}`}>
                    <div className="cb-drawer-content">
                        {drawerContent}
                    </div>
                    <div className="cb-drawer-backdrop" onClick={() => setIsDrawerOpen(false)}></div>
                </div>

                <div className="cb-chat-content">
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
                                {children}
                                <div ref={scrollEndRef} />
                            </div>
                        </div>
                        <div className={`cb-scroll-shadow-bottom ${!isAtBottom ? 'visible' : ''}`} />

                        {hasMessages && (
                            <button
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
