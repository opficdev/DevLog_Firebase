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
    claimGoogleAccountLink,
    googleCredentialForUser,
    releaseGoogleAccountLink,
    renewGoogleAccountLink,
    revokeGoogleCredential,
    saveGoogleCredential
} = require("../lib/rest/googleCredential");

(async () => {
    await assertAccountLinkLeaseScopesRequestsByUser();
    await assertAccountLinkLeaseExpires();
    await assertOnlyCurrentLeaseCanBeRenewed();
    await assertClaimedCredentialSaveReleasesLease();
    await assertOnlyLeaseOwnerCanSaveAndRelease();
    await assertAccountLinkLeaseBlocksRegularCredentialSave();
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

// 동일 사용자의 Google 계정 연결만 차단하고 다른 사용자는 계속 처리하는지 검증합니다.
async function assertAccountLinkLeaseScopesRequestsByUser() {
    const db = fakeFirestore();

    await claimGoogleAccountLink(db, "user-1");
    await claimGoogleAccountLink(db, "user-2");

    await assert.rejects(
        () => claimGoogleAccountLink(db, "user-1"),
        (error) =>
            error.code === "aborted" &&
            error.details?.reason === "google_account_link_in_progress"
    );
}

// 만료된 Google 계정 연결 lease는 다음 요청이 다시 획득하는지 검증합니다.
async function assertAccountLinkLeaseExpires() {
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": {
            accountLinkClaim: "expired-claim",
            accountLinkExpiresAt: {
                toMillis: () => Date.now() - 1
            }
        }
    });

    const claim = await claimGoogleAccountLink(db, "user-1");

    assert.notStrictEqual(claim, "expired-claim");
}

// 만료 뒤 교체된 claim은 이전 요청이 다시 연장할 수 없는지 검증합니다.
async function assertOnlyCurrentLeaseCanBeRenewed() {
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": {
            accountLinkClaim: "expired-claim",
            accountLinkExpiresAt: {
                toMillis: () => Date.now() - 1
            }
        }
    });
    const claim = await claimGoogleAccountLink(db, "user-1");

    assert.strictEqual(
        await renewGoogleAccountLink(db, "user-1", "expired-claim"),
        false
    );
    assert.strictEqual(
        await renewGoogleAccountLink(db, "user-1", claim),
        true
    );
    await assert.rejects(
        () => claimGoogleAccountLink(db, "user-1"),
        (error) => error.details?.reason === "google_account_link_in_progress"
    );
}

// lease 소유자의 credential 저장이 같은 transaction에서 lease를 해제하는지 검증합니다.
async function assertClaimedCredentialSaveReleasesLease() {
    const db = fakeFirestore();
    const claim = await claimGoogleAccountLink(db, "user-1");

    await saveGoogleCredential(
        db,
        "user-1",
        googleCredential(),
        claim
    );

    assert.deepStrictEqual(await googleCredentialForUser(db, "user-1"), googleCredential());
    await claimGoogleAccountLink(db, "user-1");
}

// 다른 요청은 lease 소유자의 credential 저장과 실패 후 해제를 대신할 수 없는지 검증합니다.
async function assertOnlyLeaseOwnerCanSaveAndRelease() {
    const db = fakeFirestore();
    const claim = await claimGoogleAccountLink(db, "user-1");

    await assert.rejects(
        () => saveGoogleCredential(
            db,
            "user-1",
            googleCredential(),
            "other-claim"
        ),
        (error) => error.code === "aborted"
    );
    await releaseGoogleAccountLink(db, "user-1", "other-claim");
    await assert.rejects(
        () => claimGoogleAccountLink(db, "user-1"),
        (error) => error.details?.reason === "google_account_link_in_progress"
    );

    await releaseGoogleAccountLink(db, "user-1", claim);
    await claimGoogleAccountLink(db, "user-1");
}

// 진행 중인 계정 연결이 같은 사용자의 일반 로그인 credential 저장을 차단하는지 검증합니다.
async function assertAccountLinkLeaseBlocksRegularCredentialSave() {
    const db = fakeFirestore();
    await claimGoogleAccountLink(db, "user-1");

    await assert.rejects(
        () => saveGoogleCredential(db, "user-1", googleCredential()),
        (error) =>
            error.code === "aborted" &&
            error.details?.reason === "google_account_link_in_progress"
    );
    assert.strictEqual(await googleCredentialForUser(db, "user-1"), undefined);
}

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
