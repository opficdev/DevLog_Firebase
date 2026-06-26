import { HttpsError } from "firebase-functions/v2/https";

export class RestError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string
    ) {
        super(message);
    }
}

export function restErrorFrom(error: unknown): RestError {
    if (error instanceof RestError) {
        return error;
    }

    const reason = errorReason(error);
    if (reason === "email_not_found" || reason === "email-not-found") {
        return new RestError(400, "email-not-found", messageFrom(error, "이메일을 찾을 수 없습니다."));
    }

    if (reason === "email_mismatch" || reason === "email-mismatch") {
        return new RestError(400, "email-mismatch", messageFrom(error, "이메일이 일치하지 않습니다."));
    }

    if (error instanceof HttpsError) {
        return new RestError(statusCodeFor(error.code), error.code, error.message);
    }

    return new RestError(500, "internal", messageFrom(error, "서버 오류가 발생했습니다."));
}

function statusCodeFor(code: string): number {
    switch (code) {
    case "invalid-argument":
        return 400;
    case "unauthenticated":
        return 401;
    case "permission-denied":
        return 403;
    case "not-found":
        return 404;
    default:
        return 500;
    }
}

function messageFrom(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return fallback;
}

function errorReason(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
        return undefined;
    }

    const record = error as Record<string, unknown>;
    const details = record.details;
    if (details && typeof details === "object") {
        const reason = (details as Record<string, unknown>).reason;
        if (typeof reason === "string") {
            return reason;
        }
    }

    const reason = record.reason;
    if (typeof reason === "string") {
        return reason;
    }

    const nestedError = record.error;
    if (nestedError && typeof nestedError === "object") {
        const nestedReason = (nestedError as Record<string, unknown>).reason;
        if (typeof nestedReason === "string") {
            return nestedReason;
        }
    }

    return undefined;
}
