import React from 'react';
const { useState, useRef, useEffect } = React;
import './ChatHeader.css';
import type { ChatMode } from '../ChatContainer/ChatContainer';
import { useChatbot } from '../../context/ChatbotContext';

export interface ChatHeaderProps {
    brand?: React.ReactNode;
    title?: string;
    showDrawerToggle?: boolean;
    onToggleDrawer?: () => void;
    isDrawerOpen?: boolean;
    headerActions?: React.ReactNode;
    showShare?: boolean;
    onShare?: () => void;
    showNewChat?: boolean;
    onNewChat?: () => void;
    showMoreMenu?: boolean;
    onManageMemory?: () => void;
    onViewUsage?: () => void;
    onSwitchMode?: (newMode: ChatMode) => void;
    allowedModes?: ChatMode[];
    currentMode?: ChatMode;
    onCopyConversationId?: () => void;
    activeConversationId?: string | null;
    onDeleteThread?: () => void;
    showClose?: boolean;
    onClose?: () => void;
    extraMenuItems?: React.ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

const ALL_MODES: ChatMode[] = ['floating', 'sidebar', 'fullscreen'];

export const ChatHeader: React.FC<ChatHeaderProps> = ({
    brand: brandProp,
    title,
    showDrawerToggle = true,
    onToggleDrawer: onToggleDrawerProp,
    isDrawerOpen: isDrawerOpenProp,
    headerActions,
    showShare = true,
    onShare: onShareProp,
    showNewChat = true,
    onNewChat: onNewChatProp,
    showMoreMenu = true,
    onManageMemory,
    onViewUsage,
    onSwitchMode: onSwitchModeProp,
    allowedModes: allowedModesProp,
    currentMode: currentModeProp,
    onCopyConversationId: onCopyConversationIdProp,
    activeConversationId: activeConversationIdProp,
    onDeleteThread: onDeleteThreadProp,
    showClose = true,
    onClose: onCloseProp,
    extraMenuItems,
    className = '',
    style,
}) => {
    const context = useChatbot();

    const isDrawerOpen = isDrawerOpenProp !== undefined ? isDrawerOpenProp : (context?.isDrawerOpen ?? false);
    const onToggleDrawer = onToggleDrawerProp !== undefined
        ? onToggleDrawerProp
        : (context ? () => context.setIsDrawerOpen(!context.isDrawerOpen) : undefined);

    const onShare = onShareProp !== undefined ? onShareProp : context?.onShare;
    const onNewChat = onNewChatProp !== undefined ? onNewChatProp : context?.newChat;
    const onClose = onCloseProp !== undefined ? onCloseProp : context?.onClose;
    const onSwitchMode = onSwitchModeProp !== undefined ? onSwitchModeProp : context?.onSwitchMode;
    const currentMode = currentModeProp !== undefined ? currentModeProp : (context?.mode ?? 'floating');
    const allowedModes = allowedModesProp && allowedModesProp.length > 0 ? allowedModesProp : ALL_MODES;
    const activeConversationId = activeConversationIdProp !== undefined ? activeConversationIdProp : context?.activeConversationId;
    const onCopyConversationId = onCopyConversationIdProp !== undefined ? onCopyConversationIdProp : context?.copyConversationId;
    const onDeleteThread = onDeleteThreadProp !== undefined ? onDeleteThreadProp : (context && activeConversationId ? () => context.deleteConversation(activeConversationId) : undefined);

    const hasMessages = (context?.messages && context.messages.length > 0) || false;

    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [copiedId, setCopiedId] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

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
        if (allowedModes.length <= 1) return;
        const currentIndex = allowedModes.indexOf(currentMode);
        const nextIndex = (currentIndex + 1) % allowedModes.length;
        const nextMode = allowedModes[nextIndex];
        onSwitchMode?.(nextMode);
    };

    const brand = brandProp !== undefined ? brandProp : (
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
            <span className="cb-brand">{title || 'AI Assistant'}</span>
        </div>
    );

    return (
        <div className={`cb-chat-header ${className}`} style={style}>
            <div className="cb-header-left">
                {showDrawerToggle && onToggleDrawer && (
                    <button
                        type="button"
                        className="cb-header-btn cb-drawer-toggle-btn"
                        onClick={onToggleDrawer}
                        aria-label={isDrawerOpen ? 'Close menu' : 'Open menu'}
                        aria-expanded={isDrawerOpen}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                        </svg>
                    </button>
                )}
                {brand}
            </div>

            <div className="cb-actions">
                {headerActions}

                {showShare && onShare && (
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

                {showNewChat && hasMessages && onNewChat && (
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

                {showMoreMenu && (
                    <div className="cb-header-menu-container" ref={menuRef}>
                        <button
                            type="button"
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
                                {onManageMemory && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            onManageMemory();
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
                                )}

                                {allowedModes.length > 1 && onSwitchMode && (
                                    <button
                                        type="button"
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

                                {onViewUsage && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            onViewUsage();
                                        }}
                                        role="menuitem"
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <circle cx="12" cy="12" r="10" />
                                            <polyline points="12 6 12 12 16 14" />
                                        </svg>
                                        <span>View my usage</span>
                                    </button>
                                )}

                                {activeConversationId && (
                                    <button
                                        type="button"
                                        className="cb-header-menu-item"
                                        onClick={() => {
                                            if (navigator.clipboard) {
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
                                )}

                                {onDeleteThread && (
                                    <button
                                        type="button"
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

                                {extraMenuItems}
                            </div>
                        )}
                    </div>
                )}

                {showClose && onClose && (
                    <button
                        type="button"
                        className="cb-minimize-btn"
                        onClick={onClose}
                        aria-label="Close chat"
                        title="Close chat"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                    </button>
                )}
            </div>
        </div>
    );
};

export const HeaderBar = ChatHeader;
