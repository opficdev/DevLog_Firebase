import * as admin from "firebase-admin";
import { HttpsError } from "firebase-functions/v2/https";
import { verifyGoogleIdToken } from "../auth/googleIdToken";
import type { GoogleTokenPayload } from "../auth/googleIdToken";
import { requestGoogleOAuthTokenWithServerAuthCode } from "./googleClient";
import type { GoogleOAuthToken } from "./googleClient";
import type { GoogleConfiguration } from "./googleConfiguration";
import { saveGoogleCredential } from "./googleCredential";
import type { GoogleCredential } from "./googleCredential";
import {
    linkGoogleProvider,
    resolveGoogleFirebaseUID
} from "./googleProvider";

// iOS serverAuthCode를 검증해 Firebase custom token을 반환합니다.
export async function requestGoogleCustomToken(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    serverAuthCode: string
): Promise<{ customToken: string }> {
    const authentication = await authenticateGoogleAuthorizationCode(
        configuration,
        serverAuthCode
    );
    const uid = await resolveGoogleFirebaseUID(authentication.payload);
    await saveGoogleCredential(
        db,
        uid,
        authentication.credential
    );
    const customToken = await admin.auth().createCustomToken(uid);
    return { customToken };
}

// iOS serverAuthCode를 검증해 현재 Firebase 사용자에게 Google 계정을 연결합니다.
export async function linkGoogleAccount(
    db: FirebaseFirestore.Firestore,
    configuration: GoogleConfiguration,
    uid: string,
    serverAuthCode: string
): Promise<void> {
    const authentication = await authenticateGoogleAuthorizationCode(
        configuration,
        serverAuthCode
    );
    await linkGoogleProvider(
        uid,
        authentication.payload
    );
    await saveGoogleCredential(
        db,
        uid,
        authentication.credential
    );
}

// iOS serverAuthCode를 교환하고 ID token을 검증해 인증 자료를 반환합니다.
async function authenticateGoogleAuthorizationCode(
    configuration: GoogleConfiguration,
    serverAuthCode: string
) {
    const token = await requestGoogleOAuthTokenWithServerAuthCode(
        serverAuthCode,
        configuration.clientId,
        configuration.clientSecret
    );
    const payload = await verifiedGooglePayload(
        token.idToken,
        configuration.clientId
    );
    return {
        payload,
        credential: googleCredential(
            token,
            configuration.clientId
        )
    };
}

// Google ID token 검증 실패를 인증 증명 오류로 변환합니다.
async function verifiedGooglePayload(
    idToken: string,
    clientId: string
): Promise<GoogleTokenPayload> {
    try {
        return await verifyGoogleIdToken(
            idToken,
            clientId
        );
    } catch {
        throw invalidGoogleProofError();
    }
}

// Google OAuth token을 서버에 저장할 credential로 구성합니다.
function googleCredential(
    token: GoogleOAuthToken,
    clientId: string
): GoogleCredential {
    return {
        accessToken: token.accessToken,
        clientId,
        refreshToken: token.refreshToken
    };
}

// 유효하지 않은 Google 인증 증명을 인증 실패 오류로 구성합니다.
function invalidGoogleProofError(): HttpsError {
    return new HttpsError(
        "unauthenticated",
        "Google 인증 증명이 유효하지 않습니다.",
        { reason: "invalid_google_proof" }
    );
}
