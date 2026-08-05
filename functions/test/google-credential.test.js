const assert = require("assert");

const revokeCalls = [];
let revokeHook;
require.cache[require.resolve("../lib/rest/google/googleClient")] = {
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
    revokeGoogleCredential
} = require("../lib/rest/google/googleCredential");

(async () => {
    await assertStoredCredentialIsReturned();
    await assertGrantRevocationPrefersRefreshToken();
    await assertGrantRevocationFallsBackToAccessToken();
    await assertAccountLinkLeaseBlocksCredentialRevocation();
    await assertAccountLinkLeaseBlocksEmptyCredentialDeletion();
    await assertGrantRevocationFailureReleasesLease();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 저장된 Google credential을 동일한 형태로 반환하는지 검증합니다.
async function assertStoredCredentialIsReturned() {
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": googleCredential()
    });

    assert.deepStrictEqual(
        await googleCredentialForUser(db, "user-1"),
        googleCredential()
    );
}

// 회원탈퇴 grant 폐기에서 refresh token을 우선 사용하고 credential을 삭제하는지 검증합니다.
async function assertGrantRevocationPrefersRefreshToken() {
    resetState();
    const credential = googleCredential();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": credential
    });

    await revokeGoogleCredential(db, "user-1", credential);

    assert.deepStrictEqual(revokeCalls, [["user-1", "refresh-token"]]);
    assert.strictEqual(
        db.data.has("authCredentials/user-1/providers/google"),
        false
    );
}

// refresh token이 없는 credential은 access token으로 폐기하는지 검증합니다.
async function assertGrantRevocationFallsBackToAccessToken() {
    resetState();
    const credential = {
        accessToken: "access-token",
        clientId: "client-id"
    };
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": credential
    });

    await revokeGoogleCredential(db, "user-1", credential);

    assert.deepStrictEqual(revokeCalls, [["user-1", "access-token"]]);
    assert.strictEqual(
        db.data.has("authCredentials/user-1/providers/google"),
        false
    );
}

// Cloud Run의 계정 연결 lease가 남은 credential은 폐기하지 않는지 검증합니다.
async function assertAccountLinkLeaseBlocksCredentialRevocation() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": {
            ...googleCredential(),
            accountLinkClaim: "account-link-claim",
            accountLinkExpiresAt: activeExpiration()
        }
    });

    await assert.rejects(
        () => revokeGoogleCredential(db, "user-1"),
        (error) => error.code === "aborted"
    );
    assert.deepStrictEqual(revokeCalls, []);
}

// credential이 없어도 Cloud Run의 계정 연결 claim 문서를 삭제하지 않는지 검증합니다.
async function assertAccountLinkLeaseBlocksEmptyCredentialDeletion() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": {
            accountLinkClaim: "account-link-claim",
            accountLinkExpiresAt: activeExpiration()
        }
    });

    await assert.rejects(
        () => revokeGoogleCredential(db, "user-1"),
        (error) => error.code === "aborted"
    );
    assert.strictEqual(
        db.data.has("authCredentials/user-1/providers/google"),
        true
    );
}

// grant 폐기 실패 뒤 lease를 해제해 회원탈퇴 재시도가 가능한지 검증합니다.
async function assertGrantRevocationFailureReleasesLease() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/google": googleCredential()
    });
    revokeHook = async () => {
        throw new Error("revoke-failed");
    };

    await assert.rejects(
        () => revokeGoogleCredential(db, "user-1"),
        /revoke-failed/
    );

    revokeHook = undefined;
    await revokeGoogleCredential(db, "user-1");
    assert.strictEqual(
        db.data.has("authCredentials/user-1/providers/google"),
        false
    );
}

// Google credential 시험 상태를 초기화합니다.
function resetState() {
    revokeCalls.length = 0;
    revokeHook = undefined;
}

// Google credential 시험 입력을 구성합니다.
function googleCredential() {
    return {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        clientId: "client-id"
    };
}

// 현재 시간에 활성인 lease 만료 값을 구성합니다.
function activeExpiration() {
    return {
        toMillis: () => Date.now() + 60_000
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
