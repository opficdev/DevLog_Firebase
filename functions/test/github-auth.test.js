const assert = require("assert");

const axiosCalls = [];
const axiosRequests = [];
const consoleErrors = [];
const consoleWarnings = [];
const userLookupCalls = [];
const providerLookupCalls = [];
const emailLookupCalls = [];
const createdUsers = [];
const updatedUsers = [];
let grantDeleteStatus = 204;
let tokenCheckStatus = 404;
let tokenRequestError;
let currentUser;
let providerUIDUser;
let emailUser;
let createdUserUID = "firebase-uid";
let githubEmails = defaultGithubEmails();
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const fakeAxios = {
    async post(url, data, config) {
        if (tokenRequestError) {
            throw tokenRequestError;
        }
        assert.strictEqual(url, "https://github.com/login/oauth/access_token");
        assert.deepStrictEqual(data, {
            client_id: "client-id",
            client_secret: "client-secret",
            code: "github-code",
            redirect_uri: "https://example.com/auth/github/callback"
        });
        assert.deepStrictEqual(config, {
            headers: { "Accept": "application/json" }
        });

        return {
            data: {
                access_token: "access-token",
                token_type: "bearer",
                scope: "user:email"
            }
        };
    },
    async get(url, config) {
        axiosCalls.push({ url, headers: config?.headers });

        if (url === "https://api.github.com/user") {
            return {
                data: {
                    id: 1,
                    login: "github-user",
                    name: "GitHub User",
                    email: "profile@example.com",
                    avatar_url: "https://example.com/avatar.png"
                }
            };
        }

        if (url === "https://api.github.com/user/emails") {
            return {
                data: githubEmails
            };
        }

        throw new Error(`예상하지 않은 GitHub API URL: ${url}`);
    },
    async request(config) {
        axiosRequests.push(config);

        if (
            config.method === "delete" &&
            config.url === "https://api.github.com/applications/client-id/grant"
        ) {
            if (grantDeleteStatus === 204) {
                return { status: 204 };
            }

            throw axiosError(grantDeleteStatus, { message: "grant 삭제 실패" });
        }

        if (
            config.method === "post" &&
            config.url === "https://api.github.com/applications/client-id/token"
        ) {
            throw axiosError(tokenCheckStatus, { message: "token을 찾을 수 없음" });
        }

        throw new Error(`예상하지 않은 GitHub API 요청: ${config.method} ${config.url}`);
    },
    isAxiosError(error) {
        return error?.isAxiosError === true;
    }
};

