const assert = require("assert");

const revokeCalls = [];
let revokeHook;
require.cache[require.resolve("../lib/rest/googleClient")] = {
    exports: {
        revokeGoogleOAuthToken: async (...values) => {
            revokeCalls.push(values);
            if (revokeHook) {
                await revokeHook();
            }
        }
    }
};

const {
    googleCredentialForUser,
    revokeGoogleCredential,
    saveGoogleCredential
} = require("../lib/rest/googleCredential");

(async () => {
    await assertRefreshTokenIsStored();
    await assertMissingRefreshTokenPreservesStoredValue();
    await assertGrantRevocationPrefersRefreshToken();
    await assertGrantRevocationFallsBackToAccessToken();
    await assertRevocationLeaseBlocksReplacement();
    await assertDeletionMarkerBlocksLateSave();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 새 Google credential이 access token, refresh token, client id를 저장하는지 검증합니다.
async function assertRefreshTokenIsStored() {
    const db = fakeFirestore();

    await saveGoogleCredential(db, "user-1", googleCredential());

    assert.deepStrictEqual(await googleCredentialForUser(db, "user-1"), googleCredential());
}

// 재로그인 응답에 refresh token이 없으면 같은 client의 기존 값을 보존하는지 검증합니다.
async function assertMissingRefreshTokenPreservesStoredValue() {
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": googleCredential()
    });

    await saveGoogleCredential(db, "user-1", {
        accessToken: "new-access-token",
        clientId: "client-id"
    });

    assert.deepStrictEqual(await googleCredentialForUser(db, "user-1"), {
        accessToken: "new-access-token",
        refreshToken: "refresh-token",
        clientId: "client-id"
    });
}

// 명시적 grant 폐기에서 refresh token을 우선 사용하고 credential을 삭제하는지 검증합니다.
async function assertGrantRevocationPrefersRefreshToken() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": googleCredential()
    });

    await revokeGoogleCredential(db, "user-1");

    assert.deepStrictEqual(revokeCalls, [["user-1", "refresh-token"]]);
    assert.strictEqual(db.data.has("authCredentials/user-1/providers/google"), false);
}

// refresh token이 없는 credential은 현재 access token으로 폐기하는지 검증합니다.
async function assertGrantRevocationFallsBackToAccessToken() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": {
            accessToken: "access-token",
            clientId: "client-id"
        }
    });

    await revokeGoogleCredential(db, "user-1");

    assert.deepStrictEqual(revokeCalls, [["user-1", "access-token"]]);
    assert.strictEqual(db.data.has("authCredentials/user-1/providers/google"), false);
}

// grant 폐기 중에는 새 로그인 credential이 기존 값을 덮어쓰지 못하는지 검증합니다.
async function assertRevocationLeaseBlocksReplacement() {
    revokeCalls.length = 0;
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": googleCredential()
    });
    revokeHook = async () => {
        await assert.rejects(
            () => saveGoogleCredential(db, "user-1", {
                accessToken: "late-access-token",
                clientId: "client-id"
            }),
            (error) => error.code === "aborted"
        );
    };
    try {
        await revokeGoogleCredential(db, "user-1");
    } finally {
        revokeHook = undefined;
    }
}

// 회원탈퇴 표식이 기록된 uid에는 늦게 도착한 credential을 저장하지 않는지 검증합니다.
async function assertDeletionMarkerBlocksLateSave() {
    const db = fakeFirestore({
        "authCredentials/user-1": {
            deletionStartedAt: new Date()
        }
    });

    await assert.rejects(
        () => saveGoogleCredential(db, "user-1", googleCredential()),
        (error) => error.code === "failed-precondition"
    );
    assert.strictEqual(db.data.has("authCredentials/user-1/providers/google"), false);
}

// Google credential 테스트 입력을 구성합니다.
function googleCredential() {
    return {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        clientId: "client-id"
    };
}

// Google credential transaction을 실행할 Firestore 대역을 구성합니다.
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
                    data.set(reference.path, {
                        ...data.get(reference.path),
                        ...value
                    });
                },
                delete(reference) {
                    data.delete(reference.path);
                }
            });
        }
    };
}
