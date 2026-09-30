import React from 'react';
import './ConversationDrawer.css';
import { ConversationSummary } from '../../api/types';
import { ConversationSidebar } from '../ConversationSidebar/ConversationSidebar';

export interface ConversationDrawerProps {
    conversations?: ConversationSummary[];
    onSelect?: (id: string) => void;
    onNewChat?: () => void;
    onClose?: () => void;
    activeConversationId?: string | null;
    isLoading?: boolean;
    hasMore?: boolean;
    isLoadingMore?: boolean;
    onLoadMore?: () => void;
    onDeleteConversation?: (id: string) => void;
}

export const ConversationDrawer: React.FC<ConversationDrawerProps> = (props) => {
    return <ConversationSidebar {...props} />;
};
