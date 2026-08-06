import { HttpsError } from "firebase-functions/v2/https";

// reason에 대응하는 REST 오류 응답 정의를 나타냅니다.
interface RestErrorDefinition {
    // HTTP 응답 상태를 저장합니다.
    status: number;
    // 클라이언트가 구분할 오류 code를 저장합니다.
    code: string;
    // 원본 오류 message가 없을 때 사용할 기본 문구를 저장합니다.
    message: string;
}

// 정규화된 reason별 REST 오류 응답 정의를 저장합니다.
const restErrorByReason: Record<string, RestErrorDefinition> = {
    email_not_found: {
        status: 400,
        code: "email-not-found",
        message: "이메일을 찾을 수 없습니다."
    },
    email_mismatch: {
        status: 400,
        code: "email-mismatch",
        message: "이메일이 일치하지 않습니다."
    },
    github_email_changed_account_conflict: {
        status: 409,
        code: "github-email-changed-account-conflict",
        message: "GitHub provider가 다른 계정에 연결되어 있습니다."
    },
    github_revoke_failed: {
        status: 502,
        code: "github-revoke-failed",
        message: "GitHub grant 폐기에 실패했습니다."
    },
    github_provider_failed: {
        status: 502,
        code: "github-provider-failed",
        message: "GitHub 인증 서버 요청에 실패했습니다."
    },
    invalid_app_challenge: {
        status: 400,
        code: "invalid-app-challenge",
        message: "app challenge가 유효하지 않습니다."
    },
    invalid_oauth_session: {
        status: 400,
        code: "invalid-oauth-session",
        message: "OAuth session이 유효하지 않습니다."
    },
    expired_oauth_session: {
        status: 410,
        code: "expired-oauth-session",
        message: "OAuth session이 만료되었습니다."
    },
    consumed_oauth_session: {
        status: 409,
        code: "consumed-oauth-session",
        message: "OAuth session이 이미 처리되었습니다."
    },
    invalid_oauth_ticket: {
        status: 400,
        code: "invalid-oauth-ticket",
        message: "OAuth ticket이 유효하지 않습니다."
    },
    expired_oauth_ticket: {
        status: 410,
        code: "expired-oauth-ticket",
        message: "OAuth ticket이 만료되었습니다."
    },
    consumed_oauth_ticket: {
        status: 409,
        code: "consumed-oauth-ticket",
        message: "OAuth ticket이 이미 사용되었습니다."
    },
    mismatched_oauth_ticket: {
        status: 403,
        code: "mismatched-oauth-ticket",
        message: "OAuth ticket 결합 정보가 일치하지 않습니다."
    },
    invalid_app_verifier: {
        status: 401,
        code: "invalid-app-verifier",
        message: "app verifier가 유효하지 않습니다."
    },
    invalid_apple_challenge: {
        status: 400,
        code: "invalid-apple-challenge",
        message: "Apple 인증 challenge가 유효하지 않습니다."
    },
    expired_apple_challenge: {
        status: 410,
        code: "expired-apple-challenge",
        message: "Apple 인증 challenge가 만료되었습니다."
    },
    consumed_apple_challenge: {
        status: 409,
        code: "consumed-apple-challenge",
        message: "Apple 인증 challenge가 이미 사용되었습니다."
    },
    invalid_apple_proof: {
        status: 401,
        code: "invalid-apple-proof",
        message: "Apple 인증 증명이 유효하지 않습니다."
    },
    apple_provider_link_conflict: {
        status: 409,
        code: "apple-provider-link-conflict",
        message: "Apple provider가 다른 계정에 연결되어 있습니다."
    },
    last_provider: {
        status: 412,
        code: "last-provider",
        message: "마지막 로그인 provider는 해제할 수 없습니다."
    },
    apple_credential_not_found: {
        status: 404,
        code: "apple-credential-not-found",
        message: "Apple credential을 찾을 수 없습니다."
    },
    apple_revoke_failed: {
        status: 502,
        code: "apple-revoke-failed",
        message: "Apple grant 폐기에 실패했습니다."
    }
};

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
    const reasonError = restErrorForReason(reason, error);
    if (reasonError) {
        return reasonError;
    }

    if (error instanceof HttpsError) {
        return new RestError(statusCodeFor(error.code), error.code, error.message);
    }

    const authCode = authErrorCode(error);
    if (authCode) {
        return new RestError(401, authCode, messageFrom(error, "인증 토큰이 유효하지 않거나 만료되었습니다."));
    }

    return new RestError(500, "internal", messageFrom(error, "서버 오류가 발생했습니다."));
}

// reason을 정규화하고 대응하는 REST 오류로 변환합니다.
function restErrorForReason(
    reason: string | undefined,
    error: unknown
): RestError | undefined {
    const normalizedReason = reason?.replace(/-/g, "_");
    const matched = normalizedReason ? restErrorByReason[normalizedReason] : undefined;
    if (!matched) {
        return undefined;
    }

    return new RestError(
        matched.status,
        matched.code,
        messageFrom(error, matched.message)
    );
}

// REST 오류 응답으로 내려갈 JSON body를 구성합니다.
export function restErrorBodyFrom(error: unknown): { code: string; message: string } {
    const restError = restErrorFrom(error);
    return {
        code: restError.code,
        message: restError.message
    };
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
    case "failed-precondition":
        return 412;
    case "aborted":
        return 409;
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

function authErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
        return undefined;
    }

    const code = (error as Record<string, unknown>).code;
    if (
        typeof code === "string" &&
        [
            "auth/argument-error",
            "auth/id-token-expired",
            "auth/id-token-revoked",
            "auth/invalid-id-token",
            "auth/user-disabled",
            "auth/user-not-found"
        ].includes(code)
    ) {
        return code;
    }

    return undefined;
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