const fakeAuth = {
    // Firebase uid로 현재 사용자 조회를 기록합니다.
    async getUser(uid) {
        userLookupCalls.push(uid);
        if (!currentUser) {
            throw firebaseAuthError("auth/user-not-found");
        }

        return currentUser;
    },
    // GitHub provider uid로 연결된 Firebase Auth 사용자 조회를 기록합니다.
    async getUserByProviderUid(providerId, uid) {
        providerLookupCalls.push({ providerId, uid });
        if (!providerUIDUser) {
            throw firebaseAuthError("auth/user-not-found");
        }

        return providerUIDUser;
    },
    // 현재 GitHub verified email과 일치하는 Firebase Auth 사용자 조회를 기록합니다.
    async getUserByEmail(email) {
        emailLookupCalls.push(email);
        if (!emailUser) {
            throw firebaseAuthError("auth/user-not-found");
        }

        return emailUser;
    },
    // 현재 GitHub verified email 기준 신규 사용자 생성을 기록합니다.
    async createUser(properties) {
        createdUsers.push(properties);

        return { uid: createdUserUID };
    },
    // 오래된 provider 연결 정리와 현재 email 계정 연결 요청을 기록합니다.
    async updateUser(uid, properties) {
        updatedUsers.push({ uid, properties });

        return { uid };
    },
    async createCustomToken(uid) {
        return `custom-token:${uid}`;
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
console.error = (...args) => {
    consoleErrors.push(args);
};
console.warn = (...args) => {
    consoleWarnings.push(args);
};

const {
    linkGithubProviderWithAccessToken,
    requestGitHubAccessToken,
    resolveGithubFirebaseUID,
    revokeGitHubOAuthGrant
} = require("../lib/rest/githubAuth");

(async () => {
    try {
        await assertGitHubTokenRequestUsesCallback();
        await assertGitHubTokenRequestFailureIsDistinguished();
        await assertGithubLoginKeepsProviderWithoutVerifiedEmail();
        await assertGithubLoginKeepsProviderWhenEmailChangesWithoutEmailUser();
        await assertGithubLoginKeepsProviderWhenEmailChangesWithEmailUser();
        await assertGithubLoginCreatesProviderLinkedUserForNewEmail();
        await assertGithubLoginReportsUnavailableEmail();

        await assertGithubLinkRejectsMismatchedEmail();
        await assertGithubLinkKeepsCurrentProvider();
        await assertGithubLinkConnectsUnlinkedProvider();
        await assertGithubLinkBlocksProviderConnectedToOtherUser();

        await assertGithubUnlinkRemovesOAuthGrant();
        await assertGithubUnlinkSucceedsWhenGrantDeleteFindsInvalidToken();
        await assertGithubUnlinkFailureIsDistinguished();
    } finally {
        console.error = originalConsoleError;
        console.warn = originalConsoleWarn;
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// GitHub code 교환 요청이 환경별 callback 주소를 포함하는지 검증합니다.
async function assertGitHubTokenRequestUsesCallback() {
    const accessToken = await requestGitHubAccessToken(
        "github-code",
        "client-id",
        "client-secret",
        "https://example.com/auth/github/callback"
    );

    assert.strictEqual(accessToken, "access-token");
}

// GitHub 인증 서버 요청 실패가 외부 provider 오류로 구분되는지 검증합니다.
async function assertGitHubTokenRequestFailureIsDistinguished() {
    tokenRequestError = axiosError(503, { message: "GitHub unavailable" });
    try {
        await assert.rejects(
            () => requestGitHubAccessToken(
                "github-code",
                "client-id",
                "client-secret"
            ),
            (error) => error.details?.reason === "github_provider_failed"
        );
    } finally {
        tokenRequestError = undefined;
    }
}

function assertHeaders(url) {
    const call = axiosCalls.find((item) => item.url === url);

    assert.ok(call, `${url} 요청이 발생해야 합니다.`);
    assert.strictEqual(call.headers.Authorization, "Bearer access-token");
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.ok(call.headers["User-Agent"]);
}

// 지정한 GitHub API 요청이 발생하지 않았는지 검증합니다.
function assertNoRequest(url) {
    assert.strictEqual(axiosCalls.some((item) => item.url === url), false);
}

function assertRevokeHeaders(call) {
    assert.strictEqual(call.headers.Accept, "application/vnd.github+json");
    assert.strictEqual(call.headers["User-Agent"], "DevLog-Firebase");
}

// verified email이 없어도 기존 provider uid로 로그인하는지 검증합니다.
async function assertGithubLoginKeepsProviderWithoutVerifiedEmail() {
    resetGithubLoginState();
    githubEmails = unavailableGithubEmails();
    providerUIDUser = userRecord(
        "linked-uid",
        [githubProviderData("user@example.com")]
    );
    emailUser = userRecord("email-uid");

    const result = await resolveGithubFirebaseUID("access-token");

    assert.strictEqual(result, "linked-uid");
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(createdUsers, []);
    assert.deepStrictEqual(updatedUsers, []);
    assertHeaders("https://api.github.com/user");
    assertNoRequest("https://api.github.com/user/emails");
}

// GitHub email이 바뀌고 같은 email 계정이 없어도 기존 provider uid로 로그인하는지 검증합니다.
async function assertGithubLoginKeepsProviderWhenEmailChangesWithoutEmailUser() {
    resetGithubLoginState();
    githubEmails = verifiedEmails("new@example.com");
    providerUIDUser = userRecord(
        "old-uid",
        [
            githubProviderData("old@example.com"),
            googleProviderData("old@example.com")
        ]
    );
    const result = await resolveGithubFirebaseUID("access-token");

    assert.strictEqual(result, "old-uid");
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, []);
    assertHeaders("https://api.github.com/user");
    assertNoRequest("https://api.github.com/user/emails");
}

// GitHub email이 바뀌고 같은 email 계정이 있어도 기존 provider uid로 로그인하는지 검증합니다.
async function assertGithubLoginKeepsProviderWhenEmailChangesWithEmailUser() {
    resetGithubLoginState();
    githubEmails = verifiedEmails("target@example.com");
    providerUIDUser = userRecord(
        "old-uid",
        [
            githubProviderData("old@example.com"),
            googleProviderData("old@example.com")
        ]
    );
    emailUser = userRecord("target-uid");

    const result = await resolveGithubFirebaseUID("access-token");

    assert.strictEqual(result, "old-uid");
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(createdUsers, []);
    assert.deepStrictEqual(updatedUsers, []);
    assertHeaders("https://api.github.com/user");
    assertNoRequest("https://api.github.com/user/emails");
}

// provider 연결과 같은 email 계정이 없으면 현재 email 기준 새 provider 연결 계정을 생성하는지 검증합니다.
async function assertGithubLoginCreatesProviderLinkedUserForNewEmail() {
    resetGithubLoginState();
    createdUserUID = "new-uid";

    const result = await resolveGithubFirebaseUID("access-token");

    assert.strictEqual(result, "new-uid");
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(emailLookupCalls, ["user@example.com"]);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, [newGitHubUserProperties("user@example.com")]);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

// GitHub verified email을 찾을 수 없으면 email_not_found 사유로 로그인 실패를 전달하는지 검증합니다.
async function assertGithubLoginReportsUnavailableEmail() {
    resetGithubLoginState();
    githubEmails = unavailableGithubEmails();

    await assert.rejects(
        () => resolveGithubFirebaseUID("access-token"),
        (error) => {
            assert.strictEqual(error.code, "internal");
            assert.strictEqual(error.message, "GitHub 사용자 데이터를 가져오지 못했습니다.");
            assert.deepStrictEqual(error.details, {
                reason: "email_not_found"
            });
            return true;
        }
    );

    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, []);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

// 현재 사용자에 이미 연결된 GitHub provider는 추가 변경 없이 정상 처리되는지 검증합니다.
async function assertGithubLinkKeepsCurrentProvider() {
    resetGithubLoginState();
    providerUIDUser = userRecord(
        "current-uid",
        [githubProviderData("old@example.com")]
    );
    currentUser = userRecord("current-uid", [], "user@example.com");

    const result = await linkGithubProviderWithAccessToken(
        "current-uid",
        "access-token"
    );

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(userLookupCalls, ["current-uid"]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, []);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

// 현재 사용자와 GitHub verified email이 다르면 provider 연결을 차단하는지 검증합니다.
async function assertGithubLinkRejectsMismatchedEmail() {
    resetGithubLoginState();
    githubEmails = verifiedEmails("target@example.com");
    currentUser = userRecord("current-uid", [], "user@example.com");

    await assert.rejects(
        () => linkGithubProviderWithAccessToken(
            "current-uid",
            "access-token"
        ),
        (error) => {
            assert.strictEqual(error.code, "invalid-argument");
            assert.strictEqual(error.message, "이메일이 일치하지 않습니다.");
            assert.deepStrictEqual(error.details, {
                reason: "email_mismatch"
            });
            return true;
        }
    );

    assert.deepStrictEqual(providerLookupCalls, []);
    assert.deepStrictEqual(userLookupCalls, ["current-uid"]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, []);
    assert.deepStrictEqual(axiosRequests, []);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

// 연결되지 않은 GitHub provider는 현재 사용자에 연결되는지 검증합니다.
async function assertGithubLinkConnectsUnlinkedProvider() {
    resetGithubLoginState();
    currentUser = userRecord("current-uid", [], "user@example.com");

    const result = await linkGithubProviderWithAccessToken(
        "current-uid",
        "access-token"
    );

    assert.strictEqual(result, undefined);
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(userLookupCalls, ["current-uid"]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, [{
        uid: "current-uid",
        properties: {
            providerToLink: githubProviderData("user@example.com")
        }
    }]);
    assert.deepStrictEqual(createdUsers, []);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

// 다른 사용자에 연결된 GitHub provider는 현재 사용자 연결을 차단하는지 검증합니다.
async function assertGithubLinkBlocksProviderConnectedToOtherUser() {
    resetGithubLoginState();
    githubEmails = verifiedEmails("target@example.com");
    providerUIDUser = userRecord(
        "other-uid",
        [
            githubProviderData("old@example.com"),
            googleProviderData("old@example.com")
        ]
    );
    currentUser = userRecord("current-uid", [], "target@example.com");

    await assert.rejects(
        () => linkGithubProviderWithAccessToken(
            "current-uid",
            "access-token"
        ),
        (error) => {
            assert.strictEqual(error.code, "failed-precondition");
            assert.strictEqual(error.message, "GitHub provider가 다른 계정에 연결되어 있습니다.");
            assert.deepStrictEqual(error.details, {
                reason: "github_email_changed_account_conflict"
            });
            return true;
        }
    );

    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "github.com",
        uid: "1"
    }]);
    assert.deepStrictEqual(userLookupCalls, ["current-uid"]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
    assert.deepStrictEqual(createdUsers, []);
    assert.deepStrictEqual(axiosRequests, []);
    assertHeaders("https://api.github.com/user");
    assertHeaders("https://api.github.com/user/emails");
}

async function assertGithubUnlinkRemovesOAuthGrant() {
    grantDeleteStatus = 204;
    axiosRequests.length = 0;
    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    const revokeResult = await revokeGitHubOAuthGrant(
        "firebase-uid",
        "valid-token",
        "client-id",
        "client-secret"
    );

    assert.strictEqual(revokeResult, undefined);
    assert.strictEqual(axiosRequests.length, 1);
    assert.strictEqual(axiosRequests[0].method, "delete");
    assert.strictEqual(axiosRequests[0].url, "https://api.github.com/applications/client-id/grant");
    assert.deepStrictEqual(axiosRequests[0].auth, {
        username: "client-id",
        password: "client-secret"
    });
    assert.deepStrictEqual(axiosRequests[0].data, {
        access_token: "valid-token"
    });
    assertRevokeHeaders(axiosRequests[0]);
    assert.deepStrictEqual(consoleErrors, []);
    assert.deepStrictEqual(consoleWarnings, []);
}

async function assertGithubUnlinkSucceedsWhenGrantDeleteFindsInvalidToken() {
    grantDeleteStatus = 422;
    tokenCheckStatus = 404;
    axiosRequests.length = 0;
    consoleErrors.length = 0;
    consoleWarnings.length = 0;

    const revokeResult = await revokeGitHubOAuthGrant(
        "firebase-uid",
        "invalid-token",
        "client-id",
        "client-secret"
    );

    assert.strictEqual(revokeResult, undefined);
    assert.strictEqual(axiosRequests.length, 2);
    assert.strictEqual(axiosRequests[0].method, "delete");
    assert.strictEqual(axiosRequests[0].url, "https://api.github.com/applications/client-id/grant");
    assert.deepStrictEqual(axiosRequests[0].data, {
        access_token: "invalid-token"
    });
    assertRevokeHeaders(axiosRequests[0]);

    assert.strictEqual(axiosRequests[1].method, "post");
    assert.strictEqual(axiosRequests[1].url, "https://api.github.com/applications/client-id/token");
    assert.deepStrictEqual(axiosRequests[1].data, {
        access_token: "invalid-token"
    });
    assertRevokeHeaders(axiosRequests[1]);

    const grantWarningMetadata = consoleWarnings
        .flat()
        .map((item) => item && typeof item === "object" ? item.github : undefined)
        .find((item) => item && typeof item === "object" && item.status === 422);
    assert.deepStrictEqual(grantWarningMetadata, {
        status: 422,
        message: "요청이 status code 422로 실패했습니다.",
        data: { message: "grant 삭제 실패" }
    });
    assert.deepStrictEqual(consoleErrors, []);
}

// GitHub grant 폐기 실패가 외부 provider 폐기 오류로 구분되는지 검증합니다.
async function assertGithubUnlinkFailureIsDistinguished() {
    grantDeleteStatus = 500;
    axiosRequests.length = 0;
    consoleErrors.length = 0;

    await assert.rejects(
        () => revokeGitHubOAuthGrant(
            "firebase-uid",
            "valid-token",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "github_revoke_failed"
    );
}

function axiosError(status, data) {
    const error = new Error(`요청이 status code ${status}로 실패했습니다.`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}

// Firebase Auth 오류 코드 형태의 예외를 구성합니다.
function firebaseAuthError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

// 로그인 기능 테스트가 공유하는 fake 응답 상태를 초기화합니다.
function resetGithubLoginState() {
    axiosCalls.length = 0;
    axiosRequests.length = 0;
    userLookupCalls.length = 0;
    providerLookupCalls.length = 0;
    emailLookupCalls.length = 0;
    createdUsers.length = 0;
    updatedUsers.length = 0;
    currentUser = undefined;
    providerUIDUser = undefined;
    emailUser = undefined;
    createdUserUID = "firebase-uid";
    grantDeleteStatus = 204;
    tokenCheckStatus = 404;
    githubEmails = defaultGithubEmails();
}

// Firebase Auth 사용자 응답에 필요한 uid, provider 목록, 이메일을 구성합니다.
function userRecord(uid, providerData = [], email) {
    return {
        uid,
        providerData,
        email
    };
}

// GitHub provider 연결 정보를 Firebase Auth provider payload로 구성합니다.
function githubProviderData(email) {
    return {
        providerId: "github.com",
        uid: "1",
        displayName: "GitHub User",
        email,
        photoURL: "https://example.com/avatar.png"
    };
}

// Google provider 연결 정보를 기존 계정의 다른 로그인 수단으로 구성합니다.
function googleProviderData(email) {
    return {
        providerId: "google.com",
        uid: "google-uid",
        email
    };
}

// 현재 GitHub verified email 기준 신규 사용자 생성 payload를 구성합니다.
function newGitHubUserProperties(email) {
    return {
        displayName: "GitHub User",
        email,
        photoURL: "https://example.com/avatar.png",
        providerToLink: githubProviderData(email)
    };
}

// 기본 GitHub verified email API 응답을 구성합니다.
function defaultGithubEmails() {
    return verifiedEmails("user@example.com");
}

// GitHub verified email API 응답을 테스트 입력에 맞게 구성합니다.
function verifiedEmails(email) {
    return [{
        email,
        primary: true,
        verified: true
    }];
}

// verified email이 없는 GitHub email API 응답을 구성합니다.
function unavailableGithubEmails() {
    return [{
        email: "primary@example.com",
        primary: true,
        verified: false
    }, {
        email: "secondary@example.com",
        primary: false,
        verified: false
    }];
}
