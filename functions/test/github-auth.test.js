const assert = require("assert");

const axiosRequests = [];
const loggerErrors = [];
const loggerWarnings = [];
let grantDeleteStatus = 204;
let tokenDeleteStatus = 204;
let tokenCheckStatus = 404;

const fakeAxios = {
    async request(configuration) {
        axiosRequests.push(configuration);
        if (
            configuration.method === "delete" &&
            configuration.url === "https://api.github.com/applications/client-id/grant"
        ) {
            if (grantDeleteStatus === 204) {
                return { status: 204 };
            }
            throw axiosError(grantDeleteStatus, { message: "grant 삭제 실패" });
        }
        if (
            configuration.method === "delete" &&
            configuration.url === "https://api.github.com/applications/client-id/token"
        ) {
            if (tokenDeleteStatus === 204) {
                return { status: 204 };
            }
            throw axiosError(tokenDeleteStatus, { message: "token 삭제 실패" });
        }
        if (
            configuration.method === "post" &&
            configuration.url === "https://api.github.com/applications/client-id/token"
        ) {
            throw axiosError(tokenCheckStatus, { message: "token을 찾을 수 없음" });
        }
        throw new Error(
            `예상하지 않은 GitHub API 요청: ${configuration.method} ${configuration.url}`
        );
    },
    isAxiosError(error) {
        return error?.isAxiosError === true;
    }
};

require.cache[require.resolve("axios")] = {
    exports: fakeAxios
};
require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error: (...values) => loggerErrors.push(values),
        warn: (...values) => loggerWarnings.push(values)
    }
};

const {
    revokeGitHubOAuthGrant,
    revokeGitHubOAuthToken
} = require("../lib/rest/github/githubClient");

(async () => {
    await assertGitHubGrantRevocation();
    await assertGitHubGrantRevocationSucceedsForInvalidToken();
    await assertGitHubTokenRevocationSucceedsForInvalidToken();
    await assertGitHubGrantRevocationReportsTokenCheckFailure();
    await assertGitHubGrantRevocationFailure();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// GitHub OAuth App grant 폐기 요청 형식을 검증합니다.
async function assertGitHubGrantRevocation() {
    resetRevocationState();

    await revokeGitHubOAuthGrant(
        "firebase-uid",
        "valid-token",
        "client-id",
        "client-secret"
    );

    assert.strictEqual(axiosRequests.length, 1);
    assert.strictEqual(
        axiosRequests[0].url,
        "https://api.github.com/applications/client-id/grant"
    );
    assert.deepStrictEqual(axiosRequests[0].data, { access_token: "valid-token" });
    assertRevocationHeaders(axiosRequests[0]);
}

// 이미 무효화된 grant 폐기를 반복 가능한 성공으로 처리하는지 검증합니다.
async function assertGitHubGrantRevocationSucceedsForInvalidToken() {
    resetRevocationState();
    grantDeleteStatus = 422;

    await revokeGitHubOAuthGrant(
        "firebase-uid",
        "invalid-token",
        "client-id",
        "client-secret"
    );

    assert.strictEqual(axiosRequests.length, 2);
    assert.strictEqual(loggerWarnings.length, 1);
    assert.deepStrictEqual(loggerErrors, []);
}

// 이미 무효화된 token 폐기를 반복 가능한 성공으로 처리하는지 검증합니다.
async function assertGitHubTokenRevocationSucceedsForInvalidToken() {
    resetRevocationState();
    tokenDeleteStatus = 422;

    await revokeGitHubOAuthToken(
        "firebase-uid",
        "invalid-token",
        "client-id",
        "client-secret"
    );

    assert.strictEqual(loggerWarnings.length, 1);
    assert.deepStrictEqual(loggerErrors, []);
}

// token 상태 확인 실패와 최종 grant 폐기 실패를 각각 기록하는지 검증합니다.
async function assertGitHubGrantRevocationReportsTokenCheckFailure() {
    resetRevocationState();
    grantDeleteStatus = 422;
    tokenCheckStatus = 500;

    await assert.rejects(
        () => revokeGitHubOAuthGrant(
            "firebase-uid",
            "unknown-token",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "github_revoke_failed"
    );

    assert.strictEqual(loggerErrors.length, 2);
    assert.strictEqual(loggerErrors[0][0], "GitHub 토큰 상태 확인에 실패했습니다.");
    assert.strictEqual(loggerErrors[1][0], "GitHub OAuth App grant 제거에 실패했습니다.");
}

// GitHub grant 폐기 실패를 구분 가능한 오류로 변환하는지 검증합니다.
async function assertGitHubGrantRevocationFailure() {
    resetRevocationState();
    grantDeleteStatus = 500;

    await assert.rejects(
        () => revokeGitHubOAuthGrant(
            "firebase-uid",
            "valid-token",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "github_revoke_failed"
    );
    assert.strictEqual(loggerErrors.length, 1);
}

// GitHub grant 폐기 시험 상태를 초기화합니다.
function resetRevocationState() {
    axiosRequests.length = 0;
    loggerErrors.length = 0;
    loggerWarnings.length = 0;
    grantDeleteStatus = 204;
    tokenDeleteStatus = 204;
    tokenCheckStatus = 404;
}

// GitHub OAuth App 폐기 요청 헤더를 검증합니다.
function assertRevocationHeaders(call) {
    assert.deepStrictEqual(call.auth, {
        username: "client-id",
        password: "client-secret"
    });
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.strictEqual(call.headers["User-Agent"], "DevLog-Firebase");
}

// Axios 오류 대역을 구성합니다.
function axiosError(status, data) {
    const error = new Error(`요청이 status code ${status}로 실패했습니다.`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}
