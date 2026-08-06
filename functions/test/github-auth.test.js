const assert = require("assert");

const axiosCalls = [];
const axiosRequests = [];
const loggerErrors = [];
const loggerInfos = [];
const loggerWarnings = [];
const userLookupCalls = [];
const providerLookupCalls = [];
const updatedUsers = [];
let grantDeleteStatus = 204;
let tokenDeleteStatus = 204;
let tokenCheckStatus = 404;
let currentUser;
let providerUIDUser;
let githubEmails = verifiedEmails("user@example.com");

const fakeAxios = {
    async get(url, configuration) {
        axiosCalls.push({ url, headers: configuration?.headers });
        if (url === "https://api.github.com/user") {
            return {
                data: {
                    id: 1,
                    login: "github-user",
                    name: "GitHub User",
                    avatar_url: "https://example.com/avatar.png"
                }
            };
        }
        if (url === "https://api.github.com/user/emails") {
            return { data: githubEmails };
        }
        throw new Error(`예상하지 않은 GitHub API URL: ${url}`);
    },
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

const fakeAuth = {
    async getUser(uid) {
        userLookupCalls.push(uid);
        if (!currentUser) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return currentUser;
    },
    async getUserByProviderUid(providerId, uid) {
        providerLookupCalls.push({ providerId, uid });
        if (!providerUIDUser) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return providerUIDUser;
    },
    async updateUser(uid, properties) {
        updatedUsers.push({ uid, properties });
        return { uid };
    }
};

require.cache[require.resolve("axios")] = {
    exports: fakeAxios
};
require.cache[require.resolve("firebase-admin")] = {
    exports: {
        auth: () => fakeAuth
    }
};
require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error: (...values) => loggerErrors.push(values),
        info: (...values) => loggerInfos.push(values),
        warn: (...values) => loggerWarnings.push(values)
    }
};

const {
    revokeGitHubOAuthGrant,
    revokeGitHubOAuthToken
} = require("../lib/rest/github/githubClient");
const {
    linkGithubProviderWithAccessToken
} = require("../lib/rest/github/githubProvider");

