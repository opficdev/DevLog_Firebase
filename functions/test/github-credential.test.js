const assert = require("assert");

const revokeCalls = [];
const tokenRevokeCalls = [];
let revokeHook;
require.cache[require.resolve("../lib/rest/githubClient")] = {
    exports: {
        revokeGitHubOAuthGrant: async (...values) => {
            revokeCalls.push(values);
            if (revokeHook) {
                await revokeHook();
            }
        },
        revokeGitHubOAuthToken: async (...values) => {
            tokenRevokeCalls.push(values);
        }
    }
};

const {
    deleteGithubCredential,
    githubCredentialForUser,
    revokePendingGithubCredentials,
    revokeGithubCredential,
    saveGithubCredential
} = require("../lib/rest/githubCredential");

(async () => {
    await assertLegacyCredentialIsDiscarded();
    await assertNewCredentialIsPreservedWhileLegacyFieldIsRemoved();
    await assertCredentialStoresIssuingOAuthApp();
    await assertReplacingCredentialRevokesTrackedPreviousGrants();
    await assertSameAppReplacementRevokesOnlyPreviousToken();
    await assertGrantRevocationDeletesCredential();
    await assertMissingCredentialRevocationIsIdempotent();
    await assertRevocationLeaseBlocksConcurrentReplacement();
    await assertDeletionMarkerBlocksLateCredentialSave();
    await assertConditionalDeletePreservesLateLegacyToken();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 기존 OAuth App token은 신규 credential로 이관하지 않고 제거하는지 검증합니다.
async function assertLegacyCredentialIsDiscarded() {
    const db = fakeFirestore({
        "users/user-1/userData/tokens": { githubAccessToken: "legacy-token" }
    });

    const credential = await githubCredentialForUser(
        db,
        "user-1"
    );

    assert.strictEqual(credential, undefined);
    assert.strictEqual(db.data.has("authCredentials/user-1/providers/github"), false);
    assert.strictEqual(
        "githubAccessToken" in db.data.get("users/user-1/userData/tokens"),
        false
    );
}

// credential 없음 조회 뒤 기록된 legacy token을 조건부 삭제가 보존하는지 검증합니다.
async function assertConditionalDeletePreservesLateLegacyToken() {
    const db = fakeFirestore({
        "users/user-1/userData/tokens": {
            githubAccessToken: "late-legacy-token"
        }
    });

    await assert.rejects(
        () => deleteGithubCredential(db, "user-1"),
        (error) => error.code === "aborted"
    );

    assert.strictEqual(
        db.data.get("users/user-1/userData/tokens").githubAccessToken,
        "late-legacy-token"
    );
}

// 회원탈퇴 표식이 기록된 uid에는 늦게 도착한 credential을 저장하지 않는지 검증합니다.
async function assertDeletionMarkerBlocksLateCredentialSave() {
    const db = fakeFirestore({
        "authCredentials/user-1": {
            deletionStartedAt: new Date()
        }
    });

    await assert.rejects(
        () => saveGithubCredential(db, "user-1", {
            accessToken: "late-token",
            clientId: "client-id"
        }),
        (error) => error.code === "failed-precondition"
    );
    assert.strictEqual(
        db.data.has("authCredentials/user-1/providers/github"),
        false
    );
}

// grant 폐기 중인 credential을 새 로그인 요청이 덮어쓰지 못하는지 검증합니다.
async function assertRevocationLeaseBlocksConcurrentReplacement() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/github": {
            accessToken: "stored-token",
            clientId: "client-id"
        }
    });
    revokeHook = async () => {
        await assert.rejects(
            () => saveGithubCredential(db, "user-1", {
                accessToken: "new-token",
                clientId: "client-id"
            }),
            (error) => error.code === "aborted"
        );
    };
    try {
        await revokeGithubCredential(db, "user-1", {
            clientId: "client-id",
            clientSecret: "client-secret",
            callbackURL: ""
        }, {
            accessToken: "stored-token",
            clientId: "client-id"
        });
    } finally {
        revokeHook = undefined;
    }

    assert.strictEqual(db.data.has("authCredentials/user-1/providers/github"), false);
}

// 같은 OAuth App의 credential 교체가 새 grant는 유지하고 이전 token만 폐기하는지 검증합니다.
async function assertSameAppReplacementRevokesOnlyPreviousToken() {
    revokeCalls.length = 0;
    tokenRevokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/github": {
            accessToken: "old-token",
            clientId: "staging-client-id"
        }
    });
    const originalEnvironment = { ...process.env };
    process.env.GITHUB_OAUTH_CONFIG = githubOAuthConfiguration();
    try {
        await saveGithubCredential(db, "user-1", {
            accessToken: "new-token",
            clientId: "staging-client-id"
        });
        await revokePendingGithubCredentials(db, "user-1", "staging");
    } finally {
        process.env = originalEnvironment;
    }

    assert.deepStrictEqual(revokeCalls, []);
    assert.deepStrictEqual(tokenRevokeCalls, [[
        "user-1",
        "old-token",
        "staging-client-id",
        "staging-client-secret"
    ]]);
    assert.strictEqual(
        db.data.get("authCredentials/user-1/providers/github").accessToken,
        "new-token"
    );
}

