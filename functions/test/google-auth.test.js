const assert = require("assert");

// Google JWKS 조회 실패를 나타내는 시험 오류를 구성합니다.
class GoogleJwksLookupError extends Error {}

const tokenExchangeCalls = [];
const tokenVerificationCalls = [];
const providerResolveCalls = [];
const providerLinkCalls = [];
const credentialSaveCalls = [];
const credentialRevokeCalls = [];
const grantRevokeCalls = [];
const customTokenCalls = [];
const authUpdateCalls = [];
const oauthStateCalls = [];
let currentUser = firebaseUser([googleProvider(), githubProvider()]);
let storedCredential = googleCredential();
let tokenExchangeError;
let tokenVerificationError;
let providerResolveError;
let providerLinkError;
let credentialSaveError;
let customTokenError;

const fakeAuth = {
    async createCustomToken(uid) {
        customTokenCalls.push(uid);
        if (customTokenError) {
            throw customTokenError;
        }
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
            if (tokenExchangeError) {
                throw tokenExchangeError;
            }
            return googleOAuthToken();
        },
        revokeGoogleOAuthToken: async (...values) => {
            grantRevokeCalls.push(values);
        },
        googleProviderError: () => authenticationError(
            "internal",
            "google_provider_failed"
        )
    }
};
require.cache[require.resolve("../lib/auth/googleIdToken")] = {
    exports: {
        GoogleJwksLookupError,
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
            if (providerResolveError) {
                throw providerResolveError;
            }
            return "google-uid";
        },
        linkGoogleProvider: async (...values) => {
            providerLinkCalls.push(values);
            if (providerLinkError) {
                throw providerLinkError;
            }
        }
    }
};
require.cache[require.resolve("../lib/rest/googleCredential")] = {
    exports: {
        googleCredentialForUser: async () => storedCredential,
        saveGoogleCredential: async (...values) => {
            credentialSaveCalls.push(values);
            if (credentialSaveError) {
                throw credentialSaveError;
            }
        },
        revokeGoogleCredential: async (...values) => {
            credentialRevokeCalls.push(values);
        }
    }
};
require.cache[require.resolve("../lib/rest/oauth/session")] = {
    exports: new Proxy({}, {
        get: (_, name) => async (...values) => {
            oauthStateCalls.push({ name, values });
        }
    })
};

const {
    linkGoogleAccount,
    requestGoogleCustomToken,
    revokeGoogleAccessToken,
    unlinkGoogleAccount
} = require("../lib/rest/googleAuth");

const db = { name: "firestore" };
const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret"
};

