const assert = require("assert");
const { HttpsError } = require("firebase-functions/v2/https");
const { restErrorBodyFrom, restErrorFrom } = require("../lib/rest/error");
const { parseRestRouteSegments, matchRestRoute } = require("../lib/rest/router");

assert.deepStrictEqual(
    parseRestRouteSegments(["api", "todos", "todo-1", "deletion-request"]),
    ["todos", "todo-1", "deletion-request"]
);

assert.deepStrictEqual(
    parseRestRouteSegments(["stagingApi", "api", "todos", "todo-1", "deletion-request"]),
    ["todos", "todo-1", "deletion-request"]
);

assert.deepStrictEqual(
    parseRestRouteSegments(["prodApi", "api", "auth", "github", "tokens"]),
    ["auth", "github", "tokens"]
);

assert.strictEqual(parseRestRouteSegments(["staging", "todos"]), undefined);

assert.deepStrictEqual(
    matchRestRoute("POST", ["todos", "todo-1", "deletion-request"]),
    {
        action: "requestTodoDeletion",
        requiresAuth: true,
        id: "todo-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["todos", "todo-1", "deletion-request"]),
    {
        action: "undoTodoDeletion",
        requiresAuth: true,
        id: "todo-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["web-pages", "web-page-1", "deletion-request"]),
    {
        action: "requestWebPageDeletion",
        requiresAuth: true,
        id: "web-page-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["web-pages", "web-page-1", "deletion-request"]),
    {
        action: "undoWebPageDeletion",
        requiresAuth: true,
        id: "web-page-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["push-notifications", "notification-1", "deletion-request"]),
    {
        action: "requestPushNotificationDeletion",
        requiresAuth: true,
        id: "notification-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["push-notifications", "notification-1", "deletion-request"]),
    {
        action: "undoPushNotificationDeletion",
        requiresAuth: true,
        id: "notification-1"
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["auth", "apple", "custom-token"]),
    {
        action: "requestAppleCustomToken",
        requiresAuth: false
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["auth", "apple", "access-token"]),
    {
        action: "refreshAppleAccessToken",
        requiresAuth: true
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["auth", "apple", "refresh-token"]),
    {
        action: "requestAppleRefreshToken",
        requiresAuth: true
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["auth", "apple", "access-token"]),
    {
        action: "revokeAppleAccessToken",
        requiresAuth: true
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["auth", "github", "tokens"]),
    {
        action: "requestGithubTokens",
        requiresAuth: false
    }
);

assert.deepStrictEqual(
    matchRestRoute("POST", ["auth", "github", "link"]),
    {
        action: "linkGithubProvider",
        requiresAuth: true
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["auth", "github", "access-token"]),
    {
        action: "revokeGithubAccessToken",
        requiresAuth: true
    }
);

assert.strictEqual(matchRestRoute("GET", ["todos", "todo-1", "deletion-request"]), undefined);
assert.strictEqual(matchRestRoute("POST", ["todos", "", "deletion-request"]), undefined);

const emailNotFound = restErrorFrom(
    new HttpsError("internal", "GitHub 사용자 데이터를 가져오지 못했습니다.", {
        reason: "email_not_found"
    })
);
assert.strictEqual(emailNotFound.status, 400);
assert.strictEqual(emailNotFound.code, "email-not-found");
assert.deepStrictEqual(
    restErrorBodyFrom(
        new HttpsError("internal", "GitHub 사용자 데이터를 가져오지 못했습니다.", {
            reason: "email_not_found"
        })
    ),
    {
        code: "email-not-found",
        message: "GitHub 사용자 데이터를 가져오지 못했습니다."
    }
);

const emailMismatch = restErrorFrom({
    error: {
        reason: "email_mismatch"
    },
    message: "이메일이 일치하지 않습니다."
});
assert.strictEqual(emailMismatch.status, 400);
assert.strictEqual(emailMismatch.code, "email-mismatch");

const invalidIDToken = restErrorFrom({
    code: "auth/invalid-id-token",
    message: "Firebase ID token has invalid signature."
});
assert.strictEqual(invalidIDToken.status, 401);
assert.strictEqual(invalidIDToken.code, "auth/invalid-id-token");
