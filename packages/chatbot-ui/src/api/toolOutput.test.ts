import { describe, expect, it } from 'vitest';
import { settledToolStatus } from './toolOutput';
import { describeStreamError } from '../hooks/useStreamChat';

/**
 * A completed call whose body is an error is shown as a failure, and the
 * platform's "an administrator must act" errors are not followed by "try again".
 */
describe('settledToolStatus', () => {
    it('keeps the reported status of an ordinary result', () => {
        expect(settledToolStatus('completed', '{"title":"Fire doors","items":[]}')).toBe('completed');
        expect(settledToolStatus('completed', 'plain text findings')).toBe('completed');
        expect(settledToolStatus('running', undefined)).toBe('running');
        expect(settledToolStatus('failed', undefined)).toBe('failed');
        expect(settledToolStatus('timeout', undefined)).toBe('failed');
    });

    it('shows a completed call whose body is an error as failed', () => {
        // What a checklist generator returned on each token-limit failure.
        const body = JSON.stringify({ error: "LLMOutputTruncatedError: completion hit the token limit" });
        expect(settledToolStatus('completed', body)).toBe('failed');
        expect(settledToolStatus('completed', { success: false, error: 'Missing step_uuid' })).toBe('failed');
    });

    it('does not count an empty error field', () => {
        expect(settledToolStatus('completed', { error: null, items: [] })).toBe('completed');
        expect(settledToolStatus('completed', [{ error: 'inside a list is data' }])).toBe('completed');
    });
});

describe('describeStreamError', () => {
    it('does not tell the user to retry what an administrator has to fix', () => {
        const message = 'The AI service has reached a usage limit. If this continues, contact your administrator.';
        expect(describeStreamError(new Error(message))).toBe(message);
        const tooLong = 'This conversation has grown too long for the AI model. Start a new conversation to continue.';
        expect(describeStreamError(new Error(tooLong))).toBe(tooLong);
    });

    it('still suggests a retry for a passing failure', () => {
        expect(describeStreamError(new Error('The AI service is busy right now.')))
            .toBe('The AI service is busy right now.\n\nPlease try again.');
    });
});