// 신규 OAuth App credential 교체가 이전 App token을 폐기 대상으로 남기지 않는지 검증합니다.
async function assertReplacingCredentialRevokesTrackedPreviousGrants() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/github": {
            accessToken: "old-token",
            clientId: "legacy-client-id"
        },
        "users/user-1/userData/tokens": {
            githubAccessToken: "older-token"
        }
    });
    const originalEnvironment = { ...process.env };
    process.env.GITHUB_OAUTH_CONFIG = githubOAuthConfiguration();
    try {
        await saveGithubCredential(db, "user-1", {
            accessToken: "new-token",
            clientId: "staging-client-id"
        });
        await revokePendingGithubCredentials(db, "user-1", "staging");
    } finally {
        process.env = originalEnvironment;
    }

    assert.deepStrictEqual(revokeCalls, []);
    const credential = db.data.get("authCredentials/user-1/providers/github");
    assert.strictEqual(credential.accessToken, "new-token");
    assert.strictEqual(credential.clientId, "staging-client-id");
    assert.deepStrictEqual(credential.pendingRevocations, []);
}

// 새 GitHub credential이 access token과 발급 OAuth App을 함께 저장하는지 검증합니다.
async function assertCredentialStoresIssuingOAuthApp() {
    const db = fakeFirestore();

    await saveGithubCredential(db, "user-1", {
        accessToken: "new-token",
        clientId: "staging-client-id"
    });

    const credential = db.data.get("authCredentials/user-1/providers/github");
    assert.strictEqual(credential.accessToken, "new-token");
    assert.strictEqual(credential.clientId, "staging-client-id");
}

// GitHub OAuth App JSON Secret 테스트 값을 반환합니다.
function githubOAuthConfiguration() {
    return JSON.stringify({
        clientId: "staging-client-id",
        clientSecret: "staging-client-secret",
        callbackURL: "https://example.com/callback"
    });
}

// 새 credential이 있으면 기존 token 값으로 덮지 않고 기존 필드만 제거하는지 검증합니다.
async function assertNewCredentialIsPreservedWhileLegacyFieldIsRemoved() {
    const db = fakeFirestore({
        "authCredentials/user-1/providers/github": {
            accessToken: "new-token",
            clientId: "new-client-id"
        },
        "users/user-1/userData/tokens": { githubAccessToken: "legacy-token" }
    });

    const credential = await githubCredentialForUser(
        db,
        "user-1"
    );

    assert.deepStrictEqual(credential, {
        accessToken: "new-token",
        clientId: "new-client-id"
    });
    assert.strictEqual(
        db.data.get("authCredentials/user-1/providers/github").accessToken,
        "new-token"
    );
    assert.strictEqual(
        "githubAccessToken" in db.data.get("users/user-1/userData/tokens"),
        false
    );
    assert.strictEqual(
        db.data.get("authCredentials/user-1/providers/github").pendingRevocations,
        undefined
    );
}

// grant 폐기 성공 뒤 새 credential과 기존 token 필드가 삭제되는지 검증합니다.
async function assertGrantRevocationDeletesCredential() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/github": {
            accessToken: "stored-token",
            clientId: "client-id"
        }
    });
    const configuration = {
        clientId: "client-id",
        clientSecret: "client-secret",
        callbackURL: "https://example.com/callback"
    };

    await revokeGithubCredential(db, "user-1", configuration);

    assert.deepStrictEqual(revokeCalls, [[
        "user-1",
        "stored-token",
        "client-id",
        "client-secret"
    ]]);
    assert.strictEqual(db.data.has("authCredentials/user-1/providers/github"), false);
}

// credential이 없는 폐기 재호출이 오류 없이 완료되는지 검증합니다.
async function assertMissingCredentialRevocationIsIdempotent() {
    revokeCalls.length = 0;
    const db = fakeFirestore();

    await revokeGithubCredential(db, "user-1", {
        clientId: "client-id",
        clientSecret: "client-secret",
        callbackURL: "https://example.com/callback"
    });

    assert.deepStrictEqual(revokeCalls, []);
}

// GitHub credential transaction을 메모리에서 실행할 Firestore 대역을 구성합니다.
function fakeFirestore(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        doc(path) {
            return {
                path,
                async get() {
                    const value = data.get(path);
                    return {
                        exists: value !== undefined,
                        data: () => value
                    };
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
                set(reference, value, options) {
                    data.set(reference.path, options?.merge ? {
                        ...data.get(reference.path),
                        ...value
                    } : { ...value });
                },
                update(reference, value) {
                    const updated = { ...data.get(reference.path) };
                    for (const [key, fieldValue] of Object.entries(value)) {
                        if (key === "githubAccessToken") {
                            delete updated[key];
                        } else {
                            updated[key] = fieldValue;
                        }
                    }
                    data.set(reference.path, updated);
                },
                delete(reference) {
                    data.delete(reference.path);
                }
            });
        }
    };
}
