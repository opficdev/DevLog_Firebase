const assert = require("assert");

const axiosCalls = [];
const loggerErrors = [];
const loggerWarnings = [];
let tokenResponse = googleTokenResponse();
let requestError;
const fakeAxios = {
    async post(url, data, configuration) {
        axiosCalls.push({
            url,
            data: data.toString(),
            headers: configuration?.headers
        });
        if (requestError) {
            throw requestError;
        }
        return {
            status: 200,
            data: tokenResponse
        };
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
        error: (...values) => {
            loggerErrors.push(values);
        },
        warn: (...values) => {
            loggerWarnings.push(values);
        }
    }
};

const {
    requestGoogleOAuthToken,
    revokeGoogleOAuthToken
} = require("../lib/rest/google/googleClient");

(async () => {
    await assertServerAuthCodeExchangeReturnsServerTokens();
    await assertInvalidServerAuthCodeIsDistinguished();
    await assertServerAuthCodeProviderFailureIsDistinguished();
    await assertServerAuthCodeNetworkFailureIsDistinguished();
    await assertServerAuthCodeRequiresTokens();
    await assertGrantRevocationUsesRefreshToken();
    await assertAlreadyInvalidTokenIsAccepted();
    await assertGrantRevocationFailureIsDistinguished();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// serverAuthCode 교환 요청이 callback과 PKCE 값 없이 서버 token을 반환하는지 검증합니다.
async function assertServerAuthCodeExchangeReturnsServerTokens() {
    resetState();

    const token = await requestGoogleOAuthToken(
        "server-auth-code",
        "client-id",
        "client-secret"
    );

    assert.deepStrictEqual(token, {
        accessToken: "access-token",
        idToken: "id-token",
        refreshToken: "refresh-token"
    });
    assert.strictEqual(axiosCalls.length, 1);
    assert.strictEqual(axiosCalls[0].url, "https://oauth2.googleapis.com/token");
    assert.deepStrictEqual(
        Object.fromEntries(new URLSearchParams(axiosCalls[0].data)),
        {
            client_id: "client-id",
            client_secret: "client-secret",
            code: "server-auth-code",
            redirect_uri: "",
            grant_type: "authorization_code"
        }
    );
    assert.strictEqual(
        axiosCalls[0].headers["Content-Type"],
        "application/x-www-form-urlencoded"
    );
}

// 유효하지 않은 serverAuthCode를 Google 인증 증명 오류로 구분하는지 검증합니다.
async function assertInvalidServerAuthCodeIsDistinguished() {
    resetState();
    requestError = axiosError(400, { error: "invalid_grant" });

    await assert.rejects(
        () => requestGoogleOAuthToken(
            "invalid-server-auth-code",
            "client-id",
            "client-secret"
        ),
        (error) =>
            error.code === "unauthenticated" &&
            error.details?.reason === "invalid_google_proof"
    );
}

// Google token endpoint 장애를 provider 오류로 구분하는지 검증합니다.
async function assertServerAuthCodeProviderFailureIsDistinguished() {
    resetState();
    requestError = axiosError(503, { error: "temporarily_unavailable" });

    await assert.rejects(
        () => requestGoogleOAuthToken(
            "server-auth-code",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "google_provider_failed"
    );
    assert.deepStrictEqual(loggerErrors, [[
        "Google 인증 서버 요청에 실패했습니다.",
        {
            status: 503,
            message: "요청이 status code 503로 실패했습니다.",
            error: "temporarily_unavailable"
        }
    ]]);
}

// Google token endpoint 통신 실패를 provider 오류로 구분하는지 검증합니다.
async function assertServerAuthCodeNetworkFailureIsDistinguished() {
    resetState();
    requestError = new Error("Google token endpoint에 연결할 수 없습니다.");

    await assert.rejects(
        () => requestGoogleOAuthToken(
            "server-auth-code",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "google_provider_failed"
    );
    assert.deepStrictEqual(loggerErrors, [[
        "Google 인증 서버 요청에 실패했습니다.",
        { message: "Google token endpoint에 연결할 수 없습니다." }
    ]]);
}

// Google token endpoint 응답에 필수 token이 없으면 provider 오류로 처리하는지 검증합니다.
async function assertServerAuthCodeRequiresTokens() {
    resetState();
    tokenResponse = {
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid email profile",
        token_type: "Bearer"
    };

    await assert.rejects(
        () => requestGoogleOAuthToken(
            "server-auth-code",
            "client-id",
            "client-secret"
        ),
        (error) => error.details?.reason === "google_provider_failed"
    );
}

// 명시적 grant 폐기 요청이 refresh token을 Google revoke endpoint에 전달하는지 검증합니다.
async function assertGrantRevocationUsesRefreshToken() {
    resetState();

    await revokeGoogleOAuthToken("firebase-uid", "refresh-token");

    assert.strictEqual(axiosCalls.length, 1);
    assert.strictEqual(axiosCalls[0].url, "https://oauth2.googleapis.com/revoke");
    assert.deepStrictEqual(
        Object.fromEntries(new URLSearchParams(axiosCalls[0].data)),
        { token: "refresh-token" }
    );
}

// 이미 무효화된 token 폐기는 반복 호출 가능한 성공으로 처리하는지 검증합니다.
async function assertAlreadyInvalidTokenIsAccepted() {
    resetState();
    requestError = axiosError(400, { error: "invalid_token" });

    await revokeGoogleOAuthToken("firebase-uid", "invalid-token");
    assert.deepStrictEqual(loggerWarnings, [[
        "Google OAuth token이 이미 무효화되어 성공으로 처리합니다.",
        {
            uid: "firebase-uid",
            google: {
                status: 400,
                message: "요청이 status code 400로 실패했습니다.",
                error: "invalid_token"
            }
        }
    ]]);
}

// Google grant 폐기 실패를 별도 오류로 구분하는지 검증합니다.
async function assertGrantRevocationFailureIsDistinguished() {
    resetState();
    requestError = axiosError(500, { error: "server_error" });

    await assert.rejects(
        () => revokeGoogleOAuthToken("firebase-uid", "refresh-token"),
        (error) => error.details?.reason === "google_revoke_failed"
    );
    assert.deepStrictEqual(loggerErrors, [[
        "Google OAuth grant 폐기에 실패했습니다.",
        {
            status: 500,
            message: "요청이 status code 500로 실패했습니다.",
            error: "server_error"
        }
    ]]);
}

// Google client 테스트 상태를 초기화합니다.
function resetState() {
    axiosCalls.length = 0;
    loggerErrors.length = 0;
    loggerWarnings.length = 0;
    tokenResponse = googleTokenResponse();
    requestError = undefined;
}

// Google token endpoint 응답을 구성합니다.
function googleTokenResponse() {
    return {
        access_token: "access-token",
        id_token: "id-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
        scope: "openid email profile",
        token_type: "Bearer"
    };
}

// Axios 오류 형태의 외부 요청 실패를 구성합니다.
function axiosError(status, data) {
    const error = new Error(`요청이 status code ${status}로 실패했습니다.`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}
