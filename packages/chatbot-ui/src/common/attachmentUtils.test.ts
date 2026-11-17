import { describe, expect, it } from 'vitest';
import { UPLOAD_ACCEPT, UPLOADABLE_TYPES, uploadableType } from './attachmentUtils';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XLS = 'application/vnd.ms-excel';

const file = (name: string, type = '') => ({ name, type });

describe('uploadableType', () => {
    it('takes Word and Excel files by their declared type', () => {
        expect(uploadableType(file('Audit plan.docx', DOCX))).toBe(DOCX);
        expect(uploadableType(file('Findings.xlsx', XLSX))).toBe(XLSX);
        expect(uploadableType(file('Legacy.xls', XLS))).toBe(XLS);
    });

    it('names an untyped or octet-stream file by its extension', () => {
        expect(uploadableType(file('Audit plan.docx'))).toBe(DOCX);
        expect(uploadableType(file('Findings.XLSX', 'application/octet-stream'))).toBe(XLSX);
        expect(uploadableType(file('rows.csv'))).toBe('text/csv');
    });

    it('names a file by its extension when its system calls it something else', () => {
        // Chrome on Linux with WPS Office installed.
        expect(uploadableType(file('Audit plan.docx', 'application/wps-office.docx'))).toBe(DOCX);
        expect(uploadableType(file('Findings.xlsx', 'application/wps-office.xlsx'))).toBe(XLSX);
        expect(uploadableType(file('Legacy.xls', 'application/wps-office.xls'))).toBe(XLS);
    });

    it('drops a declared type\'s parameters', () => {
        expect(uploadableType(file('notes.txt', 'text/plain; charset=utf-8'))).toBe('text/plain');
    });

    it('refuses what the storage API refuses', () => {
        expect(uploadableType(file('old.doc', 'application/msword'))).toBeNull();
        expect(uploadableType(file('page.html', 'text/html'))).toBeNull();
        expect(uploadableType(file('archive.zip'))).toBeNull();
        expect(uploadableType(file('no_extension'))).toBeNull();
        expect(uploadableType(file('report.docm', 'application/wps-office.docx'))).toBeNull();
    });
});

describe('UPLOAD_ACCEPT', () => {
    it('offers each type and its extension in the picker', () => {
        const accepted = UPLOAD_ACCEPT.split(',');
        expect(accepted).toEqual(expect.arrayContaining([DOCX, XLSX, XLS, '.docx', '.xlsx', '.xls']));
        expect(accepted).toEqual(expect.arrayContaining([...UPLOADABLE_TYPES]));
    });
});
