const assert = require("assert");
const { challengeFor } = require("../lib/rest/oauth/session");

const tokenExchangeCalls = [];
const credentialSaveCalls = [];
const credentialRevokeCalls = [];
const providerLinkCalls = [];
const authUpdateCalls = [];
const grantRevokeCalls = [];
const loggerErrors = [];
let currentUser = githubUser([githubProvider(), googleProvider()]);
let tokenRevokeError;

const fakeAuth = {
    async createCustomToken(uid) {
        return `custom-token:${uid}`;
    },
    async getUser() {
        return currentUser;
    },
    async updateUser(uid, properties) {
        authUpdateCalls.push({ uid, properties });
        return { uid };
    }
};

require.cache[require.resolve("firebase-admin")] = {
    exports: {
        auth: () => fakeAuth
    }
};
require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error: (...values) => {
            loggerErrors.push(values);
        }
    }
};
require.cache[require.resolve("../lib/rest/github/githubClient")] = {
    exports: {
        requestGitHubAccessToken: async (...values) => {
            tokenExchangeCalls.push(values);
            return "github-access-token";
        },
        revokeGitHubOAuthToken: async (...values) => {
            grantRevokeCalls.push(values);
            if (tokenRevokeError) {
                throw tokenRevokeError;
            }
        }
    }
};
require.cache[require.resolve("../lib/rest/github/githubProvider")] = {
    exports: {
        resolveGithubFirebaseUID: async () => "github-uid",
        linkGithubProviderWithAccessToken: async (...values) => {
            providerLinkCalls.push(values);
        }
    }
};
require.cache[require.resolve("../lib/rest/github/githubConfiguration")] = {
    exports: {
        githubRevocationConfiguration: () => configuration
    }
};
require.cache[require.resolve("../lib/rest/github/githubCredential")] = {
    exports: {
        githubCredentialForUser: async () => ({
            accessToken: "stored-token",
            clientId: "client-id"
        }),
        saveGithubCredential: async (...values) => {
            credentialSaveCalls.push(values.slice(1));
        },
        revokeGithubCredential: async (...values) => {
            credentialRevokeCalls.push(values.slice(1));
        },
        revokePendingGithubCredentials: async () => {}
    }
};

const {
    createGithubAccountLinkSession,
    createGithubSignInSession,
    githubCallbackFailureURL,
    githubCallbackURL,
    linkGithubAccount,
    requestGithubCustomToken,
    unlinkGithubAccount
} = require("../lib/rest/github/githubOAuth");

const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackURL: "https://example.com/api/auth/github/callback"
};

