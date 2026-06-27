const assert = require("assert");
const { HttpsError } = require("firebase-functions/v2/https");
const { restErrorFrom } = require("../lib/rest/error");
const { parseRestRouteSegments, matchRestRoute } = require("../lib/rest/router");
const { resolveAppleFirebaseUID } = require("../lib/rest/appleAuth");

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

(async () => {
    const providerAuth = fakeAuth({
        usersByProvider: {
            "apple.com:apple-sub-1": {
                uid: "mapped-uid"
            }
        }
    });
    assert.strictEqual(
        await resolveAppleFirebaseUID(providerAuth, "apple-sub-1"),
        "mapped-uid"
    );
    assert.deepStrictEqual(providerAuth.calls, [{
        name: "getUserByProviderUid",
        providerId: "apple.com",
        uid: "apple-sub-1"
    }]);

    const emailAuth = fakeAuth({
        usersByEmail: {
            "user@example.com": { uid: "email-uid" }
        }
    });
    assert.strictEqual(
        await resolveAppleFirebaseUID(emailAuth, "apple-sub-2", "user@example.com", true),
        "email-uid"
    );

    const noEmailAuth = fakeAuth();
    assert.strictEqual(
        await resolveAppleFirebaseUID(noEmailAuth, "apple-sub-3"),
        "apple:apple-sub-3"
    );
    assert.deepStrictEqual(noEmailAuth.createdUsers, [{
        uid: "apple:apple-sub-3"
    }]);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

function fakeAuth(options = {}) {
    const usersByUID = { ...(options.usersByUID || {}) };
    const usersByEmail = { ...(options.usersByEmail || {}) };
    const usersByProvider = { ...(options.usersByProvider || {}) };
    const calls = [];
    const createdUsers = [];

    return {
        calls,
        createdUsers,
        async getUser(uid) {
            calls.push({ name: "getUser", uid });
            const user = usersByUID[uid];
            if (!user) {
                throw firebaseAuthError("auth/user-not-found");
            }
            return user;
        },
        async getUserByProviderUid(providerId, uid) {
            calls.push({ name: "getUserByProviderUid", providerId, uid });
            const user = usersByProvider[`${providerId}:${uid}`];
            if (!user) {
                throw firebaseAuthError("auth/user-not-found");
            }
            return user;
        },
        async getUserByEmail(email) {
            calls.push({ name: "getUserByEmail", email });
            const user = usersByEmail[email];
            if (!user) {
                throw firebaseAuthError("auth/user-not-found");
            }
            return user;
        },
        async createUser(properties) {
            calls.push({ name: "createUser", properties });
            createdUsers.push(properties);
            const uid = properties.uid || `created-user-${createdUsers.length}`;
            if (usersByUID[uid]) {
                throw firebaseAuthError("auth/uid-already-exists");
            }
            if (properties.email && usersByEmail[properties.email]) {
                throw firebaseAuthError("auth/email-already-exists");
            }

            const user = { uid };
            usersByUID[uid] = user;
            if (properties.email) {
                usersByEmail[properties.email] = user;
            }
            return user;
        }
    };
}

function firebaseAuthError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}
