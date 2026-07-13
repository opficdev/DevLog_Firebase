import * as admin from "firebase-admin";
import {
    appleConfiguration,
    requestAppleTokensFromCode,
    requiredAppleRefreshToken,
    revokeExchangedTokens
} from "./appleClient";
import {
    requestAppleProofWithChallenge,
    verifiedApplePayload
} from "./challenge";
import { saveAppleCredential } from "./credential";
import {
    ensureAppleProvider,
    resolveAppleFirebaseUID
} from "./provider";
import { updateAppleProfile } from "./profile";

// challenge 기반 Apple 인증 증명으로 Firebase custom token을 생성합니다.
export async function requestAppleCustomTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    challengeId: string,
    authorizationCode: string,
    displayName?: string
): Promise<{ customToken: string }> {
    const proof = await requestAppleProofWithChallenge(
        db,
        challengeId,
        authorizationCode
    );
    const refreshToken = await requiredAppleRefreshToken(proof.tokens);
    const auth = admin.auth();
    let uid: string;
    try {
        uid = await resolveAppleFirebaseUID(
            auth,
            proof.payload
        );
    } catch (error) {
        await revokeExchangedTokens(proof.tokens);
        throw error;
    }
    try {
        await ensureAppleProvider(
            auth,
            uid,
            proof.payload
        );
        await updateAppleProfile(
            db,
            auth,
            uid,
            displayName
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

    return {
        customToken: await auth.createCustomToken(uid)
    };
}

// 이전 iOS 요청 형식의 identity token 검증과 custom token 발급을 유지합니다.
export async function requestLegacyAppleCustomTokenWithDatabase(
    db: FirebaseFirestore.Firestore,
    idToken: string,
    authorizationCode: string
): Promise<{ customToken: string }> {
    const { clientId } = appleConfiguration();
    const payload = await verifiedApplePayload(
        idToken,
        clientId
    );
    const auth = admin.auth();
    const uid = await resolveAppleFirebaseUID(
        auth,
        payload
    );
    await ensureAppleProvider(
        auth,
        uid,
        payload
    );
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
        customToken: await auth.createCustomToken(uid)
    };
}
