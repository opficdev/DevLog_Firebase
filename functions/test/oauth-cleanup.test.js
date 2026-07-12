const assert = require("assert");
const functionsTest = require("firebase-functions-test")();

const revokeCalls = [];
let revokeError;

require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error() {}
    }
};
require.cache[require.resolve("../lib/rest/githubClient")] = {
    exports: {
        revokeGitHubOAuthToken: async (...values) => {
            revokeCalls.push(values);
            if (revokeError) {
                throw revokeError;
            }
        }
    }
};
require.cache[require.resolve("../lib/rest/githubConfiguration")] = {
    exports: {
        githubRevocationConfiguration: (_, clientId) => ({
            clientId,
            clientSecret: `${clientId}-secret`,
            callbackURL: ""
        })
    }
};

const {
    cleanupExpiredOAuthSessions,
    cleanupExpiredOAuthTickets
} = require("../lib/rest/oauth/cleanup");

(async () => {
    await assertExpiredTicketRevokesStoredToken();
    await assertExpiredSessionRevokesCompensationToken();
    await assertCleanupFailureIsRetried();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    functionsTest.cleanup();
});

// 만료된 미소비 ticket이 저장한 GitHub token을 폐기하는지 검증합니다.
async function assertExpiredTicketRevokesStoredToken() {
    resetState();
    const cleanup = cleanupExpiredOAuthTickets("staging");
    const wrapped = functionsTest.wrap(cleanup);

    await wrapped({
        data: {
            provider: "github",
            payload: {
                accessToken: "ticket-token",
                clientId: "staging-client-id"
            }
        },
        params: { documentId: "ticket-1" }
    });

    assert.deepStrictEqual(revokeCalls, [[
        "oauth-expired:ticket-1",
        "ticket-token",
        "staging-client-id",
        "staging-client-id-secret"
    ]]);
}

// callback 보상 실패를 저장한 session이 TTL 삭제 시 token을 폐기하는지 검증합니다.
async function assertExpiredSessionRevokesCompensationToken() {
    resetState();
    const cleanup = cleanupExpiredOAuthSessions("prod");
    const wrapped = functionsTest.wrap(cleanup);

    await wrapped({
        data: {
            provider: "github",
            cleanupPayload: {
                accessToken: "session-token",
                clientId: "prod-client-id"
            }
        },
        params: { documentId: "session-1" }
    });

    assert.deepStrictEqual(revokeCalls, [[
        "oauth-expired:session-1",
        "session-token",
        "prod-client-id",
        "prod-client-id-secret"
    ]]);
}

// token 폐기 실패가 성공으로 삼켜지지 않고 retry-enabled trigger에 전달되는지 검증합니다.
async function assertCleanupFailureIsRetried() {
    resetState();
    revokeError = new Error("revoke failed");
    const cleanup = cleanupExpiredOAuthTickets("staging");
    const wrapped = functionsTest.wrap(cleanup);

    assert.strictEqual(cleanup.__endpoint.eventTrigger.retry, true);
    assert.strictEqual(cleanup.__endpoint.eventTrigger.eventFilters.database, "staging");
    await assert.rejects(
        () => wrapped({
            data: {
                provider: "github",
                payload: {
                    accessToken: "ticket-token",
                    clientId: "staging-client-id"
                }
            },
            params: { documentId: "ticket-2" }
        }),
        /revoke failed/
    );
}

// OAuth TTL 정리 테스트의 공유 상태를 초기화합니다.
function resetState() {
    revokeCalls.length = 0;
    revokeError = undefined;
}
