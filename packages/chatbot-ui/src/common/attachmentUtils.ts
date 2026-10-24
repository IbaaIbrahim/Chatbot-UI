/**
 * Utilities for attachment URL resolution and response parsing.
 */
import { labelledError } from './i18n';

/**
 * Resolves the upload URL for attachments.
 * If storageApiUrl already ends with /api/v1/attachments, appends /upload.
 * If storageApiUrl already ends with /upload, returns as is.
 * Otherwise appends /api/v1/attachments/upload.
 */
export function resolveStorageUploadUrl(storageApiUrl?: string): string {
    if (!storageApiUrl) return '';
    const clean = storageApiUrl.trim().replace(/\/+$/, '');
    if (clean.endsWith('/api/v1/attachments')) {
        return `${clean}/upload`;
    }
    if (clean.endsWith('/upload')) {
        return clean;
    }
    return `${clean}/api/v1/attachments/upload`;
}

/**
 * The storage API's attachments root (`…/api/v1/attachments`), from whichever
 * form the host configured: the service's base URL, the attachments root
 * itself, or the upload URL. Empty without a URL.
 */
export function resolveStorageAttachmentsBase(storageApiUrl?: string): string {
    if (!storageApiUrl) return '';
    let clean = storageApiUrl.trim().replace(/\/+$/, '');
    if (clean.endsWith('/api/v1/attachments/upload')) clean = clean.slice(0, -'/upload'.length);
    if (clean.endsWith('/api/v1/attachments')) return clean;
    return `${clean}/api/v1/attachments`;
}

/**
 * Resolves the server file download URL for a completed attachment.
 */
export function resolveStorageAttachmentFileUrl(
    storageApiUrl: string,
    jobUuid: string,
    attachmentUuid: string
): string {
    const clean = storageApiUrl.trim().replace(/\/+$/, '');
    if (clean.endsWith('/api/v1/attachments')) {
        return `${clean}/jobs/${jobUuid}/files/${attachmentUuid}`;
    }
    return `${clean}/api/v1/attachments/jobs/${jobUuid}/files/${attachmentUuid}`;
}

/**
 * Safely extracts file_id and metadata from various backend upload response shapes.
 */
export function parseUploadedFileResponse(responseJson: any, originalFile: File): {
    file_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    url?: string;
} {
    const fileObj =
        responseJson?.data?.file ||
        responseJson?.data ||
        responseJson?.file ||
        responseJson;

    const fileId =
        fileObj?.file_id ||
        fileObj?.id ||
        fileObj?.uuid ||
        responseJson?.file_id ||
        responseJson?.id;

    if (!fileId) {
        throw labelledError('uploadMissingFileId', 'Upload succeeded but server response is missing a valid file_id');
    }

    return {
        file_id: String(fileId),
        filename: fileObj?.filename || fileObj?.name || originalFile.name,
        content_type: fileObj?.content_type || fileObj?.contentType || originalFile.type,
        size_bytes: fileObj?.size_bytes ?? fileObj?.size ?? originalFile.size,
        url: fileObj?.url || responseJson?.url,
    };
}
