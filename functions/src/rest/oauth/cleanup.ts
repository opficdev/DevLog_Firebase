import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import type { FirestoreDatabase } from "../../common/firestore";
import { toError } from "../../common/error";
import { revokeGitHubOAuthToken } from "../githubClient";
import { githubRevocationConfiguration } from "../githubConfiguration";

const LOCATION = "asia-northeast3";

// 지정한 데이터베이스에서 만료된 OAuth session 비밀값을 정리하는 함수를 반환합니다.
export function cleanupExpiredOAuthSessions(firebaseDB: FirestoreDatabase) {
    return expiredOAuthCleanupFunction(
        firebaseDB,
        "oauthSessions/{documentId}",
        "cleanupPayload"
    );
}

// 지정한 데이터베이스에서 소비되지 않은 OAuth ticket 비밀값을 정리하는 함수를 반환합니다.
export function cleanupExpiredOAuthTickets(firebaseDB: FirestoreDatabase) {
    return expiredOAuthCleanupFunction(
        firebaseDB,
        "oauthTickets/{documentId}",
        "payload"
    );
}

// TTL 삭제 문서에 남은 GitHub token을 개별 폐기하는 Firestore 함수를 구성합니다.
function expiredOAuthCleanupFunction(
    firebaseDB: FirestoreDatabase,
    document: string,
    payloadField: "cleanupPayload" | "payload"
) {
    return onDocumentDeleted({
        maxInstances: 1,
        database: firebaseDB,
        document,
        region: LOCATION,
        retry: true
    },
    async (event) => {
        const data = event.data?.data();
        const payload = data?.[payloadField];
        const accessToken = payload?.accessToken;
        const clientId = payload?.clientId;
        if (
            data?.provider !== "github" ||
            typeof accessToken !== "string" ||
            typeof clientId !== "string"
        ) {
            return;
        }

        try {
            const configuration = githubRevocationConfiguration(
                firebaseDB,
                clientId
            );
            await revokeGitHubOAuthToken(
                `oauth-expired:${event.params.documentId}`,
                accessToken,
                configuration.clientId,
                configuration.clientSecret
            );
        } catch (error) {
            logger.error("만료 OAuth credential 폐기 실패", toError(error), {
                firebaseDB,
                documentId: event.params.documentId,
                provider: data.provider
            });
            throw error;
        }
    });
}
