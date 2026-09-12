import React from 'react';
import './ThinkingIndicator.css';

export const ThinkingIndicator: React.FC = () => {
    return (
        <div className="cb-thinking-container">
            <span className="cb-thinking-text">Working</span>
            <div className="cb-thinking-dots">
                <div className="cb-dot"></div>
                <div className="cb-dot"></div>
                <div className="cb-dot"></div>
            </div>
        </div>
    );
};
