import { FieldValue } from "firebase-admin/firestore";
import { verifyAppleIdToken } from "../../auth/appleIdToken";
import type { AppleTokenPayload } from "../../auth/appleIdToken";
import { FirestorePath } from "../../common/firestorePath";
import {
    appleConfiguration,
    requestAppleTokensFromCode,
    revokeExchangedTokens
} from "./appleClient";
import type { AppleTokenResponse } from "./AppleTokenResponse";
import { appleAuthError } from "./error";

// challenge를 소비하고 Apple code 교환 응답의 ID token을 함께 검증합니다.
export async function requestAppleProofWithChallenge(
    db: FirebaseFirestore.Firestore,
    challengeId: string,
    authorizationCode: string
): Promise<{ payload: AppleTokenPayload; tokens: AppleTokenResponse }> {
    const expectedHashedNonce = await consumeAppleChallenge(
        db,
        challengeId
    );
    const tokens = await requestAppleTokensFromCode(authorizationCode);
    if (!tokens.id_token) {
        await revokeExchangedTokens(tokens);
        throw appleAuthError(
            "unauthenticated",
            "invalid_apple_proof",
            "Apple 교환 응답에 ID token이 없습니다."
        );
    }

    const { clientId } = appleConfiguration();
    let payload: AppleTokenPayload;
    try {
        payload = await verifiedApplePayload(
            tokens.id_token,
            clientId,
            expectedHashedNonce
        );
    } catch (error) {
        await revokeExchangedTokens(tokens);
        throw error;
    }
    return { payload, tokens };
}

// Apple ID token 검증 실패를 비밀값 없는 REST 오류로 변환합니다.
export async function verifiedApplePayload(
    idToken: string,
    clientId: string,
    expectedHashedNonce?: string
): Promise<AppleTokenPayload> {
    try {
        return await verifyAppleIdToken(
            idToken,
            clientId,
            expectedHashedNonce
        );
    } catch {
        throw appleAuthError(
            "unauthenticated",
            "invalid_apple_proof",
            "Apple ID token 검증에 실패했습니다."
        );
    }
}

// Firestore transaction으로 challenge의 상태를 확인하고 한 번만 소비합니다.
async function consumeAppleChallenge(
    db: FirebaseFirestore.Firestore,
    challengeId: string
): Promise<string> {
    const challengeRef = db.doc(FirestorePath.authChallenge(challengeId));
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(challengeRef);
        if (!snapshot.exists) {
            throw appleAuthError(
                "invalid-argument",
                "invalid_apple_challenge",
                "Apple 인증 challenge를 찾을 수 없습니다."
            );
        }

        const data = snapshot.data();
        const expectedHashedNonce = data?.expectedHashedNonce;
        const expiresAtMilliseconds = timestampMilliseconds(data?.expiresAt);
        if (
            typeof expectedHashedNonce !== "string" ||
            expiresAtMilliseconds === undefined
        ) {
            throw appleAuthError(
                "invalid-argument",
                "invalid_apple_challenge",
                "Apple 인증 challenge 형식이 올바르지 않습니다."
            );
        }

        if (data?.consumedAt) {
            throw appleAuthError(
                "failed-precondition",
                "consumed_apple_challenge",
                "Apple 인증 challenge가 이미 사용되었습니다."
            );
        }

        if (expiresAtMilliseconds <= Date.now()) {
            throw appleAuthError(
                "failed-precondition",
                "expired_apple_challenge",
                "Apple 인증 challenge가 만료되었습니다."
            );
        }

        transaction.update(challengeRef, {
            consumedAt: FieldValue.serverTimestamp()
        });
        return expectedHashedNonce;
    });
}

// Firestore Timestamp 계열 값을 epoch millisecond로 변환합니다.
function timestampMilliseconds(value: unknown): number | undefined {
    if (
        value &&
        typeof value === "object" &&
        "toMillis" in value &&
        typeof (value as { toMillis?: unknown }).toMillis === "function"
    ) {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    return undefined;
}
