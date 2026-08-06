import axios from "axios";
import * as logger from "firebase-functions/logger";
import { HttpsError } from "firebase-functions/v2/https";

const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Google grant token을 폐기하고 이미 무효화된 token은 성공으로 처리합니다.
export async function revokeGoogleOAuthToken(
    uid: string,
    token: string
): Promise<void> {
    try {
        const response = await axios.post(
            GOOGLE_REVOKE_URL,
            new URLSearchParams({ token }),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        );
        if (response.status === 200) {
            return;
        }
    } catch (error) {
        if (alreadyInvalidToken(error)) {
            logger.warn("Google OAuth token이 이미 무효화되어 성공으로 처리합니다.", {
                uid,
                google: errorMetadata(error)
            });
            return;
        }
        throw googleRevocationError(error);
    }

    throw googleRevocationError(new Error("Google OAuth token 폐기 응답이 올바르지 않습니다."));
}

// Google revoke endpoint 오류가 이미 무효화된 token을 의미하는지 확인합니다.
function alreadyInvalidToken(error: unknown): boolean {
    if (!axios.isAxiosError(error) || error.response?.status !== 400) {
        return false;
    }
    const data = error.response.data;
    return data &&
        typeof data === "object" &&
        (data as Record<string, unknown>).error === "invalid_token";
}

// Google grant 폐기 실패를 REST 계층에서 구분할 수 있는 오류로 변환합니다.
function googleRevocationError(error: unknown): HttpsError {
    logger.error("Google OAuth grant 폐기에 실패했습니다.", errorMetadata(error));
    return new HttpsError(
        "internal",
        "Google grant 폐기에 실패했습니다.",
        { reason: "google_revoke_failed" }
    );
}

// 외부 요청 오류에서 비밀값을 제외한 상태와 문구를 반환합니다.
function errorMetadata(error: unknown) {
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        const providerError = responseData && typeof responseData === "object" ?
            (responseData as Record<string, unknown>).error :
            undefined;
        return {
            status: error.response?.status,
            errorMessage: error.message,
            error: typeof providerError === "string" ? providerError : undefined
        };
    }
    if (error instanceof Error) {
        return { errorMessage: error.message };
    }
    return { errorMessage: "Unknown error" };
}
