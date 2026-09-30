export interface PrivacyBadge {
    text: string;
    icon?: 'lock' | 'shield' | 'check' | string;
}

export interface GreetingConfig {
    title?: string;
    userName?: string;
    privacyBadges?: PrivacyBadge[];
}

export interface ContextOption {
    id: string;
    label: string;
    icon?: string;
}

export interface ContextSelectorConfig {
    enabled?: boolean;
    placeholder?: string;
    options: ContextOption[];
    defaultSelected?: string[];
}

export interface SuggestionItem {
    id: string;
    text: string;
    prompt?: string;
    icon?: 'pin' | 'clipboard' | 'message' | string;
}

export interface QuickActionItem {
    id: string;
    label: string;
    prompt?: string;
    icon?: 'clock' | 'pencil' | 'bolt' | 'message' | string;
}

export interface FeatureCardItem {
    id: string;
    badge?: string;
    icon?: string;
    title: string;
    description: string;
    image?: string;
    prompt?: string;
}

export interface ChatbotUIConfig {
    greeting?: GreetingConfig;
    contextSelector?: ContextSelectorConfig;
    suggestions?: SuggestionItem[];
    quickActions?: QuickActionItem[];
    featureCards?: FeatureCardItem[];
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotUIConfig = {
    greeting: {
        title: 'What would you like to do?',
        privacyBadges: [
            { text: 'Only you can access this chat', icon: 'lock' },
            { text: 'Your organization data is private', icon: 'shield' },
            { text: 'Available to your organization', icon: 'check' },
        ],
    },
    contextSelector: {
        enabled: false,
        placeholder: 'Ask about...',
        options: [
            { id: 'templates', label: 'Templates' },
            { id: 'inspections', label: 'Inspections' },
            { id: 'issues', label: 'Issues' },
            { id: 'actions', label: 'Actions' },
            { id: 'investigations', label: 'Investigations' },
            { id: 'documents', label: 'Documents' },
            { id: 'folders', label: 'Folders' },
            { id: 'content-libraries', label: 'Content Libraries' },
        ],
        defaultSelected: [],
    },
    suggestions: [
        {
            id: 'attention',
            text: 'What needs my attention?',
            prompt: 'What needs my attention?',
            icon: 'pin',
        },
        {
            id: 'last-inspection',
            text: 'Summarize my last inspection',
            prompt: 'Summarize my last inspection',
            icon: 'clipboard',
        },
        {
            id: 'incident',
            text: 'How do I report an incident?',
            prompt: 'How do I report an incident?',
            icon: 'message',
        },
    ],
    quickActions: [
        {
            id: 'catch-up',
            label: 'Catch me up',
            prompt: 'Catch me up on recent updates',
            icon: 'clock',
        },
        {
            id: 'create',
            label: 'Create',
            prompt: 'Help me create a new inspection checklist',
            icon: 'pencil',
        },
        {
            id: 'analyze',
            label: 'Analyze',
            prompt: 'Analyze recent inspection trends',
            icon: 'bolt',
        },
        {
            id: 'ask',
            label: 'Ask',
            prompt: 'Ask a question about Flowdit',
            icon: 'message',
        },
    ],
    featureCards: [
        {
            id: 'web-search',
            badge: 'Web search',
            icon: 'globe',
            title: 'Now it can look up things for you',
            description: 'Standards, regulations and supplier detail from the open web, with the source cited.',
            prompt: 'Look up industry standards and regulations',
        },
        {
            id: 'agents',
            badge: 'Agents',
            icon: 'settings',
            title: 'Build an assistant for the job you repeat',
            description: 'Custom agents that already know your sites, your rules and your reporting format.',
            prompt: 'Help me build a custom assistant agent',
        },
        {
            id: 'charts',
            badge: 'Charts',
            icon: 'chart',
            title: 'Ask for the numbers, get the chart',
            description: 'The assistant now builds the chart for you — ready to drop straight into a report.',
            prompt: 'Show me charts and statistics for recent inspections',
        },
        {
            id: 'slides',
            badge: 'Slides',
            icon: 'slides',
            title: 'Walk into the room with the deck done',
            description: "Turn the month's results into a presentation — one prompt, all your charts already in place.",
            prompt: 'Generate a presentation summary of monthly results',
        },
    ],
};