(async () => {
    assertCallbackFailureExposesOnlySafeError();
    await assertSignInSessionKeepsPKCEVerifierOnServer();
    await assertLinkTicketKeepsFirebaseUIDBinding();
    await assertCallbackTicketFailureRevokesExchangedGrant();
    await assertCallbackCompensationFailureKeepsDurableCleanupPayload();
    await assertLastProviderUnlinkIsBlockedBeforeRevocation();
    await assertGithubUnlinkRevokesCredentialBeforeProviderRemoval();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// callback 실패 주소가 인증 정보 없이 안전한 오류 값만 포함하는지 검증합니다.
function assertCallbackFailureExposesOnlySafeError() {
    const callback = new URL(githubCallbackFailureURL());
    assert.deepStrictEqual(Array.from(callback.searchParams.keys()), ["error"]);
    assert.strictEqual(callback.searchParams.get("error"), "oauth-failed");
}

// callback 보상 폐기도 실패하면 session TTL 정리용 token 정보를 보존하는지 검증합니다.
async function assertCallbackCompensationFailureKeepsDurableCleanupPayload() {
    resetCalls();
    const db = fakeFirestore();
    const response = await createGithubSignInSession(
        db,
        configuration,
        challengeFor("n".repeat(64))
    );
    const state = new URL(response.authorizationURL).searchParams.get("state");
    db.failTicketCreation = true;
    tokenRevokeError = new Error("token revoke failed");

    await githubCallbackURL(
        db,
        configuration,
        state,
        "github-code"
    );

    assert.deepStrictEqual(db.data.get(`oauthSessions/${state}`).cleanupPayload, {
        accessToken: "github-access-token",
        clientId: "client-id"
    });
    assert.deepStrictEqual(loggerErrors, [
        [
            "GitHub OAuth callback 보상 폐기 실패",
            { name: "Error", errorMessage: "token revoke failed" }
        ],
        [
            "GitHub OAuth callback 처리 실패",
            { name: "Error", errorMessage: "ticket create failed" }
        ]
    ]);
}

// code 교환 뒤 ticket 저장이 실패하면 발급된 GitHub grant를 보상 폐기하는지 검증합니다.
async function assertCallbackTicketFailureRevokesExchangedGrant() {
    resetCalls();
    const db = fakeFirestore();
    const response = await createGithubSignInSession(
        db,
        configuration,
        challengeFor("m".repeat(64))
    );
    const state = new URL(response.authorizationURL).searchParams.get("state");
    db.failTicketCreation = true;

    const callbackURL = await githubCallbackURL(
        db,
        configuration,
        state,
        "github-code"
    );

    assert.strictEqual(new URL(callbackURL).searchParams.get("error"), "oauth-failed");
    assert.deepStrictEqual(grantRevokeCalls, [[
        "oauth-session",
        "github-access-token",
        "client-id",
        "client-secret"
    ]]);
    assert.deepStrictEqual(loggerErrors, [[
        "GitHub OAuth callback 처리 실패",
        { name: "Error", errorMessage: "ticket create failed" }
    ]]);
}

// GitHub PKCE verifier가 서버 session에만 저장되고 ticket 로그인까지 이어지는지 검증합니다.
async function assertSignInSessionKeepsPKCEVerifierOnServer() {
    resetCalls();
    const db = fakeFirestore();
    const appVerifier = "g".repeat(64);
    const response = await createGithubSignInSession(
        db,
        configuration,
        challengeFor(appVerifier)
    );
    const authorizationURL = new URL(response.authorizationURL);
    const state = authorizationURL.searchParams.get("state");
    const session = db.data.get(`oauthSessions/${state}`);

    assert.strictEqual(authorizationURL.searchParams.get("client_id"), "client-id");
    assert.strictEqual(authorizationURL.searchParams.get("redirect_uri"), configuration.callbackURL);
    assert.strictEqual(authorizationURL.searchParams.get("prompt"), "select_account");
    assert.strictEqual(authorizationURL.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(
        authorizationURL.searchParams.get("code_challenge"),
        challengeFor(session.providerPKCEVerifier)
    );
    assert.notStrictEqual(session.providerPKCEVerifier, appVerifier);
    assert.strictEqual(response.providerPKCEVerifier, undefined);

    const callbackURL = await githubCallbackURL(
        db,
        configuration,
        state,
        "github-code"
    );
    const callback = new URL(callbackURL);
    const ticket = callback.searchParams.get("ticket");
    assert.ok(ticket);
    assert.deepStrictEqual(
        Array.from(callback.searchParams.keys()),
        ["ticket"]
    );
    assert.strictEqual(callbackURL.includes("github-access-token"), false);
    assert.strictEqual(callbackURL.includes("github-code"), false);
    assert.strictEqual(callbackURL.includes(session.providerPKCEVerifier), false);
    assert.deepStrictEqual(tokenExchangeCalls, [[
        "github-code",
        "client-id",
        "client-secret",
        configuration.callbackURL,
        session.providerPKCEVerifier
    ]]);

    const result = await requestGithubCustomToken(
        db,
        ticket,
        appVerifier
    );
    assert.deepStrictEqual(result, { customToken: "custom-token:github-uid" });
    assert.deepStrictEqual(credentialSaveCalls, [[
        "github-uid",
        {
            accessToken: "github-access-token",
            clientId: "client-id"
        }
    ]]);
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "consumed");
}

// 계정 연결 session uid가 callback ticket과 연결 요청까지 유지되는지 검증합니다.
async function assertLinkTicketKeepsFirebaseUIDBinding() {
    resetCalls();
    const db = fakeFirestore();
    const appVerifier = "h".repeat(64);
    const response = await createGithubAccountLinkSession(
        db,
        configuration,
        "current-uid",
        challengeFor(appVerifier)
    );
    const state = new URL(response.authorizationURL).searchParams.get("state");
    const callbackURL = await githubCallbackURL(
        db,
        configuration,
        state,
        "github-code"
    );
    const ticket = new URL(callbackURL).searchParams.get("ticket");

    await linkGithubAccount(
        db,
        "current-uid",
        ticket,
        appVerifier
    );

    assert.deepStrictEqual(providerLinkCalls, [[
        "current-uid",
        "github-access-token"
    ]]);
    assert.deepStrictEqual(credentialSaveCalls, [[
        "current-uid",
        {
            accessToken: "github-access-token",
            clientId: "client-id"
        }
    ]]);
}

// 마지막 GitHub provider 해제가 grant를 변경하기 전에 차단되는지 검증합니다.
async function assertLastProviderUnlinkIsBlockedBeforeRevocation() {
    resetCalls();
    const db = fakeFirestore();
    currentUser = githubUser([githubProvider()]);

    await assert.rejects(
        () => unlinkGithubAccount(db, "current-uid"),
        (error) => error.details?.reason === "last_provider"
    );
    assert.deepStrictEqual(credentialRevokeCalls, []);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// GitHub 계정 해제가 grant와 credential을 정리한 뒤 provider를 제거하는지 검증합니다.
async function assertGithubUnlinkRevokesCredentialBeforeProviderRemoval() {
    resetCalls();
    const db = fakeFirestore();
    currentUser = githubUser([githubProvider(), googleProvider()]);

    await unlinkGithubAccount(db, "current-uid");

    assert.strictEqual(credentialRevokeCalls.length, 1);
    assert.deepStrictEqual(credentialRevokeCalls[0].slice(0, 2), [
        "current-uid",
        configuration
    ]);
    assert.deepStrictEqual(authUpdateCalls, [{
        uid: "current-uid",
        properties: { providersToUnlink: ["github.com"] }
    }]);
}

// GitHub OAuth session과 ticket transaction을 메모리에서 실행할 Firestore 대역을 구성합니다.
function fakeFirestore() {
    const data = new Map();
    const db = {
        data,
        failTicketCreation: false,
        doc(path) {
            return {
                path,
                async create(value) {
                    data.set(path, { ...value });
                }
            };
        },
        async runTransaction(operation) {
            return operation({
                async get(reference) {
                    const value = data.get(reference.path);
                    return {
                        exists: value !== undefined,
                        data: () => value
                    };
                },
                create(reference, value) {
                    if (
                        db.failTicketCreation &&
                        reference.path.startsWith("oauthTickets/")
                    ) {
                        throw new Error("ticket create failed");
                    }
                    data.set(reference.path, { ...value });
                },
                update(reference, value) {
                    data.set(reference.path, {
                        ...data.get(reference.path),
                        ...value
                    });
                }
            });
        }
    };
    return db;
}

// GitHub provider 목록을 가진 Firebase 사용자 대역을 구성합니다.
function githubUser(providerData) {
    return { uid: "current-uid", providerData };
}

// GitHub provider 대역을 구성합니다.
function githubProvider() {
    return { providerId: "github.com" };
}

// Google provider 대역을 구성합니다.
function googleProvider() {
    return { providerId: "google.com" };
}

// GitHub OAuth 기능 테스트의 공유 호출 기록을 초기화합니다.
function resetCalls() {
    tokenExchangeCalls.length = 0;
    credentialSaveCalls.length = 0;
    credentialRevokeCalls.length = 0;
    providerLinkCalls.length = 0;
    authUpdateCalls.length = 0;
    grantRevokeCalls.length = 0;
    loggerErrors.length = 0;
    tokenRevokeError = undefined;
}
