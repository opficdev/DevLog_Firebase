import { HttpsError } from "firebase-functions/v2/https";

// REST 오류 응답에서 구분할 Apple 인증 사유를 HttpsError에 담습니다.
export function appleAuthError(
    code: "invalid-argument" | "unauthenticated" | "not-found" | "failed-precondition" | "internal",
    reason: string,
    message: string
): HttpsError {
    return new HttpsError(
        code,
        message,
        { reason }
    );
}
