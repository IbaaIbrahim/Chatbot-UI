/**
 * Client for the Auth Broker service.
 *
 * The broker performs the partner→tenant→user credential chain server-side and
 * returns a single user session. Auth is application-based: the host app drives
 * this client and passes the resulting token to the chat UI; the library never
 * assumes a particular auth mechanism.
 */

import { netFetch } from '../common/localNetwork';

const DEFAULT_BROKER_URL = import.meta.env.VITE_AUTH_BROKER_URL || "";

/** A user session as returned by register / login / refresh. */
export interface Session {
    access_token: string;
    token_type: string;
    expires_at: string;
    user_uuid: string;
    name: string;
    email: string;
    persona: string | null;
    /** True when the user still needs to complete the persona survey. */
    persona_required: boolean;
}

/** One persona survey question. */
export interface PersonaQuestion {
    key: string;
    question: string;
    type: string;
    options: string[];
    allow_other: boolean;
}

/** Backwards-compatible alias kept for existing imports. */
export type TokenResponse = Session;

export interface RegisterPayload {
    name: string;
    email: string;
    password: string;
    tenant_uuid?: string;
}

export interface LoginPayload {
    email: string;
    password: string;
    tenant_uuid?: string;
}

export class AuthClient {
    private static brokerUrl: string = DEFAULT_BROKER_URL;

    /** Configure the broker base URL. Call before any other method. */
    static configure(brokerUrl: string) {
        this.brokerUrl = brokerUrl.replace(/\/+$/, "");
    }

    private static async post<T>(path: string, body: unknown): Promise<T> {
        const response = await netFetch(`${this.brokerUrl}/api/v1${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            let message = `${response.status}`;
            try {
                const error = await response.json();
                message = error?.message || error?.detail || message;
            } catch {
                /* non-JSON error body */
            }
            throw new Error(message);
        }
        return response.json() as Promise<T>;
    }

    /** Register a new user and return the issued session. */
    static register(payload: RegisterPayload): Promise<Session> {
        return this.post<Session>("/register", payload);
    }

    /** Authenticate an existing user and return the issued session. */
    static login(payload: LoginPayload): Promise<Session> {
        return this.post<Session>("/login", payload);
    }

    /** Exchange a previous (possibly expired) token for a fresh session. */
    static refresh(previousToken: string, tenantUuid?: string): Promise<Session> {
        return this.post<Session>("/refresh", {
            access_token: previousToken,
            tenant_uuid: tenantUuid,
        });
    }

    /** Fetch the persona onboarding survey. */
    static async getPersonaQuestions(): Promise<PersonaQuestion[]> {
        const response = await netFetch(`${this.brokerUrl}/api/v1/persona/questions`);
        if (!response.ok) {
            throw new Error(`Failed to load persona questions: ${response.status}`);
        }
        const data = await response.json();
        return data.questions as PersonaQuestion[];
    }

    /** Submit persona answers (keyed by question key) for a user. */
    static submitPersona(
        userUuid: string,
        answers: Record<string, string>,
        tenantUuid?: string,
    ): Promise<{ persona: string; result: string }> {
        return this.post("/persona", {
            user_uuid: userUuid,
            answers,
            tenant_uuid: tenantUuid,
        });
    }
}
