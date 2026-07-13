import * as admin from "firebase-admin";
import type {
    UpdateRequest,
    UserProvider
} from "firebase-admin/auth";
import { HttpsError } from "firebase-functions/v2/https";
import type { GoogleTokenPayload } from "../auth/googleIdToken";

const PROVIDER_ID = "google.com";

// 검증된 Google provider uid를 우선해 Firebase uid를 결정합니다.
export async function resolveGoogleFirebaseUID(
    payload: GoogleTokenPayload
): Promise<string> {
    return await firebaseUIDForGoogleProvider(payload) ??
        firebaseUIDForUnlinkedGoogleProvider(payload);
}

// 검증된 Google provider를 현재 Firebase 사용자에 연결합니다.
export async function linkGoogleProvider(
    uid: string,
    payload: GoogleTokenPayload
): Promise<void> {
    const currentUser = await admin.auth().getUser(uid);
    try {
        const providerUser = await admin.auth().getUserByProviderUid(
            PROVIDER_ID,
            payload.sub
        );
        if (providerUser.uid !== uid) {
            throw googleProviderLinkConflictError();
        }
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
    }

    const email = requiredVerifiedEmail(payload);
    if (currentUser.email !== email) {
        throw new HttpsError(
            "invalid-argument",
            "이메일이 일치하지 않습니다.",
            { reason: "email_mismatch" }
        );
    }

    const providerToLink = googleProviderForPayload(payload, email);
    await admin.auth().updateUser(uid, { providerToLink });
}

// 기존 Google provider가 소유한 Firebase uid와 최신 프로필을 반환합니다.
async function firebaseUIDForGoogleProvider(
    payload: GoogleTokenPayload
): Promise<string | undefined> {
    try {
        const userRecord = await admin.auth().getUserByProviderUid(
            PROVIDER_ID,
            payload.sub
        );
        const update = googleProfileUpdate(payload);
        const googleOnly = userRecord.providerData.every((provider) =>
            provider.providerId === PROVIDER_ID
        );
        const email = verifiedGoogleEmail(payload);
        if (googleOnly && email && await emailCanBeAssigned(email, userRecord.uid)) {
            update.email = email;
        }
        await admin.auth().updateUser(userRecord.uid, update);
        return userRecord.uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
        return undefined;
    }
}

// 미연결 Google provider를 검증된 이메일의 기존 사용자 또는 신규 사용자에 연결합니다.
async function firebaseUIDForUnlinkedGoogleProvider(
    payload: GoogleTokenPayload
): Promise<string> {
    const email = requiredVerifiedEmail(payload);
    const providerToLink = googleProviderForPayload(payload, email);
    try {
        const userRecord = await admin.auth().getUserByEmail(email);
        await admin.auth().updateUser(userRecord.uid, {
            ...googleProfileUpdate(payload),
            providerToLink
        });
        return userRecord.uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) !== "auth/user-not-found") {
            throw error;
        }
    }

    const userRecord = await admin.auth().createUser({
        displayName: payload.name,
        email,
        photoURL: payload.picture,
        providerToLink
    });
    return userRecord.uid;
}

// Google ID token에 검증된 이메일이 있으면 해당 값을 반환합니다.
function verifiedGoogleEmail(
    payload: GoogleTokenPayload
): string | undefined {
    return payload.email_verified === true && payload.email ?
        payload.email :
        undefined;
}

// 미연결 provider 라우팅에 필요한 검증된 Google 이메일을 반환합니다.
function requiredVerifiedEmail(
    payload: GoogleTokenPayload
): string {
    const email = verifiedGoogleEmail(payload);
    if (!email) {
        throw new HttpsError(
            "internal",
            "Google 사용자 이메일을 확인할 수 없습니다.",
            { reason: "email_not_found" }
        );
    }
    return email;
}

// Google 프로필 claim을 Firebase Auth 기본 프로필 갱신 값으로 구성합니다.
function googleProfileUpdate(
    payload: GoogleTokenPayload
): UpdateRequest {
    return {
        displayName: payload.name ?? null,
        photoURL: payload.picture ?? null
    };
}

// Google ID token claim을 Firebase Auth provider 연결 값으로 구성합니다.
function googleProviderForPayload(
    payload: GoogleTokenPayload,
    email?: string
): UserProvider {
    return {
        providerId: PROVIDER_ID,
        uid: payload.sub,
        displayName: payload.name,
        email,
        photoURL: payload.picture
    };
}

// 다른 Firebase 사용자에게 연결된 Google provider 충돌 오류를 구성합니다.
function googleProviderLinkConflictError() {
    return new HttpsError(
        "failed-precondition",
        "Google provider가 다른 계정에 연결되어 있습니다.",
        { reason: "google_provider_link_conflict" }
    );
}

// 검증된 이메일을 지정한 Firebase 사용자에게 안전하게 설정할 수 있는지 확인합니다.
async function emailCanBeAssigned(
    email: string,
    uid: string
): Promise<boolean> {
    try {
        const emailUser = await admin.auth().getUserByEmail(email);
        return emailUser.uid === uid;
    } catch (error) {
        if (firebaseAuthErrorCode(error) === "auth/user-not-found") {
            return true;
        }
        throw error;
    }
}

// Firebase Auth 예외에서 오류 코드를 추출합니다.
function firebaseAuthErrorCode(error: unknown): string | undefined {
    if (!error || typeof error !== "object") {
        return undefined;
    }
    const code = (error as Record<string, unknown>).code;
    return typeof code === "string" ? code : undefined;
}
