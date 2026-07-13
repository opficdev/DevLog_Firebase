const assert = require("assert");
const { challengeFor } = require("../lib/rest/oauth/session");

const tokenExchangeCalls = [];
const tokenVerificationCalls = [];
const providerResolveCalls = [];
const providerLinkCalls = [];
const credentialSaveCalls = [];
const credentialRevokeCalls = [];
const authUpdateCalls = [];
let currentUser = firebaseUser([googleProvider(), githubProvider()]);
let storedCredential = googleCredential();
let tokenVerificationError;

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
require.cache[require.resolve("../lib/rest/googleClient")] = {
    exports: {
        requestGoogleOAuthToken: async (...values) => {
            tokenExchangeCalls.push(values);
            return {
                accessToken: "google-access-token",
                idToken: "google-id-token",
                refreshToken: "google-refresh-token"
            };
        }
    }
};
require.cache[require.resolve("../lib/auth/googleIdToken")] = {
    exports: {
        verifyGoogleIdToken: async (...values) => {
            tokenVerificationCalls.push(values);
            if (tokenVerificationError) {
                throw tokenVerificationError;
            }
            return googlePayload();
        }
    }
};
require.cache[require.resolve("../lib/rest/googleProvider")] = {
    exports: {
        resolveGoogleFirebaseUID: async (...values) => {
            providerResolveCalls.push(values);
            return "google-uid";
        },
        linkGoogleProvider: async (...values) => {
            providerLinkCalls.push(values);
        }
    }
};
require.cache[require.resolve("../lib/rest/googleCredential")] = {
    exports: {
        googleCredentialForUser: async () => storedCredential,
        saveGoogleCredential: async (...values) => {
            credentialSaveCalls.push(values.slice(1));
        },
        revokeGoogleCredential: async (...values) => {
            credentialRevokeCalls.push(values.slice(1));
        }
    }
};

const {
    createGoogleAccountLinkSession,
    createGoogleSignInSession,
    googleCallbackFailureURL,
    googleCallbackURL,
    linkGoogleAccount,
    requestGoogleCustomToken,
    revokeGoogleAccessToken,
    unlinkGoogleAccount
} = require("../lib/rest/googleAuth");

const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackURL: "https://example.com/api/auth/google/callback"
};

