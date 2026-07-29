import { onDocumentDeleted } from "firebase-functions/v2/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../../common/error";
import { revokeGitHubOAuthToken } from "../github/githubClient";
import {
    githubOAuthConfigurationSecret,
    githubRevocationConfiguration
} from "../github/githubConfiguration";

const LOCATION = "asia-northeast3";

// 현재 Firebase project에서 만료된 OAuth session 비밀값을 정리합니다.
export const cleanupExpiredOAuthSessions = expiredOAuthCleanupFunction(
    "oauthSessions/{documentId}",
    "cleanupPayload"
);

// 현재 Firebase project에서 소비되지 않은 OAuth ticket 비밀값을 정리합니다.
export const cleanupExpiredOAuthTickets = expiredOAuthCleanupFunction(
    "oauthTickets/{documentId}",
    "payload"
);

// TTL 삭제 문서에 남은 GitHub token을 개별 폐기하는 Firestore 함수를 구성합니다.
function expiredOAuthCleanupFunction(
    document: string,
    payloadField: "cleanupPayload" | "payload"
) {
    return onDocumentDeleted({
        maxInstances: 1,
        document,
        region: LOCATION,
        retry: true,
        secrets: [githubOAuthConfigurationSecret]
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
            const configuration = githubRevocationConfiguration(clientId);
            await revokeGitHubOAuthToken(
                `oauth-expired:${event.params.documentId}`,
                accessToken,
                configuration.clientId,
                configuration.clientSecret
            );
        } catch (error) {
            logger.error("만료 OAuth credential 폐기 실패", toError(error), {
                documentId: event.params.documentId,
                provider: data.provider
            });
            throw error;
        }
    });
}
