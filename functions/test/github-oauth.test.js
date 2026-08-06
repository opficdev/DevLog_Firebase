const assert = require("assert");

const providerLinkCalls = [];
const credentialSaveCalls = [];
const credentialRevokeCalls = [];
const credentialLookupCalls = [];
const pendingRevokeCalls = [];
const ticketClaimCalls = [];
const ticketConsumeCalls = [];
const ticketReleaseCalls = [];
const authUpdateCalls = [];
let currentUser = githubUser([githubProvider(), googleProvider()]);
let linkError;

const fakeAuth = {
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
require.cache[require.resolve("../lib/rest/github/githubProvider")] = {
    exports: {
        linkGithubProviderWithAccessToken: async (...values) => {
            providerLinkCalls.push(values);
            if (linkError) {
                throw linkError;
            }
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
        githubCredentialForUser: async (...values) => {
            credentialLookupCalls.push(values.slice(1));
            return {
                accessToken: "stored-token",
                clientId: "client-id"
            };
        },
        saveGithubCredential: async (...values) => {
            credentialSaveCalls.push(values.slice(1));
        },
        revokeGithubCredential: async (...values) => {
            credentialRevokeCalls.push(values.slice(1));
        },
        revokePendingGithubCredentials: async (...values) => {
            pendingRevokeCalls.push(values.slice(1));
        }
    }
};
require.cache[require.resolve("../lib/rest/oauth/session")] = {
    exports: {
        claimOAuthTicket: async (...values) => {
            ticketClaimCalls.push(values.slice(1));
            return claimedTicket;
        },
        consumeOAuthTicket: async (...values) => {
            ticketConsumeCalls.push(values.slice(1));
        },
        releaseOAuthTicket: async (...values) => {
            ticketReleaseCalls.push(values.slice(1));
        }
    }
};

const {
    linkGithubAccount,
    revokeGithubAccessToken,
    unlinkGithubAccount
} = require("../lib/rest/github/githubOAuth");

const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackURL: "https://example.com/api/auth/github/callback"
};
const claimedTicket = {
    claim: "claim-1",
    ticket: "ticket-1",
    sessionId: "session-1",
    provider: "github",
    purpose: "link",
    uid: "current-uid",
    payload: {
        accessToken: "github-access-token",
        clientId: "client-id"
    }
};

(async () => {
    await assertLinkTicketKeepsFirebaseUIDBinding();
    await assertLinkFailureReleasesTicket();
    await assertLastProviderUnlinkIsBlockedBeforeRevocation();
    await assertGithubUnlinkRevokesCredentialBeforeProviderRemoval();
    await assertGithubAccessTokenRevokesCredential();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 계정 연결 ticket의 UID 결합과 처리 순서를 유지하는지 검증합니다.
async function assertLinkTicketKeepsFirebaseUIDBinding() {
    resetCalls();

    await linkGithubAccount(
        {},
        "current-uid",
        "ticket-1",
        "app-verifier"
    );

    assert.deepStrictEqual(ticketClaimCalls, [[
        "ticket-1",
        "app-verifier",
        "github",
        "link",
        "current-uid"
    ]]);
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
    assert.deepStrictEqual(pendingRevokeCalls, [["current-uid"]]);
    assert.deepStrictEqual(ticketConsumeCalls, [[claimedTicket]]);
    assert.deepStrictEqual(ticketReleaseCalls, []);
}

// 계정 연결 처리 실패 뒤 ticket을 다시 사용할 수 있도록 해제하는지 검증합니다.
async function assertLinkFailureReleasesTicket() {
    resetCalls();
    linkError = new Error("provider 연결 실패");
    try {
        await assert.rejects(
            () => linkGithubAccount(
                {},
                "current-uid",
                "ticket-1",
                "app-verifier"
            ),
            linkError
        );
    } finally {
        linkError = undefined;
    }

    assert.deepStrictEqual(ticketReleaseCalls, [[claimedTicket]]);
    assert.deepStrictEqual(ticketConsumeCalls, []);
}

// 마지막 GitHub provider 해제가 grant 변경 전에 차단되는지 검증합니다.
async function assertLastProviderUnlinkIsBlockedBeforeRevocation() {
    resetCalls();
    currentUser = githubUser([githubProvider()]);

    await assert.rejects(
        () => unlinkGithubAccount({}, "current-uid"),
        (error) => error.details?.reason === "last_provider"
    );
    assert.deepStrictEqual(credentialRevokeCalls, []);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// GitHub 계정 해제가 credential을 정리한 뒤 provider를 제거하는지 검증합니다.
async function assertGithubUnlinkRevokesCredentialBeforeProviderRemoval() {
    resetCalls();
    currentUser = githubUser([githubProvider(), googleProvider()]);

    await unlinkGithubAccount({}, "current-uid");

    assert.deepStrictEqual(pendingRevokeCalls, [["current-uid"]]);
    assert.deepStrictEqual(credentialRevokeCalls, [[
        "current-uid",
        configuration,
        { accessToken: "stored-token", clientId: "client-id" }
    ]]);
    assert.deepStrictEqual(authUpdateCalls, [{
        uid: "current-uid",
        properties: { providersToUnlink: ["github.com"] }
    }]);
}

// 일반 token 폐기가 현재 credential 조회와 정리를 수행하는지 검증합니다.
async function assertGithubAccessTokenRevokesCredential() {
    resetCalls();

    await revokeGithubAccessToken({}, "current-uid");

    assert.deepStrictEqual(credentialLookupCalls, [["current-uid"]]);
    assert.deepStrictEqual(pendingRevokeCalls, [["current-uid"]]);
    assert.deepStrictEqual(credentialRevokeCalls, [[
        "current-uid",
        configuration,
        { accessToken: "stored-token", clientId: "client-id" }
    ]]);
}

// 시험 호출 기록과 사용자 상태를 초기화합니다.
function resetCalls() {
    providerLinkCalls.length = 0;
    credentialSaveCalls.length = 0;
    credentialRevokeCalls.length = 0;
    credentialLookupCalls.length = 0;
    pendingRevokeCalls.length = 0;
    ticketClaimCalls.length = 0;
    ticketConsumeCalls.length = 0;
    ticketReleaseCalls.length = 0;
    authUpdateCalls.length = 0;
    currentUser = githubUser([githubProvider(), googleProvider()]);
}

// Firebase Auth 사용자 대역을 구성합니다.
function githubUser(providerData) {
    return { uid: "current-uid", providerData };
}

// GitHub provider 대역을 구성합니다.
function githubProvider() {
    return { providerId: "github.com", uid: "github-uid" };
}

// Google provider 대역을 구성합니다.
function googleProvider() {
    return { providerId: "google.com", uid: "google-uid" };
}
