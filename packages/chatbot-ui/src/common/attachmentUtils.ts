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
 * What the composer may attach, by type and by the extension that names it.
 * The storage API's upload route takes the same set
 * (`ALLOWED_UPLOAD_CONTENT_TYPES` in its `attachments/access.py`): add a type
 * to both, or the picker offers a file the server then refuses.
 */
const UPLOADABLE_EXTENSIONS: Readonly<Record<string, string>> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    pdf: 'application/pdf',
    txt: 'text/plain',
    csv: 'text/csv',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    xls: 'application/vnd.ms-excel',
};

export const UPLOADABLE_TYPES: readonly string[] = [...new Set(Object.values(UPLOADABLE_EXTENSIONS))];

/**
 * The file input's `accept`: the types and the extensions. A system with no
 * type registered for `.docx` or `.xlsx` would otherwise hide them in the picker.
 */
export const UPLOAD_ACCEPT = [
    ...UPLOADABLE_TYPES,
    ...Object.keys(UPLOADABLE_EXTENSIONS).map(extension => `.${extension}`),
].join(',');

/**
 * The type `file` is uploaded as, or `null` when it may not be attached: its
 * declared type when that is one we take, else the one its extension names.
 *
 * The declared type is the browser's system's name for the extension, and
 * systems disagree about Office files: none at all or
 * `application/octet-stream` where nothing is registered, and
 * `application/wps-office.xlsx` / `.docx` / `.xls` on Linux with WPS Office
 * installed. The file is sent, stored and served under the type returned
 * here, so one judged by its extension is never served as anything else.
 */
export function uploadableType(file: Pick<File, 'name' | 'type'>): string | null {
    const declared = file.type.split(';', 1)[0].trim().toLowerCase();
    if (UPLOADABLE_TYPES.includes(declared)) return declared;
    const dot = file.name.lastIndexOf('.');
    if (dot < 0) return null;
    return UPLOADABLE_EXTENSIONS[file.name.slice(dot + 1).toLowerCase()] ?? null;
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
