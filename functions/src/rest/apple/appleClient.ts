import axios from "axios";
import { HttpsError } from "firebase-functions/v2/https";
import * as jwt from "jsonwebtoken";
import type { AppleConfiguration } from "./AppleConfiguration";
import type { AppleTokenResponse } from "./AppleTokenResponse";
import { appleAuthError } from "./error";

const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

// Apple authorization code를 서버에서 token 응답으로 교환합니다.
export async function requestAppleTokensFromCode(
    authorizationCode: string
): Promise<AppleTokenResponse> {
    const { clientId } = appleConfiguration();
    const clientSecret = createAppleClientSecret();
    try {
        const response = await axios.post<AppleTokenResponse>(
            APPLE_TOKEN_URL,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code: authorizationCode,
                grant_type: "authorization_code"
            }).toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );
        return response.data;
    } catch {
        throw appleAuthError(
            "unauthenticated",
            "invalid_apple_proof",
            "Apple authorization code 교환에 실패했습니다."
        );
    }
}

// Apple refresh token을 access token으로 교환합니다.
export async function requestAppleAccessToken(
    refreshToken: string
): Promise<string> {
    const { clientId } = appleConfiguration();
    const clientSecret = createAppleClientSecret();
    try {
        const response = await axios.post<AppleTokenResponse>(
            APPLE_TOKEN_URL,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                grant_type: "refresh_token",
                refresh_token: refreshToken
            }).toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );
        const accessToken = response.data.access_token;
        if (accessToken) {
            return accessToken;
        }
    } catch (error) {
        if (appleErrorCode(error) === "invalid_grant") {
            throw new HttpsError(
                "unauthenticated",
                "Apple refresh token이 만료되었거나 유효하지 않습니다."
            );
        }
        throw new HttpsError("internal", "Apple access token 발급에 실패했습니다.");
    }

    throw new HttpsError("internal", "Apple 응답에 access token이 없습니다.");
}

// code 교환 응답의 credential을 보상 폐기하고 실패를 구분 가능한 오류로 전달합니다.
export async function revokeExchangedTokens(
    tokens: AppleTokenResponse
): Promise<void> {
    const token = tokens.refresh_token ?? tokens.access_token;
    if (!token) {
        return;
    }

    await revokeAppleGrant(
        token,
        tokens.refresh_token ? "refresh_token" : "access_token"
    );
}

// Apple code 교환 응답에서 필수 refresh token을 반환합니다.
export async function requiredAppleRefreshToken(
    tokens: AppleTokenResponse
): Promise<string> {
    if (!tokens.refresh_token) {
        await revokeExchangedTokens(tokens);
        throw appleAuthError(
            "not-found",
            "apple_credential_not_found",
            "Apple 교환 응답에 refresh token이 없습니다."
        );
    }
    return tokens.refresh_token;
}

// Apple grant를 폐기하고 이미 무효화된 상태는 완료로 처리합니다.
export async function revokeAppleGrant(
    token: string,
    tokenTypeHint: "access_token" | "refresh_token"
): Promise<void> {
    const { clientId } = appleConfiguration();
    const clientSecret = createAppleClientSecret();
    try {
        await axios.post(
            APPLE_REVOKE_URL,
            new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                token,
                token_type_hint: tokenTypeHint
            }).toString(),
            {
                headers: { "Content-Type": "application/x-www-form-urlencoded" }
            }
        );
    } catch (error) {
        if (isAppleGrantAlreadyRevoked(error)) {
            return;
        }
        throw appleAuthError(
            "internal",
            "apple_revoke_failed",
            "Apple grant 폐기에 실패했습니다."
        );
    }
}

// 필수 Apple OAuth 환경 설정을 검증해 반환합니다.
export function appleConfiguration(): AppleConfiguration {
    const teamId = process.env.APPLE_TEAM_ID;
    const clientId = process.env.APPLE_CLIENT_ID;
    const keyId = process.env.APPLE_KEY_ID;
    const privateKey = (process.env.APPLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const configs = {
        APPLE_TEAM_ID: teamId,
        APPLE_CLIENT_ID: clientId,
        APPLE_KEY_ID: keyId,
        APPLE_PRIVATE_KEY: privateKey
    };
    const missingKeys = Object.entries(configs)
        .filter(([, value]) => !value)
        .map(([key]) => key);

    if (0 < missingKeys.length) {
        console.error("Apple 설정이 누락되었습니다.", { missingKeys });
        throw new HttpsError(
            "internal",
            `Apple 설정이 누락되었습니다: ${missingKeys.join(", ")}`
        );
    }

    return {
        teamId: teamId!,
        clientId: clientId!,
        keyId: keyId!,
        privateKey: privateKey!
    };
}

// Apple API 오류가 이미 무효화된 grant를 나타내는지 확인합니다.
function isAppleGrantAlreadyRevoked(error: unknown): boolean {
    const code = appleErrorCode(error);
    return code === "invalid_grant" || code === "invalid_token";
}

// Apple API 오류 응답에서 구분 코드를 추출합니다.
function appleErrorCode(error: unknown): string | undefined {
    if (!axios.isAxiosError(error)) {
        return undefined;
    }

    const data = error.response?.data;
    if (!data || typeof data !== "object") {
        return undefined;
    }

    const code = (data as Record<string, unknown>).error;
    return typeof code === "string" ? code : undefined;
}

// Apple client secret JWT를 생성합니다.
function createAppleClientSecret(): string {
    const {
        teamId,
        clientId,
        keyId,
        privateKey
    } = appleConfiguration();
    return jwt.sign({}, privateKey, {
        algorithm: "ES256",
        expiresIn: "5m",
        audience: "https://appleid.apple.com",
        issuer: teamId,
        subject: clientId,
        keyid: keyId
    });
}
