import { HttpsError } from "firebase-functions/v2/https";
import type { FirestoreDatabase } from "../common/firestore";

// GitHub OAuth App 요청에 필요한 환경별 설정을 나타냅니다.
export interface GitHubConfiguration {
    // OAuth App 공개 식별자를 저장합니다.
    clientId: string;
    // OAuth App 비밀값을 저장합니다.
    clientSecret: string;
    // GitHub가 호출할 Functions callback 주소를 저장합니다.
    callbackURL: string;
}

// Firestore 데이터베이스에 대응하는 GitHub OAuth App 설정을 반환합니다.
export function githubConfiguration(
    firebaseDB: FirestoreDatabase
): GitHubConfiguration {
    const prefix = firebaseDB.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const clientId = process.env[`GITHUB_${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`GITHUB_${prefix}_CLIENT_SECRET`]?.trim();
    const callbackURL = process.env[`GITHUB_${prefix}_CALLBACK_URL`]?.trim();

    if (!clientId || !clientSecret || !callbackURL) {
        throw new HttpsError(
            "internal",
            `GitHub ${firebaseDB} OAuth App 설정이 누락되었습니다.`
        );
    }

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
