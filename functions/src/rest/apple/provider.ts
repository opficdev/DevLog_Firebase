import * as admin from "firebase-admin";
import type { UserProvider } from "firebase-admin/auth";
import {
    isAppleEmailVerified
} from "../../auth/appleIdToken";
import type { AppleTokenPayload } from "../../auth/appleIdToken";
import {
    requiredAppleRefreshToken,
    revokeExchangedTokens
} from "./appleClient";
import { requestAppleProofWithChallenge } from "./challenge";
import { saveAppleCredential } from "./credential";
import { appleAuthError } from "./error";
import type { FirebaseAuthClient } from "./FirebaseAuthClient";
import type { FirebaseAuthUser } from "./FirebaseAuthUser";
import { revokeAppleAccessTokenWithDatabase } from "./token";

const APPLE_PROVIDER_ID = "apple.com";

// challenge로 증명된 Apple provider를 현재 Firebase Auth 사용자에 연결합니다.
export async function linkAppleProviderWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string,
    challengeId: string,
    authorizationCode: string,
    credentialEmail?: string
): Promise<{ success: true }> {
    const proof = await requestAppleProofWithChallenge(
        db,
        challengeId,
        authorizationCode
    );
    const refreshToken = await requiredAppleRefreshToken(proof.tokens);
    const auth = admin.auth();
    let user: FirebaseAuthUser;
    let ownerUID: string | undefined;
    try {
        user = await auth.getUser(uid);
        ownerUID = await appleProviderOwnerUID(
            auth,
            proof.payload.sub
        );
    } catch (error) {
        await revokeExchangedTokens(proof.tokens);
        throw error;
    }

    const appleEmail = verifiedAppleEmail(proof.payload) ?? credentialEmail;
    if (!user.email || !appleEmail) {
        await revokeExchangedTokens(proof.tokens);
        throw appleAuthError(
            "invalid-argument",
            "email_not_found",
            "이메일을 찾을 수 없습니다."
        );
    }

    if (user.email.toLowerCase() !== appleEmail.toLowerCase()) {
        await revokeExchangedTokens(proof.tokens);
        throw appleAuthError(
            "invalid-argument",
            "email_mismatch",
            "이메일이 일치하지 않습니다."
        );
    }

    const currentProvider = user.providerData?.find((provider) =>
        provider.providerId === APPLE_PROVIDER_ID
    );
    if (currentProvider && currentProvider.uid !== proof.payload.sub) {
        await revokeExchangedTokens(proof.tokens);
        throw appleAuthError(
            "failed-precondition",
            "apple_provider_link_conflict",
            "Apple provider가 다른 계정에 연결되어 있습니다."
        );
    }

    if (ownerUID && ownerUID !== uid) {
        await revokeExchangedTokens(proof.tokens);
        throw appleAuthError(
            "failed-precondition",
            "apple_provider_link_conflict",
            "Apple provider가 다른 계정에 연결되어 있습니다."
        );
    }

    try {
        await ensureAppleProvider(
            auth,
            uid,
            proof.payload
        );
        await saveAppleCredential(
            db,
            uid,
            refreshToken
        );
    } catch (error) {
        await revokeExchangedTokens(proof.tokens);
        throw error;
    }

    return { success: true };
}

// Apple grant와 credential을 정리한 뒤 현재 사용자의 Apple provider를 해제합니다.
export async function unlinkAppleProviderWithDatabase(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<{ success: true }> {
    const auth = admin.auth();
    const user = await auth.getUser(uid);
    const providers = user.providerData ?? [];
    const hasAppleProvider = providers.some((provider) =>
        provider.providerId === APPLE_PROVIDER_ID
    );

    if (!hasAppleProvider) {
        await revokeAppleAccessTokenWithDatabase(
            db,
            uid
        );
        return { success: true };
    }

    if (providers.length <= 1) {
        throw appleAuthError(
            "failed-precondition",
            "last_provider",
            "마지막 로그인 provider는 해제할 수 없습니다."
        );
    }

    await revokeAppleAccessTokenWithDatabase(
        db,
        uid
    );
    await auth.updateUser(uid, {
        providersToUnlink: [APPLE_PROVIDER_ID]
    });

    return { success: true };
}

// 검증된 Apple 이메일로 기존 provider 또는 Firebase uid를 결정합니다.
export async function resolveAppleFirebaseUID(
    auth: FirebaseAuthClient,
    payload: AppleTokenPayload
): Promise<string> {
    const ownerUID = await appleProviderOwnerUID(
        auth,
        payload.sub
    );
    if (ownerUID) {
        return ownerUID;
    }

    const appleEmail = verifiedAppleEmail(payload);
    if (!appleEmail) {
        throw appleAuthError(
            "invalid-argument",
            "email_not_found",
            "이메일을 찾을 수 없습니다."
        );
    }

    try {
        return (await auth.getUserByEmail(appleEmail)).uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
    }

    try {
        return (await auth.createUser({
            email: appleEmail,
            emailVerified: true
        })).uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) === "auth/email-already-exists") {
            return (await auth.getUserByEmail(appleEmail)).uid;
        }
        throw error;
    }
}

// 선택된 Firebase 사용자에 Apple provider가 없을 때 연결합니다.
export async function ensureAppleProvider(
    auth: FirebaseAuthClient,
    uid: string,
    payload: AppleTokenPayload
): Promise<void> {
    const ownerUID = await appleProviderOwnerUID(
        auth,
        payload.sub
    );
    if (ownerUID === uid) {
        return;
    }
    if (ownerUID) {
        throw appleAuthError(
            "failed-precondition",
            "apple_provider_link_conflict",
            "Apple provider가 다른 계정에 연결되어 있습니다."
        );
    }

    try {
        await auth.updateUser(uid, {
            providerToLink: appleProviderForPayload(payload)
        });
    } catch (error) {
        const ownerUIDAfterFailure = await appleProviderOwnerUID(
            auth,
            payload.sub
        );
        if (ownerUIDAfterFailure === uid) {
            return;
        }
        if (ownerUIDAfterFailure) {
            throw appleAuthError(
                "failed-precondition",
                "apple_provider_link_conflict",
                "Apple provider가 다른 계정에 연결되어 있습니다."
            );
        }
        throw error;
    }
}

// Apple subject를 소유한 Firebase Auth uid를 반환합니다.
async function appleProviderOwnerUID(
    auth: FirebaseAuthClient,
    subject: string
): Promise<string | undefined> {
    try {
        return (await auth.getUserByProviderUid(
            APPLE_PROVIDER_ID,
            subject
        )).uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
        return undefined;
    }
}

// Apple ID token payload를 Firebase Auth provider 연결 형식으로 변환합니다.
function appleProviderForPayload(payload: AppleTokenPayload): UserProvider {
    return {
        providerId: APPLE_PROVIDER_ID,
        uid: payload.sub,
        email: payload.email
    };
}

// 검증된 Apple 이메일 claim이 있을 때만 이메일을 반환합니다.
function verifiedAppleEmail(payload: AppleTokenPayload): string | undefined {
    return isAppleEmailVerified(payload) ? payload.email : undefined;
}

// Firebase Auth 예외에서 오류 코드를 추출합니다.
function firebaseAuthErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
        return undefined;
    }

    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
}
