import React from 'react';
const { useState, useEffect } = React;
import { useAuthenticatedFetch, useLabels } from '../../store/hooks';

export interface AuthenticatedImageProps {
    /**
     * The URL to fetch (requires authentication)
     */
    src: string;
    /**
     * Alt text for the image. Defaults to the label `imageAlt` ("Image").
     */
    alt?: string;
    /**
     * CSS class name
     */
    className?: string;
    /**
     * Click handler
     */
    onClick?: () => void;
    /**
     * Error handler when image fails to load
     */
    onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
    /**
     * Style object
     */
    style?: React.CSSProperties;
}

/**
 * Image component that fetches images using authenticated requests.
 * Uses the provider's credentials; outside a provider it falls back to the
 * plain URL, which an authenticated endpoint will refuse.
 */
export const AuthenticatedImage: React.FC<AuthenticatedImageProps> = ({
    src,
    alt,
    className,
    onClick,
    onError,
    style,
}) => {
    const fetchAuthenticatedUrl = useAuthenticatedFetch();
    const labels = useLabels();
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        let isMounted = true;

        const loadImage = async () => {
            setIsLoading(true);
            setHasError(false);
            setImageSrc(null);

            // No provider: the plain URL, which an authenticated endpoint will refuse.
            if (!fetchAuthenticatedUrl) {
                setImageSrc(src);
                setIsLoading(false);
                return;
            }

            try {
                const authenticatedUrl = await fetchAuthenticatedUrl(src);
                if (isMounted) {
                    setImageSrc(authenticatedUrl);
                    setIsLoading(false);
                }
            } catch (error) {
                console.error('Failed to load authenticated image:', error);
                if (isMounted) {
                    setHasError(true);
                    setIsLoading(false);
                }
            }
        };

        loadImage();

        return () => {
            isMounted = false;
        };
    }, [src, fetchAuthenticatedUrl]);

    const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
        setHasError(true);
        onError?.(e);
    };

    if (isLoading) {
        return (
            <div
                className={className}
                style={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                    background: 'var(--cb-surface-raised)',
                }}
            >
                <span style={{ fontSize: 11, color: 'var(--cb-text-tertiary)' }}>
                    {labels.loading}
                </span>
            </div>
        );
    }

    if (hasError || !imageSrc) {
        return (
            <div
                className={className}
                style={{
                    ...style,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: 60,
                    background: 'var(--cb-surface-raised)',
                }}
            >
                <span style={{ fontSize: 11, color: 'var(--cb-text-tertiary)' }}>
                    {labels.imageUnavailable}
                </span>
            </div>
        );
    }

    return (
        <img
            src={imageSrc}
            alt={alt ?? labels.imageAlt}
            className={className}
            onClick={onClick}
            onError={handleError}
            style={style}
        />
    );
};
