const assert = require("assert");
const { HttpsError } = require("firebase-functions/v2/https");
const { restErrorBodyFrom, restErrorFrom } = require("../lib/rest/error");
const { parseRestRouteSegments, matchRestRoute } = require("../lib/rest/router");

assert.deepStrictEqual(
    parseRestRouteSegments(["api", "todos", "todo-1", "deletion-request"]),
    ["todos", "todo-1", "deletion-request"]
);

assert.strictEqual(parseRestRouteSegments(["staging", "todos"]), undefined);

assert.strictEqual(matchRestRoute("GET", ["auth", "apple", "challenges"]), undefined);
assert.strictEqual(matchRestRoute("POST", ["auth", "apple", "account-link"]), undefined);

assert.strictEqual(matchRestRoute("POST", ["auth", "github", "tokens"]), undefined);
assert.strictEqual(matchRestRoute("POST", ["auth", "github", "link"]), undefined);

for (const [method, segments] of [
    ["POST", ["auth", "github", "sign-in-sessions"]],
    ["GET", ["auth", "github", "callback"]],
    ["POST", ["auth", "github", "custom-token"]],
    ["POST", ["auth", "github", "account-link-sessions"]],
    ["PUT", ["auth", "github", "account-link"]],
    ["DELETE", ["auth", "github", "account-link"]],
    ["DELETE", ["auth", "github", "access-token"]],
    ["POST", ["auth", "apple", "challenges"]],
    ["POST", ["auth", "apple", "custom-token"]],
    ["PUT", ["auth", "apple", "account-link"]],
    ["DELETE", ["auth", "apple", "account-link"]],
    ["POST", ["auth", "apple", "access-token"]],
    ["POST", ["auth", "apple", "refresh-token"]],
    ["DELETE", ["auth", "apple", "access-token"]],
    ["POST", ["auth", "google", "authorization-code", "custom-token"]],
    ["PUT", ["auth", "google", "authorization-code", "account-link"]],
    ["DELETE", ["auth", "google", "account-link"]],
    ["DELETE", ["auth", "google", "access-token"]],
    ["POST", ["auth", "google", "sign-in-sessions"]],
    ["GET", ["auth", "google", "callback"]],
    ["POST", ["auth", "google", "custom-token"]],
    ["POST", ["auth", "google", "account-link-sessions"]],
    ["PUT", ["auth", "google", "account-link"]]
]) {
    assert.strictEqual(matchRestRoute(method, segments), undefined);
}

assert.strictEqual(matchRestRoute("GET", ["todos", "todo-1", "deletion-request"]), undefined);
assert.strictEqual(matchRestRoute("POST", ["todos", "", "deletion-request"]), undefined);

const oauthErrors = [
    ["invalid_oauth_ticket", 400, "invalid-oauth-ticket"],
    ["expired_oauth_ticket", 410, "expired-oauth-ticket"],
    ["consumed_oauth_ticket", 409, "consumed-oauth-ticket"],
    ["mismatched_oauth_ticket", 403, "mismatched-oauth-ticket"],
    ["invalid_app_verifier", 401, "invalid-app-verifier"]
];

for (const [reason, status, code] of oauthErrors) {
    const error = restErrorFrom(new HttpsError("failed-precondition", reason, { reason }));
    assert.strictEqual(error.status, status);
    assert.strictEqual(error.code, code);
}

const aborted = restErrorFrom(new HttpsError("aborted", "transaction 충돌"));
assert.strictEqual(aborted.status, 409);
assert.strictEqual(aborted.code, "aborted");

const invalidIDToken = restErrorFrom({
    code: "auth/invalid-id-token",
    message: "Firebase ID token has invalid signature."
});
assert.strictEqual(invalidIDToken.status, 401);
assert.strictEqual(invalidIDToken.code, "auth/invalid-id-token");

const firebaseInternalError = restErrorFrom({
    code: "auth/internal-error",
    message: "Firebase Auth 내부 오류"
});
assert.strictEqual(firebaseInternalError.status, 500);
assert.strictEqual(firebaseInternalError.code, "internal");
