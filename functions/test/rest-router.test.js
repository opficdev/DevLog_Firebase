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
    matchRestRoute("POST", ["auth", "apple", "challenges"]),
    {
        action: "createAppleChallenge",
        requiresAuth: false
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
    matchRestRoute("PUT", ["auth", "apple", "account-link"]),
    {
        action: "linkAppleProvider",
        requiresAuth: true
    }
);

assert.deepStrictEqual(
    matchRestRoute("DELETE", ["auth", "apple", "account-link"]),
    {
        action: "unlinkAppleProvider",
        requiresAuth: true
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

assert.strictEqual(matchRestRoute("GET", ["auth", "apple", "challenges"]), undefined);
assert.strictEqual(matchRestRoute("POST", ["auth", "apple", "account-link"]), undefined);

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

const githubLinkConflict = restErrorFrom(
    new HttpsError("failed-precondition", "GitHub provider가 다른 계정에 연결되어 있습니다.", {
        reason: "github_email_changed_account_conflict"
    })
);
assert.strictEqual(githubLinkConflict.status, 412);
assert.strictEqual(githubLinkConflict.code, "github-email-changed-account-conflict");
assert.deepStrictEqual(
    restErrorBodyFrom(
        new HttpsError("failed-precondition", "GitHub provider가 다른 계정에 연결되어 있습니다.", {
            reason: "github_email_changed_account_conflict"
        })
    ),
    {
        code: "github-email-changed-account-conflict",
        message: "GitHub provider가 다른 계정에 연결되어 있습니다."
    }
);

const appleErrors = [
    ["invalid_apple_challenge", 400, "invalid-apple-challenge"],
    ["expired_apple_challenge", 410, "expired-apple-challenge"],
    ["consumed_apple_challenge", 409, "consumed-apple-challenge"],
    ["invalid_apple_proof", 401, "invalid-apple-proof"],
    ["apple_provider_link_conflict", 409, "apple-provider-link-conflict"],
    ["last_provider", 412, "last-provider"],
    ["apple_credential_not_found", 404, "apple-credential-not-found"],
    ["apple_revoke_failed", 502, "apple-revoke-failed"]
];

for (const [reason, status, code] of appleErrors) {
    const restError = restErrorFrom(
        new HttpsError("failed-precondition", "Apple 인증 처리 실패", { reason })
    );
    assert.strictEqual(restError.status, status);
    assert.strictEqual(restError.code, code);
}

const hyphenatedReasons = [
    ["email-not-found", 400, "email-not-found"],
    ["github-email-changed-account-conflict", 412, "github-email-changed-account-conflict"],
    ["expired-apple-challenge", 410, "expired-apple-challenge"]
];

for (const [reason, status, code] of hyphenatedReasons) {
    const restError = restErrorFrom({ reason, message: "구분 가능한 오류" });
    assert.strictEqual(restError.status, status);
    assert.strictEqual(restError.code, code);
}

const invalidIDToken = restErrorFrom({
    code: "auth/invalid-id-token",
    message: "Firebase ID token has invalid signature."
});
assert.strictEqual(invalidIDToken.status, 401);
assert.strictEqual(invalidIDToken.code, "auth/invalid-id-token");