(async () => {
    await assertGithubLinkRejectsMismatchedEmail();
    await assertGithubLinkKeepsCurrentProvider();
    await assertGithubLinkRejectsDifferentCurrentProvider();
    await assertGithubLinkConnectsUnlinkedProvider();
    await assertGithubLinkBlocksProviderConnectedToOtherUser();
    await assertGithubUnlinkRemovesOAuthGrant();
    await assertGithubUnlinkSucceedsWhenGrantDeleteFindsInvalidToken();
    await assertGithubTokenRevokeSucceedsWhenTokenIsAlreadyInvalid();
    await assertGithubUnlinkReportsTokenCheckFailureAsError();
    await assertGithubUnlinkFailureIsDistinguished();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 현재 사용자에 이미 연결된 GitHub provider를 유지하는지 검증합니다.
async function assertGithubLinkKeepsCurrentProvider() {
    resetState();
    providerUIDUser = userRecord("current-uid", [githubProvider()]);
    currentUser = userRecord("current-uid", [githubProvider()], "user@example.com");

    await linkGithubProviderWithAccessToken("current-uid", "access-token");

    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(updatedUsers, [{
        uid: "current-uid",
        properties: { providerToLink: githubProvider() }
    }]);
    assertGitHubRequestHeaders();
}

// 현재 사용자의 다른 GitHub uid를 새 provider로 교체하지 않는지 검증합니다.
async function assertGithubLinkRejectsDifferentCurrentProvider() {
    resetState();
    currentUser = userRecord(
        "current-uid",
        [{ ...githubProvider(), uid: "previous-github-uid" }],
        "user@example.com"
    );

    await assert.rejects(
        () => linkGithubProviderWithAccessToken("current-uid", "access-token"),
        (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "github_email_changed_account_conflict"
    );

    assert.deepStrictEqual(providerLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
}

// 현재 사용자와 GitHub verified email이 다르면 연결을 차단하는지 검증합니다.
async function assertGithubLinkRejectsMismatchedEmail() {
    resetState();
    githubEmails = verifiedEmails("target@example.com");
    currentUser = userRecord("current-uid", [], "user@example.com");

    await assert.rejects(
        () => linkGithubProviderWithAccessToken("current-uid", "access-token"),
        (error) =>
            error.code === "invalid-argument" &&
            error.details?.reason === "email_mismatch"
    );

    assert.deepStrictEqual(providerLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
}

// 연결되지 않은 GitHub provider를 현재 사용자에 연결하는지 검증합니다.
async function assertGithubLinkConnectsUnlinkedProvider() {
    resetState();
    currentUser = userRecord("current-uid", [], "user@example.com");

    await linkGithubProviderWithAccessToken("current-uid", "access-token");

    assert.deepStrictEqual(updatedUsers, [{
        uid: "current-uid",
        properties: { providerToLink: githubProvider() }
    }]);
    assert.deepStrictEqual(loggerInfos, [[
        "현재 사용자(current-uid)에 GitHub provider 연결을 추가했습니다."
    ]]);
}

// 다른 사용자가 소유한 GitHub provider 연결을 차단하는지 검증합니다.
async function assertGithubLinkBlocksProviderConnectedToOtherUser() {
    resetState();
    providerUIDUser = userRecord("other-uid", [githubProvider()]);
    currentUser = userRecord("current-uid", [], "user@example.com");

    await assert.rejects(
        () => linkGithubProviderWithAccessToken("current-uid", "access-token"),
        (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "github_email_changed_account_conflict"
    );

    assert.deepStrictEqual(updatedUsers, []);
}

// GitHub OAuth App grant 폐기 요청 형식을 검증합니다.
async function assertGithubUnlinkRemovesOAuthGrant() {
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
async function assertGithubUnlinkSucceedsWhenGrantDeleteFindsInvalidToken() {
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
async function assertGithubTokenRevokeSucceedsWhenTokenIsAlreadyInvalid() {
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
async function assertGithubUnlinkReportsTokenCheckFailureAsError() {
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
async function assertGithubUnlinkFailureIsDistinguished() {
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

// GitHub provider 시험 상태를 초기화합니다.
function resetState() {
    axiosCalls.length = 0;
    axiosRequests.length = 0;
    loggerErrors.length = 0;
    loggerInfos.length = 0;
    loggerWarnings.length = 0;
    userLookupCalls.length = 0;
    providerLookupCalls.length = 0;
    updatedUsers.length = 0;
    currentUser = undefined;
    providerUIDUser = undefined;
    githubEmails = verifiedEmails("user@example.com");
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

// GitHub 사용자 API 요청 헤더를 검증합니다.
function assertGitHubRequestHeaders() {
    for (const url of [
        "https://api.github.com/user",
        "https://api.github.com/user/emails"
    ]) {
        const call = axiosCalls.find((item) => item.url === url);
        assert.ok(call);
        assert.strictEqual(call.headers.Authorization, "Bearer access-token");
        assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
        assert.strictEqual(call.headers["User-Agent"], "DevLog-Firebase");
    }
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

// Firebase Auth 사용자 대역을 구성합니다.
function userRecord(uid, providerData = [], email) {
    return { uid, providerData, email };
}

// GitHub provider 대역을 구성합니다.
function githubProvider() {
    return {
        providerId: "github.com",
        uid: "1",
        displayName: "GitHub User",
        email: "user@example.com",
        photoURL: "https://example.com/avatar.png"
    };
}

// GitHub verified email 응답 대역을 구성합니다.
function verifiedEmails(email) {
    return [{ email, primary: true, verified: true }];
}

// Firebase Auth 오류 대역을 구성합니다.
function firebaseAuthError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

// Axios 오류 대역을 구성합니다.
function axiosError(status, data) {
    const error = new Error(`요청이 status code ${status}로 실패했습니다.`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}
