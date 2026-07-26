const assert = require("assert");
const admin = require("firebase-admin");
const firestore = require("firebase-admin/firestore");
const https = require("firebase-functions/v2/https");

const db = { name: "firestore" };
const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackURL: "https://example.com/api/auth/google/callback"
};
const customTokenCalls = [];
const accountLinkCalls = [];
const verifiedTokens = [];
let customTokenError;

const fakeAuth = {
    async verifyIdToken(token) {
        verifiedTokens.push(token);
        return { uid: "current-uid" };
    }
};

require.cache[require.resolve("firebase-admin")] = {
    exports: {
        ...admin,
        auth: () => fakeAuth
    }
};
require.cache[require.resolve("firebase-admin/firestore")] = {
    exports: {
        ...firestore,
        getFirestore: () => db
    }
};
require.cache[require.resolve("firebase-functions/v2/https")] = {
    exports: {
        ...https,
        onRequest: (_, handler) => handler
    }
};
require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error: () => {}
    }
};
require.cache[require.resolve("../lib/rest/googleConfiguration")] = {
    exports: {
        googleConfiguration: () => configuration,
        googleOAuthConfigurationSecret: { name: "GOOGLE_OAUTH_CONFIG" }
    }
};
require.cache[require.resolve("../lib/rest/googleAuthorizationCodeAuth")] = {
    exports: {
        requestGoogleCustomToken: async (...values) => {
            customTokenCalls.push(values);
            if (customTokenError) {
                throw customTokenError;
            }
            return { customToken: "firebase-custom-token" };
        },
        linkGoogleAccount: async (...values) => {
            accountLinkCalls.push(values);
        }
    }
};

const { api } = require("../lib/rest/api");

(async () => {
    await assertAuthorizationCodeCustomTokenResponse();
    await assertAuthorizationCodeAccountLinkResponse();
    await assertAccountLinkRequiresFirebaseAuthentication();
    await assertServerAuthCodeIsRequired();
    await assertAccountLinkServerAuthCodeIsRequired();
    await assertInvalidGoogleProofResponse();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// authorization code 로그인 요청이 serverAuthCode를 전달하고 custom token을 반환하는지 검증합니다.
async function assertAuthorizationCodeCustomTokenResponse() {
    resetState();
    const response = responseRecorder();

    await api(
        request(
            "POST",
            "/api/auth/google/authorization-code/custom-token",
            { serverAuthCode: " server-auth-code " }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 200);
    assert.deepStrictEqual(response.body, {
        customToken: "firebase-custom-token"
    });
    assert.deepStrictEqual(customTokenCalls, [[
        db,
        configuration,
        "server-auth-code"
    ]]);
    assert.deepStrictEqual(verifiedTokens, []);
}

// authorization code 계정 연결 요청이 인증 uid와 serverAuthCode를 전달하고 204를 반환하는지 검증합니다.
async function assertAuthorizationCodeAccountLinkResponse() {
    resetState();
    const response = responseRecorder();

    await api(
        request(
            "PUT",
            "/api/auth/google/authorization-code/account-link",
            { serverAuthCode: "server-auth-code" },
            { authorization: "Bearer firebase-id-token" }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 204);
    assert.strictEqual(response.sent, true);
    assert.deepStrictEqual(verifiedTokens, ["firebase-id-token"]);
    assert.deepStrictEqual(accountLinkCalls, [[
        db,
        configuration,
        "current-uid",
        "server-auth-code"
    ]]);
}

// authorization code 계정 연결이 Firebase 인증 없이 실행되지 않는지 검증합니다.
async function assertAccountLinkRequiresFirebaseAuthentication() {
    resetState();
    const response = responseRecorder();

    await api(
        request(
            "PUT",
            "/api/auth/google/authorization-code/account-link",
            { serverAuthCode: "server-auth-code" }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(response.body, {
        code: "unauthenticated",
        message: "인증 토큰이 필요합니다."
    });
    assert.deepStrictEqual(accountLinkCalls, []);
}

// authorization code 인증 요청에서 비어 있는 serverAuthCode를 거부하는지 검증합니다.
async function assertServerAuthCodeIsRequired() {
    resetState();
    const response = responseRecorder();

    await api(
        request(
            "POST",
            "/api/auth/google/authorization-code/custom-token",
            { serverAuthCode: " " }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 400);
    assert.deepStrictEqual(response.body, {
        code: "invalid-argument",
        message: "serverAuthCode가 필요합니다."
    });
    assert.deepStrictEqual(customTokenCalls, []);
}

// authorization code 계정 연결 요청에서 비어 있는 serverAuthCode를 거부하는지 검증합니다.
async function assertAccountLinkServerAuthCodeIsRequired() {
    resetState();
    const response = responseRecorder();

    await api(
        request(
            "PUT",
            "/api/auth/google/authorization-code/account-link",
            { serverAuthCode: " " },
            { authorization: "Bearer firebase-id-token" }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 400);
    assert.deepStrictEqual(response.body, {
        code: "invalid-argument",
        message: "serverAuthCode가 필요합니다."
    });
    assert.deepStrictEqual(verifiedTokens, ["firebase-id-token"]);
    assert.deepStrictEqual(accountLinkCalls, []);
}

// 유효하지 않은 Google 인증 증명을 정해진 REST 오류로 반환하는지 검증합니다.
async function assertInvalidGoogleProofResponse() {
    resetState();
    const response = responseRecorder();
    customTokenError = new https.HttpsError(
        "unauthenticated",
        "Google 인증 증명이 유효하지 않습니다.",
        { reason: "invalid_google_proof" }
    );

    await api(
        request(
            "POST",
            "/api/auth/google/authorization-code/custom-token",
            { serverAuthCode: "invalid-server-auth-code" }
        ),
        response
    );

    assert.strictEqual(response.statusCode, 401);
    assert.deepStrictEqual(response.body, {
        code: "invalid-google-proof",
        message: "Google 인증 증명이 유효하지 않습니다."
    });
}

// REST API 시험 요청을 구성합니다.
function request(method, path, body, headers = {}) {
    return {
        method,
        path,
        url: path,
        body,
        headers,
        query: {}
    };
}

// REST API 시험 응답과 기록 함수를 구성합니다.
function responseRecorder() {
    return {
        statusCode: undefined,
        body: undefined,
        sent: false,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send() {
            this.sent = true;
            return this;
        },
        redirect() {
            throw new Error("예상하지 않은 redirect 응답입니다.");
        }
    };
}

// REST API 시험 호출과 실패 상태를 초기화합니다.
function resetState() {
    customTokenCalls.length = 0;
    accountLinkCalls.length = 0;
    verifiedTokens.length = 0;
    customTokenError = undefined;
}