(async () => {
    await assertCustomTokenAuthentication();
    await assertAccountLinkAuthentication();
    await assertInvalidIDTokenIsDistinguished();
    await assertJwksLookupFailureIsPreserved();
    await assertTokenExchangeErrorIsPreserved();
    await assertProviderResolutionFailureDoesNotRevoke();
    await assertProviderLinkFailureDoesNotRevoke();
    await assertCredentialSaveFailureDoesNotRevoke();
    await assertCustomTokenFailureDoesNotRevoke();
    await assertLastProviderUnlinkIsBlockedBeforeRevocation();
    await assertGoogleUnlinkRevokesCredentialBeforeProviderRemoval();
    await assertExplicitAccessTokenRevokesCredential();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// serverAuthCode 로그인에서 검증된 사용자 credential과 Firebase custom token을 구성하는지 검증합니다.
async function assertCustomTokenAuthentication() {
    resetState();

    const result = await requestGoogleCustomToken(
        db,
        configuration,
        "server-auth-code"
    );

    assert.deepStrictEqual(result, {
        customToken: "custom-token:google-uid"
    });
    assert.deepStrictEqual(tokenExchangeCalls, [[
        "server-auth-code",
        "client-id",
        "client-secret"
    ]]);
    assert.deepStrictEqual(tokenVerificationCalls, [[
        "google-id-token",
        "client-id"
    ]]);
    assert.deepStrictEqual(providerResolveCalls, [[googlePayload()]]);
    assert.deepStrictEqual(credentialSaveCalls, [[
        db,
        "google-uid",
        googleCredential()
    ]]);
    assert.deepStrictEqual(customTokenCalls, ["google-uid"]);
    assertNoOAuthStateOrRevocation();
}

// serverAuthCode 계정 연결에서 검증된 provider와 credential을 현재 사용자에게 저장하는지 검증합니다.
async function assertAccountLinkAuthentication() {
    resetState();

    await linkGoogleAccount(
        db,
        configuration,
        "current-uid",
        "server-auth-code"
    );

    assert.deepStrictEqual(tokenExchangeCalls, [[
        "server-auth-code",
        "client-id",
        "client-secret"
    ]]);
    assert.deepStrictEqual(tokenVerificationCalls, [[
        "google-id-token",
        "client-id"
    ]]);
    assert.deepStrictEqual(providerLinkCalls, [[
        "current-uid",
        googlePayload()
    ]]);
    assert.deepStrictEqual(credentialSaveCalls, [[
        db,
        "current-uid",
        googleCredential()
    ]]);
    assert.deepStrictEqual(customTokenCalls, []);
    assertNoOAuthStateOrRevocation();
}

// Google ID token 검증 실패를 두 인증 흐름에서 동일한 인증 증명 오류로 변환하는지 검증합니다.
async function assertInvalidIDTokenIsDistinguished() {
    for (const authenticate of [
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        () => linkGoogleAccount(
            db,
            configuration,
            "current-uid",
            "server-auth-code"
        )
    ]) {
        resetState();
        tokenVerificationError = new Error("jwt verification failed");

        await assert.rejects(
            authenticate,
            (error) =>
                error.code === "unauthenticated" &&
                error.details?.reason === "invalid_google_proof"
        );
        assert.deepStrictEqual(providerResolveCalls, []);
        assert.deepStrictEqual(providerLinkCalls, []);
        assert.deepStrictEqual(credentialSaveCalls, []);
        assert.deepStrictEqual(customTokenCalls, []);
        assertNoOAuthStateOrRevocation();
    }
}

// Google JWKS 조회 실패를 두 인증 흐름에서 provider 오류로 보존하는지 검증합니다.
async function assertJwksLookupFailureIsPreserved() {
    for (const authenticate of [
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        () => linkGoogleAccount(
            db,
            configuration,
            "current-uid",
            "server-auth-code"
        )
    ]) {
        resetState();
        tokenVerificationError = new GoogleJwksLookupError(
            "jwks lookup failed"
        );

        await assert.rejects(
            authenticate,
            (error) =>
                error.code === "internal" &&
                error.details?.reason === "google_provider_failed"
        );
        assert.deepStrictEqual(providerResolveCalls, []);
        assert.deepStrictEqual(providerLinkCalls, []);
        assert.deepStrictEqual(credentialSaveCalls, []);
        assert.deepStrictEqual(customTokenCalls, []);
        assertNoOAuthStateOrRevocation();
    }
}

// serverAuthCode 교환 오류 분류가 인증 계층에서 변경되지 않는지 검증합니다.
async function assertTokenExchangeErrorIsPreserved() {
    resetState();
    const failure = authenticationError(
        "unauthenticated",
        "invalid_google_proof"
    );
    tokenExchangeError = failure;

    await assert.rejects(
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        (error) => error === failure
    );
    assert.deepStrictEqual(tokenVerificationCalls, []);
    assertNoOAuthStateOrRevocation();
}

// 사용자 결정 실패 뒤 교환된 Google token을 자동 폐기하지 않는지 검증합니다.
async function assertProviderResolutionFailureDoesNotRevoke() {
    resetState();
    const failure = new Error("provider resolve failed");
    providerResolveError = failure;

    await assert.rejects(
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        (error) => error === failure
    );
    assert.deepStrictEqual(credentialSaveCalls, []);
    assert.deepStrictEqual(customTokenCalls, []);
    assertNoOAuthStateOrRevocation();
}

// provider 연결 실패 뒤 교환된 Google token을 자동 폐기하지 않는지 검증합니다.
async function assertProviderLinkFailureDoesNotRevoke() {
    resetState();
    const failure = new Error("provider link failed");
    providerLinkError = failure;

    await assert.rejects(
        () => linkGoogleAccount(
            db,
            configuration,
            "current-uid",
            "server-auth-code"
        ),
        (error) => error === failure
    );
    assert.deepStrictEqual(credentialSaveCalls, []);
    assertNoOAuthStateOrRevocation();
}

// credential 저장 실패 뒤 교환된 Google token을 자동 폐기하지 않는지 검증합니다.
async function assertCredentialSaveFailureDoesNotRevoke() {
    for (const authenticate of [
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        () => linkGoogleAccount(
            db,
            configuration,
            "current-uid",
            "server-auth-code"
        )
    ]) {
        resetState();
        const failure = new Error("credential save failed");
        credentialSaveError = failure;

        await assert.rejects(
            authenticate,
            (error) => error === failure
        );
        assertNoOAuthStateOrRevocation();
    }
}

// custom token 발급 실패 뒤 저장된 Google credential을 자동 폐기하지 않는지 검증합니다.
async function assertCustomTokenFailureDoesNotRevoke() {
    resetState();
    const failure = new Error("custom token failed");
    customTokenError = failure;

    await assert.rejects(
        () => requestGoogleCustomToken(
            db,
            configuration,
            "server-auth-code"
        ),
        (error) => error === failure
    );
    assert.strictEqual(credentialSaveCalls.length, 1);
    assertNoOAuthStateOrRevocation();
}

// 마지막 Google provider 해제가 grant를 변경하기 전에 차단되는지 검증합니다.
async function assertLastProviderUnlinkIsBlockedBeforeRevocation() {
    resetState();
    currentUser = firebaseUser([googleProvider()]);

    await assert.rejects(
        () => unlinkGoogleAccount(db, "current-uid"),
        (error) => error.details?.reason === "last_provider"
    );
    assert.deepStrictEqual(credentialRevokeCalls, []);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// Google 계정 해제가 grant와 credential을 정리한 뒤 provider를 제거하는지 검증합니다.
async function assertGoogleUnlinkRevokesCredentialBeforeProviderRemoval() {
    resetState();

    await unlinkGoogleAccount(db, "current-uid");

    assert.deepStrictEqual(credentialRevokeCalls, [[
        db,
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
    resetState();
    storedCredential = {
        ...googleCredential(),
        clientId: "retired-client-id"
    };

    await revokeGoogleAccessToken(db, "current-uid");

    assert.deepStrictEqual(credentialRevokeCalls, [[
        db,
        "current-uid",
        storedCredential
    ]]);
    assert.deepStrictEqual(authUpdateCalls, []);
}

// OAuth session·ticket 처리와 Google grant·credential 자동 폐기가 없는지 검증합니다.
function assertNoOAuthStateOrRevocation() {
    assert.deepStrictEqual(oauthStateCalls, []);
    assert.deepStrictEqual(grantRevokeCalls, []);
    assert.deepStrictEqual(credentialRevokeCalls, []);
}

// 인증 시험 호출과 실패 상태를 초기화합니다.
function resetState() {
    tokenExchangeCalls.length = 0;
    tokenVerificationCalls.length = 0;
    providerResolveCalls.length = 0;
    providerLinkCalls.length = 0;
    credentialSaveCalls.length = 0;
    credentialRevokeCalls.length = 0;
    grantRevokeCalls.length = 0;
    customTokenCalls.length = 0;
    authUpdateCalls.length = 0;
    oauthStateCalls.length = 0;
    currentUser = firebaseUser([googleProvider(), githubProvider()]);
    storedCredential = googleCredential();
    tokenExchangeError = undefined;
    tokenVerificationError = undefined;
    providerResolveError = undefined;
    providerLinkError = undefined;
    credentialSaveError = undefined;
    customTokenError = undefined;
}

// Google token endpoint 교환 결과를 구성합니다.
function googleOAuthToken() {
    return {
        accessToken: "google-access-token",
        idToken: "google-id-token",
        refreshToken: "google-refresh-token"
    };
}

// Google credential 저장 값을 구성합니다.
function googleCredential() {
    return {
        accessToken: "google-access-token",
        clientId: "client-id",
        refreshToken: "google-refresh-token"
    };
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

// 검증된 Google ID token payload를 구성합니다.
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

// 인증 오류 분류 대역을 구성합니다.
function authenticationError(code, reason) {
    const error = new Error(reason);
    error.code = code;
    error.details = { reason };
    return error;
}
