import React from 'react';
import { ChatbotUIConfig, DEFAULT_CHATBOT_CONFIG } from '../../common/chatbotConfig';
import { ChatMode } from '../ChatContainer/ChatContainer';
import './WelcomeScreen.css';

export interface QuickAction {
    id: string;
    label: string;
    icon?: React.ReactNode;
    onClick: () => void;
}

export interface WelcomeScreenProps {
    userName?: string;
    config?: ChatbotUIConfig;
    mode?: ChatMode;
    onSelectSuggestion?: (prompt: string) => void;
    composer?: React.ReactNode;
    actions?: QuickAction[]; // For backward compatibility
}

export const WelcomeScreen: React.FC<WelcomeScreenProps> = ({
    userName = 'User',
    config,
    mode = 'sidebar',
    onSelectSuggestion,
    composer,
    actions = [],
}) => {
    // Merge provided config with default fallback
    const effectiveConfig = React.useMemo(() => {
        return {
            greeting: {
                ...DEFAULT_CHATBOT_CONFIG.greeting,
                ...config?.greeting,
            },
            contextSelector: {
                ...DEFAULT_CHATBOT_CONFIG.contextSelector,
                ...config?.contextSelector,
            },
            suggestions: config?.suggestions ?? DEFAULT_CHATBOT_CONFIG.suggestions ?? [],
            quickActions: config?.quickActions ?? DEFAULT_CHATBOT_CONFIG.quickActions ?? [],
            featureCards: config?.featureCards ?? DEFAULT_CHATBOT_CONFIG.featureCards ?? [],
        };
    }, [config]);

    const greetingTitle = React.useMemo(() => {
        let raw = effectiveConfig.greeting?.title || 'What would you like to do?';
        if (raw.includes('{name}')) raw = raw.replace('{name}', userName);
        if (raw.includes('{userName}')) raw = raw.replace('{userName}', userName);
        return raw;
    }, [effectiveConfig.greeting?.title, userName]);

    const privacyBadges = effectiveConfig.greeting?.privacyBadges || [];
    const isCompactMode = mode === 'sidebar' || mode === 'floating';

    const renderBadgeIcon = (icon?: string) => {
        switch (icon) {
            case 'shield':
                return (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                );
            case 'message':
                return (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                );
            case 'check':
                return (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                );
            case 'lock':
            default:
                return (
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                );
        }
    };

    const renderSuggestionIcon = (icon?: string) => {
        switch (icon) {
            case 'pin':
                return (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="12" y1="17" x2="12" y2="22" />
                        <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z" />
                    </svg>
                );
            case 'clipboard':
                return (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                        <path d="M9 12h6M9 16h6" />
                    </svg>
                );
            case 'message':
                return (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                    </svg>
                );
            default:
                return (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                );
        }
    };

    const renderQuickActionIcon = (icon?: string) => {
        switch (icon) {
            case 'clock':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                    </svg>
                );
            case 'pencil':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                        <path d="m15 5 4 4" />
                    </svg>
                );
            case 'bolt':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                );
            case 'sparkle':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z" />
                    </svg>
                );
            case 'clipboard':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                    </svg>
                );
            case 'message':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                );
            case 'help':
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                );
            default:
                return (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                    </svg>
                );
        }
    };

    const renderFeatureCardIcon = (icon?: string) => {
        switch (icon) {
            case 'globe':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M2 12h20" />
                        <path d="M12 2a15.3 15.3 0 0 1 0 20" />
                        <path d="M12 2a15.3 15.3 0 0 0 0 20" />
                    </svg>
                );
            case 'file':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                );
            case 'settings':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="3" />
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                );
            case 'shield':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <polyline points="9 12 11 14 15 10" />
                    </svg>
                );
            case 'chart':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="20" x2="18" y2="10" />
                        <line x1="12" y1="20" x2="12" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="14" />
                    </svg>
                );
            case 'slides':
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="4" width="18" height="14" rx="2" />
                        <path d="M8 21h8" />
                        <path d="M12 18v3" />
                        <path d="M8 9h8M8 13h5" />
                    </svg>
                );
            default:
                return (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    </svg>
                );
        }
    };

    const getFeatureCardVariant = (card: NonNullable<ChatbotUIConfig['featureCards']>[number]) =>
        (card.icon || card.id || 'default').replace(/[^a-z0-9-]/gi, '-').toLowerCase();

    const renderFeatureCardMedia = (card: NonNullable<ChatbotUIConfig['featureCards']>[number]) => {
        const variant = getFeatureCardVariant(card);

        if (card.image) {
            return (
                <div className="cb-feature-card-media cb-feature-card-media-image">
                    <img src={card.image} alt="" aria-hidden="true" />
                </div>
            );
        }

        return (
            <div className={`cb-feature-card-media cb-feature-card-media-${variant}`} aria-hidden="true">
                <div className="cb-card-visual-surface">
                    {variant === 'settings' || variant === 'agents' ? (
                        <>
                            <span className="cb-card-visual-chip cb-chip-primary">Daily Briefing Agent</span>
                            <span className="cb-card-visual-chip cb-chip-secondary">Problem Site Identifier</span>
                            <span className="cb-card-visual-dot dot-one" />
                            <span className="cb-card-visual-dot dot-two" />
                        </>
                    ) : variant === 'chart' || variant === 'charts' ? (
                        <>
                            <span className="cb-card-visual-metric">92%</span>
                            <span className="cb-card-visual-bar bar-one" />
                            <span className="cb-card-visual-bar bar-two" />
                            <span className="cb-card-visual-bar bar-three" />
                            <span className="cb-card-visual-line" />
                        </>
                    ) : variant === 'slides' ? (
                        <>
                            <span className="cb-card-visual-slide slide-main" />
                            <span className="cb-card-visual-slide slide-side" />
                            <span className="cb-card-visual-chart-mini" />
                        </>
                    ) : (
                        <>
                            <span className="cb-card-visual-chip cb-chip-primary">Does FSANZ 3.2.2A apply?</span>
                            <span className="cb-card-visual-source">foodstandards.gov</span>
                            <span className="cb-card-visual-panel" />
                        </>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className={`cb-welcome-container ${isCompactMode ? 'cb-welcome-compact' : 'cb-welcome-expanded'}`}>
            {/* Mitti / Flowdit Sparkle Brand Icon */}
            <div className="cb-welcome-sparkle-wrapper">
                <div className="cb-welcome-sparkle-badge">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffffff">
                        <path
                            d="M12 2L14.4 9.6L22 12L14.4 14.4L12 22L9.6 14.4L2 12L9.6 9.6L12 2Z"
                        />
                    </svg>
                </div>
            </div>

            {/* Greeting Header */}
            <h2 className="cb-welcome-title">{greetingTitle}</h2>

            {/* Privacy / Context Badges */}
            {privacyBadges.length > 0 && (
                <div className="cb-welcome-privacy-badges">
                    {privacyBadges.map((badge, idx) => (
                        <div key={idx} className="cb-welcome-privacy-badge">
                            <span className="cb-privacy-icon">{renderBadgeIcon(badge.icon)}</span>
                            <span className="cb-privacy-text">{badge.text}</span>
                        </div>
                    ))}
                </div>
            )}

            {!isCompactMode && composer && (
                <div className="cb-welcome-composer-slot">
                    {composer}
                </div>
            )}

            {/* Compact / Sidebar Mode: Suggestion Question Cards (Image 3) */}
            {isCompactMode ? (
                <div className="cb-welcome-suggestions-list">
                    {effectiveConfig.suggestions.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="cb-welcome-suggestion-row"
                            onClick={() => onSelectSuggestion?.(item.prompt || item.text)}
                        >
                            <div className={`cb-suggestion-icon-badge cb-icon-${item.icon || 'pin'}`}>
                                {renderSuggestionIcon(item.icon)}
                            </div>
                            <span className="cb-suggestion-text">{item.text}</span>
                        </button>
                    ))}
                </div>
            ) : (
                /* Fullscreen / Embedded Mode: Quick Action Pills + Feature Cards (Image 1) */
                <div className="cb-welcome-expanded-content">
                    {/* Quick action pills row */}
                    {effectiveConfig.quickActions.length > 0 && (
                        <div className="cb-welcome-quick-actions">
                            {effectiveConfig.quickActions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    className="cb-welcome-quick-action-pill"
                                    onClick={() => onSelectSuggestion?.(action.prompt || action.label)}
                                >
                                    {renderQuickActionIcon(action.icon)}
                                    <span>{action.label}</span>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Feature cards 2x2 grid */}
                    {effectiveConfig.featureCards.length > 0 && (
                        <div className="cb-welcome-feature-cards-grid">
                            {effectiveConfig.featureCards.map((card) => (
                                <button
                                    key={card.id}
                                    type="button"
                                    className="cb-welcome-feature-card"
                                    onClick={() => onSelectSuggestion?.(card.prompt || card.title)}
                                >
                                    {renderFeatureCardMedia(card)}
                                    <div className="cb-feature-card-body">
                                        <div className="cb-feature-card-header">
                                            <div className="cb-feature-card-icon">
                                                {renderFeatureCardIcon(card.icon)}
                                            </div>
                                            {card.badge && (
                                                <span className="cb-feature-card-badge">{card.badge}</span>
                                            )}
                                        </div>
                                        <h3 className="cb-feature-card-title">{card.title}</h3>
                                        <p className="cb-feature-card-desc">{card.description}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Legacy actions fallback if provided and no suggestions/quickActions */}
            {actions.length > 0 && effectiveConfig.suggestions.length === 0 && effectiveConfig.quickActions.length === 0 && (
                <div className="cb-quick-actions-grid">
                    {actions.map((action) => (
                        <button key={action.id} className="cb-quick-action-card" onClick={action.onClick}>
                            <div className="cb-action-icon">{action.icon}</div>
                            <span className="cb-action-label">{action.label}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
