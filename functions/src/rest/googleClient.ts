import axios from "axios";
import { HttpsError } from "firebase-functions/v2/https";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// Google authorization code 교환 응답을 나타냅니다.
interface GoogleOAuthResponse {
    // 발급된 사용자 access token을 저장합니다.
    access_token?: string;
    // 검증할 OpenID Connect ID token을 저장합니다.
    id_token?: string;
    // 장기 grant 폐기에 사용할 refresh token을 저장합니다.
    refresh_token?: string;
    // access token 만료 시간 간격을 저장합니다.
    expires_in?: number;
    // 승인된 OAuth scope를 저장합니다.
    scope?: string;
    // 발급 token 종류를 저장합니다.
    token_type?: string;
}

// 서버가 Google 인증 처리에 사용할 token 묶음을 나타냅니다.
export interface GoogleOAuthToken {
    // Google API 요청과 grant 폐기에 사용할 access token을 저장합니다.
    accessToken: string;
    // 사용자 식별과 프로필 검증에 사용할 ID token을 저장합니다.
    idToken: string;
    // 장기 grant 폐기에 사용할 선택적인 refresh token을 저장합니다.
    refreshToken?: string;
}

// iOS serverAuthCode를 callback과 PKCE 값 없이 서버 전용 token 묶음으로 교환합니다.
export async function requestGoogleOAuthToken(
    serverAuthCode: string,
    clientId: string,
    clientSecret: string
): Promise<GoogleOAuthToken> {
    const requestBody = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code: serverAuthCode,
        redirect_uri: "",
        grant_type: "authorization_code"
    });
    const response = await requestGoogleAPI(() =>
        axios.post<GoogleOAuthResponse>(
            GOOGLE_TOKEN_URL,
            requestBody,
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                }
            }
        )
    );
    const accessToken = response.data.access_token;
    const idToken = response.data.id_token;
    if (!accessToken || !idToken) {
        throw googleProviderError();
    }

    return {
        accessToken,
        idToken,
        refreshToken: response.data.refresh_token
    };
}

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
            console.warn("Google OAuth token이 이미 무효화되어 성공으로 처리합니다.", {
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

// iOS serverAuthCode 교환 실패를 인증 증명 오류와 provider 오류로 구분합니다.
async function requestGoogleAPI<T>(
    request: () => Promise<T>
): Promise<T> {
    try {
        return await request();
    } catch (error) {
        if (invalidGoogleGrant(error)) {
            throw googleInvalidProofError();
        }
        console.error("Google 인증 서버 요청에 실패했습니다.", errorMetadata(error));
        throw googleProviderError();
    }
}

// Google token endpoint 오류가 유효하지 않은 authorization code를 의미하는지 확인합니다.
function invalidGoogleGrant(error: unknown): boolean {
    if (!axios.isAxiosError(error)) {
        return false;
    }
    const data = error.response?.data;
    return data &&
        typeof data === "object" &&
        (data as Record<string, unknown>).error === "invalid_grant";
}

// Google 인증 서버 실패를 REST 계층에서 구분할 수 있는 오류로 구성합니다.
function googleProviderError(): HttpsError {
    return new HttpsError(
        "internal",
        "Google 인증 서버 요청에 실패했습니다.",
        { reason: "google_provider_failed" }
    );
}

// 유효하지 않은 Google 인증 증명을 인증 실패 오류로 구성합니다.
function googleInvalidProofError(): HttpsError {
    return new HttpsError(
        "unauthenticated",
        "Google 인증 증명이 유효하지 않습니다.",
        { reason: "invalid_google_proof" }
    );
}

// Google grant 폐기 실패를 REST 계층에서 구분할 수 있는 오류로 변환합니다.
function googleRevocationError(error: unknown): HttpsError {
    console.error("Google OAuth grant 폐기에 실패했습니다.", errorMetadata(error));
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
            message: error.message,
            error: typeof providerError === "string" ? providerError : undefined
        };
    }
    if (error instanceof Error) {
        return { message: error.message };
    }
    return { message: "Unknown error" };
}
