import {
    requestAppleAccessToken,
    requestAppleTokensFromCode,
    requiredAppleRefreshToken,
    revokeAppleGrant,
    revokeExchangedTokens
} from "./appleClient";
import {
    appleCredentialForUser,
    deleteAppleCredential,
    saveAppleCredential
} from "./credential";
import { appleAuthError } from "./error";

// 이전 iOS 요청 형식의 authorization code 교환과 refresh token 응답을 유지합니다.
export async function requestAppleRefreshTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string,
    authorizationCode: string
): Promise<{ success: true; refreshToken: string }> {
    const tokens = await requestAppleTokensFromCode(authorizationCode);
    const refreshToken = await requiredAppleRefreshToken(tokens);

    try {
        await saveAppleCredential(
            db,
            uid,
            refreshToken
        );
    } catch (error) {
        await revokeExchangedTokens(tokens);
        throw error;
    }
    return {
        success: true,
        refreshToken
    };
}

// 이전 iOS 요청 형식에서 저장된 credential로 Apple access token을 발급합니다.
export async function refreshAppleAccessTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<{ token: string }> {
    const refreshToken = await appleCredentialForUser(
        db,
        uid
    );
    if (!refreshToken) {
        throw appleAuthError(
            "not-found",
            "apple_credential_not_found",
            "Apple credential을 찾을 수 없습니다."
        );
    }

    return {
        token: await requestAppleAccessToken(refreshToken)
    };
}

// 저장된 Apple credential을 폐기하고 credential 자료만 삭제합니다.
export async function revokeAppleAccessTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string,
    legacyAccessToken?: unknown
): Promise<{ success: true }> {
    const refreshToken = await appleCredentialForUser(
        db,
        uid
    );
    const requestedAccessToken = typeof legacyAccessToken === "string" ?
        legacyAccessToken.trim() :
        "";
    const token = refreshToken || requestedAccessToken;

    if (!token) {
        return { success: true };
    }

    await revokeAppleGrant(
        token,
        refreshToken ? "refresh_token" : "access_token"
    );
    if (refreshToken) {
        await deleteAppleCredential(
            db,
            uid
        );
    }

    return { success: true };
}
