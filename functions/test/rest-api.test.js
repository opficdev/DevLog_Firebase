const assert = require("assert");
const https = require("firebase-functions/v2/https");

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

const { api } = require("../lib/rest/api");

(async () => {
    for (const [method, path] of [
        ["POST", "/api/auth/github/sign-in-sessions"],
        ["GET", "/api/auth/github/callback"],
        ["POST", "/api/auth/github/custom-token"],
        ["POST", "/api/auth/github/account-link-sessions"],
        ["PUT", "/api/auth/github/account-link"],
        ["DELETE", "/api/auth/github/account-link"],
        ["DELETE", "/api/auth/github/access-token"],
        ["PUT", "/api/auth/apple/account-link"],
        ["DELETE", "/api/auth/apple/account-link"],
        ["POST", "/api/auth/apple/access-token"],
        ["POST", "/api/auth/apple/refresh-token"],
        ["DELETE", "/api/auth/apple/access-token"],
        ["POST", "/api/auth/google/authorization-code/custom-token"],
        ["PUT", "/api/auth/google/authorization-code/account-link"],
        ["DELETE", "/api/auth/google/account-link"],
        ["DELETE", "/api/auth/google/access-token"]
    ]) {
        const response = responseRecorder();

        await api(request(method, path), response);

        assert.strictEqual(response.statusCode, 404);
        assert.deepStrictEqual(response.body, {
            code: "not-found",
            message: "Endpoint를 찾을 수 없습니다."
        });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 제거된 인증 REST 경로를 호출할 시험 요청을 구성합니다.
function request(method, path) {
    return {
        method,
        path,
        url: path,
        body: {},
        headers: {},
        query: {}
    };
}

// REST API 시험 응답과 기록 기능을 구성합니다.
function responseRecorder() {
    return {
        statusCode: undefined,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
        send() {
            throw new Error("예상하지 않은 응답입니다.");
        },
        redirect() {
            throw new Error("예상하지 않은 redirect 응답입니다.");
        }
    };
}
