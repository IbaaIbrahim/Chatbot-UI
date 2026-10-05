import React from 'react';
import './ThinkingIndicator.css';

export interface ThinkingIndicatorProps {
    className?: string;
    size?: number;
    color?: string;
}

export const ThinkingIndicator: React.FC<ThinkingIndicatorProps> = ({
    className = '',
    size = 20,
    color,
}) => {
    return (
        <div className={`cb-thinking-container ${className}`} role="status" aria-label="Thinking">
            <div
                className="cb-claude-indicator"
                style={{
                    width: size,
                    height: size,
                    ...(color ? { ['--cb-thinking-indicator-color' as any]: color } : {}),
                }}
            >
                <div className="cb-claude-blob" />
            </div>
        </div>
    );
};
