import { HttpsError } from "firebase-functions/v2/https";
import { defineJsonSecret } from "firebase-functions/params";
import type { FirestoreDatabase } from "../common/firestore";
import { requiredAuthenticationConfigurationValue } from "./authenticationConfiguration";

// GitHub OAuth App 요청에 필요한 환경별 설정을 나타냅니다.
export interface GitHubConfiguration {
    // OAuth App 공개 식별자를 저장합니다.
    clientId: string;
    // OAuth App 비밀값을 저장합니다.
    clientSecret: string;
    // GitHub가 호출할 Functions callback 주소를 저장합니다.
    callbackURL: string;
}

// GitHub OAuth App 설정 전체를 project별 JSON Secret에서 제공합니다.
export const githubOAuthConfigurationSecret = defineJsonSecret<GitHubConfiguration>("GITHUB_OAUTH_CONFIG");

// Firebase project에 대응하는 GitHub OAuth App 설정을 반환합니다.
export function githubConfiguration(
    firebaseDB: FirestoreDatabase
): GitHubConfiguration {
    const configuration = githubOAuthConfigurationSecret.value();
    const provider = `GitHub ${firebaseDB} OAuth App`;
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

// 저장된 credential 발급 App에 대응하는 grant 폐기 설정을 반환합니다.
export function githubRevocationConfiguration(
    firebaseDB: FirestoreDatabase,
    credentialClientId?: string
): GitHubConfiguration {
    const configuration = githubConfiguration(firebaseDB);
    if (
        credentialClientId &&
        credentialClientId !== configuration.clientId
    ) {
        throw new HttpsError(
            "internal",
            "GitHub credential을 발급한 OAuth App 설정을 찾을 수 없습니다."
        );
    }
    return configuration;
}
