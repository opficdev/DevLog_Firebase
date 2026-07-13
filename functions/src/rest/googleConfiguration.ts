import { HttpsError } from "firebase-functions/v2/https";
import type { FirestoreDatabase } from "../common/firestore";

// Google OAuth 요청에 필요한 환경별 설정을 나타냅니다.
export interface GoogleConfiguration {
    // OAuth client 공개 식별자를 저장합니다.
    clientId: string;
    // OAuth client 비밀값을 저장합니다.
    clientSecret: string;
    // Google이 호출할 Functions callback 주소를 저장합니다.
    callbackURL: string;
}

// Firestore 데이터베이스에 대응하는 Google OAuth client 설정을 반환합니다.
export function googleConfiguration(
    firebaseDB: FirestoreDatabase
): GoogleConfiguration {
    const prefix = firebaseDB.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const clientId = process.env[`GOOGLE_${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = process.env[`GOOGLE_${prefix}_CLIENT_SECRET`]?.trim();
    const callbackURL = process.env[`GOOGLE_${prefix}_CALLBACK_URL`]?.trim();

    if (!clientId || !clientSecret || !callbackURL) {
        throw new HttpsError(
            "internal",
            `Google ${firebaseDB} OAuth client 설정이 누락되었습니다.`
        );
    }

    return {
        clientId,
        clientSecret,
        callbackURL
    };
}
