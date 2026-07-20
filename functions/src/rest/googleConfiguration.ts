import { defineJsonSecret } from "firebase-functions/params";
import type { FirestoreDatabase } from "../common/firestore";
import { requiredAuthenticationConfigurationValue } from "./authenticationConfiguration";

// Google OAuth 요청에 필요한 환경별 설정을 나타냅니다.
export interface GoogleConfiguration {
    // OAuth client 공개 식별자를 저장합니다.
    clientId: string;
    // OAuth client 비밀값을 저장합니다.
    clientSecret: string;
    // Google이 호출할 Functions callback 주소를 저장합니다.
    callbackURL: string;
}

// Google OAuth client 설정 전체를 project별 JSON Secret에서 제공합니다.
export const googleOAuthConfigurationSecret = defineJsonSecret<GoogleConfiguration>("GOOGLE_OAUTH_CONFIG");

// Firebase project에 대응하는 Google OAuth client 설정을 반환합니다.
export function googleConfiguration(
    firebaseDB: FirestoreDatabase
): GoogleConfiguration {
    const configuration = googleOAuthConfigurationSecret.value();
    const provider = `Google ${firebaseDB} OAuth client`;
    const clientId = requiredAuthenticationConfigurationValue(
        configuration,
        "clientId",
        provider
    );
    const clientSecret = requiredAuthenticationConfigurationValue(
        configuration,
        "clientSecret",
        provider
    );
    const callbackURL = requiredAuthenticationConfigurationValue(
        configuration,
        "callbackURL",
        provider
    );

    return {
        clientId,
        clientSecret,
        callbackURL
    };
}