(async () => {
    assertCallbackFailureExposesOnlySafeError();
    await assertSignInSessionKeepsTokensOnServer();
    await assertLinkTicketKeepsFirebaseUIDBinding();
    await assertRejectedIDTokenDoesNotCreateTicket();
    await assertCallbackFailureDoesNotRevokeProjectGrant();
    await assertLastProviderUnlinkIsBlockedBeforeRevocation();
    await assertGoogleUnlinkRevokesCredentialBeforeProviderRemoval();
    await assertExplicitAccessTokenRevokesCredential();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// callback 실패 주소가 인증 정보 없이 안전한 오류 값만 포함하는지 검증합니다.
function assertCallbackFailureExposesOnlySafeError() {
    const callback = new URL(googleCallbackFailureURL());
    assert.deepStrictEqual(Array.from(callback.searchParams.keys()), ["error"]);
    assert.strictEqual(callback.searchParams.get("error"), "oauth-failed");
}

// 만료되거나 audience가 다른 ID token은 callback ticket 생성 전에 거부하는지 검증합니다.
async function assertRejectedIDTokenDoesNotCreateTicket() {
    for (const message of ["jwt expired", "jwt audience invalid"]) {
        resetCalls();
        const db = fakeFirestore();
        const response = await createGoogleSignInSession(
            db,
            configuration,
            challengeFor("v".repeat(64))
        );
        const state = new URL(response.authorizationURL).searchParams.get("state");
        tokenVerificationError = new Error(message);

        const callbackURL = await googleCallbackURL(
            db,
            configuration,
            state,
            "google-code"
        );

        assert.strictEqual(new URL(callbackURL).searchParams.get("error"), "oauth-failed");
        assert.strictEqual(
            Array.from(db.data.keys()).some((key) => key.startsWith("oauthTickets/")),
            false
        );
    }
}

// Google token과 provider PKCE verifier가 서버에만 남고 custom token 교환까지 이어지는지 검증합니다.
async function assertSignInSessionKeepsTokensOnServer() {
    resetCalls();
    const db = fakeFirestore();
    const appVerifier = "g".repeat(64);
    const response = await createGoogleSignInSession(
        db,
        configuration,
        challengeFor(appVerifier)
    );
    const authorizationURL = new URL(response.authorizationURL);
    const state = authorizationURL.searchParams.get("state");
    const session = db.data.get(`oauthSessions/${state}`);

    assert.strictEqual(authorizationURL.searchParams.get("scope"), "openid email profile");
    assert.strictEqual(authorizationURL.searchParams.get("access_type"), "offline");
    assert.strictEqual(authorizationURL.searchParams.get("prompt"), "select_account");
    assert.strictEqual(authorizationURL.searchParams.has("include_granted_scopes"), false);
    assert.strictEqual(authorizationURL.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(
        authorizationURL.searchParams.get("code_challenge"),
        challengeFor(session.providerPKCEVerifier)
    );

    const callbackURL = await googleCallbackURL(
        db,
        configuration,
        state,
        "google-code"
    );
    const callback = new URL(callbackURL);
    const ticket = callback.searchParams.get("ticket");
    assert.ok(ticket);
    assert.deepStrictEqual(Array.from(callback.searchParams.keys()), ["ticket"]);
    assert.strictEqual(callbackURL.includes("google-access-token"), false);
    assert.strictEqual(callbackURL.includes("google-id-token"), false);
    assert.deepStrictEqual(tokenExchangeCalls, [[
        "google-code",
        "client-id",
        "client-secret",
        configuration.callbackURL,
        session.providerPKCEVerifier
    ]]);
    assert.deepStrictEqual(tokenVerificationCalls, [[
        "google-id-token",
        "client-id"
    ]]);

    const storedPayload = db.data.get(`oauthTickets/${ticket}`).payload;
    assert.strictEqual("idToken" in storedPayload, false);
    assert.strictEqual(storedPayload.subject, "google-subject");

    const result = await requestGoogleCustomToken(
        db,
        ticket,
        appVerifier
    );
    assert.deepStrictEqual(result, { customToken: "custom-token:google-uid" });
    assert.strictEqual(providerResolveCalls[0][0].sub, "google-subject");
    assert.deepStrictEqual(credentialSaveCalls, [[
        "google-uid",
        googleCredential()
    ]]);
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "consumed");
}

// 계정 연결 session의 Firebase uid와 검증된 Google payload를 연결 요청까지 유지하는지 검증합니다.
async function assertLinkTicketKeepsFirebaseUIDBinding() {
    resetCalls();
    const db = fakeFirestore();
    const appVerifier = "h".repeat(64);
    const response = await createGoogleAccountLinkSession(
        db,
        configuration,
        "current-uid",
        challengeFor(appVerifier)
    );
    const state = new URL(response.authorizationURL).searchParams.get("state");
    const callbackURL = await googleCallbackURL(
        db,
        configuration,
        state,
        "google-code"
    );
    const ticket = new URL(callbackURL).searchParams.get("ticket");

    await linkGoogleAccount(
        db,
        "current-uid",
        ticket,
        appVerifier
    );

    assert.strictEqual(providerLinkCalls[0][0], "current-uid");
    assert.strictEqual(providerLinkCalls[0][1].sub, "google-subject");
    assert.deepStrictEqual(credentialSaveCalls, [[
        "current-uid",
        googleCredential()
    ]]);
}

// callback 완료 저장 실패에서는 project 전체 grant 자동 폐기를 수행하지 않는지 검증합니다.
async function assertCallbackFailureDoesNotRevokeProjectGrant() {
    resetCalls();
    const db = fakeFirestore();
    const response = await createGoogleSignInSession(
        db,
        configuration,
        challengeFor("m".repeat(64))
    );
    const state = new URL(response.authorizationURL).searchParams.get("state");
    db.failTicketCreation = true;

    const callbackURL = await googleCallbackURL(
        db,
        configuration,
        state,
        "google-code"
    );

    assert.strictEqual(new URL(callbackURL).searchParams.get("error"), "oauth-failed");
    assert.strictEqual(db.data.get(`oauthSessions/${state}`).cleanupPayload, undefined);
}

// 마지막 Google provider 해제가 grant를 변경하기 전에 차단되는지 검증합니다.
async function assertLastProviderUnlinkIsBlockedBeforeRevocation() {
    resetCalls();
    currentUser = firebaseUser([googleProvider()]);

    await assert.rejects(
        () => unlinkGoogleAccount(dbPlaceholder(), "current-uid"),
        (error) => error.details?.reason === "last_provider"
    );
    assert.deepStrictEqual(credentialRevokeCalls, []);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// Google 계정 해제가 grant와 credential을 정리한 뒤 provider를 제거하는지 검증합니다.
async function assertGoogleUnlinkRevokesCredentialBeforeProviderRemoval() {
    resetCalls();
    currentUser = firebaseUser([googleProvider(), githubProvider()]);
    const db = dbPlaceholder();

    await unlinkGoogleAccount(db, "current-uid");

    assert.deepStrictEqual(credentialRevokeCalls, [[
        "current-uid",
        googleCredential()
    ]]);
    assert.deepStrictEqual(authUpdateCalls, [{
        uid: "current-uid",
        properties: { providersToUnlink: ["google.com"] }
    }]);
}

// access-token 삭제 요청이 provider 연결은 유지하고 grant credential만 폐기하는지 검증합니다.
async function assertExplicitAccessTokenRevokesCredential() {
    resetCalls();
    const db = dbPlaceholder();

    storedCredential = {
        ...googleCredential(),
        clientId: "retired-client-id"
    };

    await revokeGoogleAccessToken(db, "current-uid");

    assert.deepStrictEqual(credentialRevokeCalls, [[
        "current-uid",
        storedCredential
    ]]);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// OAuth session과 ticket transaction을 메모리에서 실행할 Firestore 대역을 구성합니다.
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
                    if (db.failTicketCreation && reference.path.startsWith("oauthTickets/")) {
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

// credential mock에 전달할 Firestore 식별 대역을 구성합니다.
function dbPlaceholder() {
    return { name: "db" };
}

// Firebase Auth 사용자 대역을 구성합니다.
function firebaseUser(providerData) {
    return { uid: "current-uid", providerData };
}

// Firebase Auth Google provider 대역을 구성합니다.
function googleProvider() {
    return { providerId: "google.com" };
}

// Firebase Auth의 다른 로그인 수단 대역을 구성합니다.
function githubProvider() {
    return { providerId: "github.com" };
}

// 검증된 Google ID token payload 대역을 구성합니다.
function googlePayload() {
    return {
        iss: "https://accounts.google.com",
        sub: "google-subject",
        aud: "client-id",
        iat: 1,
        exp: 9_999_999_999,
        email: "user@example.com",
        email_verified: true,
        name: "Google User",
        picture: "https://example.com/profile.png"
    };
}

// 서버에 저장할 Google credential 대역을 구성합니다.
function googleCredential() {
    return {
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        clientId: "client-id"
    };
}

// Google OAuth 기능 테스트의 공유 상태를 초기화합니다.
function resetCalls() {
    tokenExchangeCalls.length = 0;
    tokenVerificationCalls.length = 0;
    providerResolveCalls.length = 0;
    providerLinkCalls.length = 0;
    credentialSaveCalls.length = 0;
    credentialRevokeCalls.length = 0;
    authUpdateCalls.length = 0;
    currentUser = firebaseUser([googleProvider(), githubProvider()]);
    storedCredential = googleCredential();
    tokenVerificationError = undefined;
}
