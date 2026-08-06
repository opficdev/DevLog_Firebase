const assert = require("assert");

const axiosCalls = [];
const loggerErrors = [];
const loggerWarnings = [];
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
        return { status: 200 };
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
    revokeGoogleOAuthToken
} = require("../lib/rest/google/googleClient");

(async () => {
    await assertGrantRevocationUsesRefreshToken();
    await assertAlreadyInvalidTokenIsAccepted();
    await assertGrantRevocationFailureIsDistinguished();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// grant 폐기 요청이 지정 token을 Google revoke endpoint에 전달하는지 검증합니다.
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

// 이미 무효화된 token 폐기를 반복 호출 가능한 성공으로 처리하는지 검증합니다.
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
                errorMessage: "요청이 status code 400로 실패했습니다.",
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
            errorMessage: "요청이 status code 500로 실패했습니다.",
            error: "server_error"
        }
    ]]);
}

// Google client 시험 상태를 초기화합니다.
function resetState() {
    axiosCalls.length = 0;
    loggerErrors.length = 0;
    loggerWarnings.length = 0;
    requestError = undefined;
}

// Axios 오류 형태의 외부 요청 실패를 구성합니다.
function axiosError(status, data) {
    const error = new Error(`요청이 status code ${status}로 실패했습니다.`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}
