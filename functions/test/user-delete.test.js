const assert = require("assert");
const functionsTest = require("firebase-functions-test")();

const getFirestoreArguments = [];
const deleteCalls = [];
const failedPaths = new Set();
const loggerErrors = [];
const githubCredentialTokens = new Map();
const googleCredentialTokens = new Map();
const revokeCalls = [];
const googleRevokeCalls = [];
const lifecycleEvents = [];
let markerShouldFail = false;
let githubRevocationShouldFail = false;
let googleRevocationShouldFail = false;

require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        info() {},
        error(...values) {
            loggerErrors.push(values);
        }
    }
};

const firestore = require("firebase-admin/firestore");
require.cache[require.resolve("firebase-admin/firestore")] = {
    exports: {
        ...firestore,
        getFirestore: (...args) => {
            getFirestoreArguments.push(args);
            return fakeFirestore();
        }
    }
};

require.cache[require.resolve("../lib/rest/githubConfiguration")] = {
    exports: {
        githubOAuthConfigurationSecret: "GITHUB_OAUTH_CONFIG",
        githubRevocationConfiguration: (clientId) => ({
            clientId,
            clientSecret: `${clientId}-secret`,
            callbackURL: "https://example.com/callback"
        })
    }
};

require.cache[require.resolve("../lib/rest/githubCredential")] = {
    exports: {
        githubCredentialForUser: async (_db, uid) => {
            lifecycleEvents.push("github-credential-read");
            return githubCredentialTokens.get(uid);
        },
        revokeGithubCredential: async (_db, uid, configuration, credential) => {
            lifecycleEvents.push("github-grant-revoke");
            revokeCalls.push({ uid, configuration, credential });
            if (githubRevocationShouldFail) {
                throw new Error("GitHub grant revoke failed");
            }
        },
        revokePendingGithubCredentials: async () => {}
    }
};

require.cache[require.resolve("../lib/rest/googleCredential")] = {
    exports: {
        googleCredentialForUser: async (_db, uid) => {
            lifecycleEvents.push("google-credential-read");
            return googleCredentialTokens.get(uid);
        },
        revokeGoogleCredential: async (_db, uid, credential) => {
            lifecycleEvents.push("google-grant-revoke");
            googleRevokeCalls.push({ uid, credential });
            if (googleRevocationShouldFail) {
                throw new Error("Google grant revoke failed");
            }
        }
    }
};

const {
    cleanupDeletedUserFirestoreData
} = require("../lib/user/delete");

assert.strictEqual(
    cleanupDeletedUserFirestoreData.__endpoint.eventTrigger.retry,
    true
);

const wrapped = functionsTest.wrap(cleanupDeletedUserFirestoreData);

(async () => {
    await assertRootsAreDeletedFromDefaultFirestore();
    await assertEachRootDeletionIsAttemptedAfterFailure();
    await assertGithubGrantIsRevokedBeforeCredentialRootDeletion();
    await assertGoogleGrantIsRevokedBeforeCredentialRootDeletion();
    await assertGoogleGrantIsAttemptedAfterGithubFailure();
    await assertRootCleanupIsSkippedAfterGoogleFailure();
    await assertMarkerFailureSkipsCleanup();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    functionsTest.cleanup();
});

// 현재 project의 기본 Firestore에서 사용자 루트와 provider credential을 삭제하는지 검증합니다.
async function assertRootsAreDeletedFromDefaultFirestore() {
    resetState();

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(getFirestoreArguments, [[]]);
    assert.deepStrictEqual(deleteCalls, [
        "authCredentials/user-1/providers",
        "users/user-1"
    ]);
    assert.deepStrictEqual(loggerErrors, []);
}

// 한 루트 삭제 실패가 다른 루트 삭제를 막지 않는지 검증합니다.
async function assertEachRootDeletionIsAttemptedAfterFailure() {
    resetState();
    failedPaths.add("users/user-1");

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /사용자 Firestore 데이터 삭제에 실패했습니다/
    );

    assert.deepStrictEqual(deleteCalls, [
        "authCredentials/user-1/providers",
        "users/user-1"
    ]);
    assert.strictEqual(loggerErrors.length, 1);
}

// GitHub credential이 있으면 grant를 폐기한 뒤 credential 루트를 삭제하는지 검증합니다.
async function assertGithubGrantIsRevokedBeforeCredentialRootDeletion() {
    resetState();
    githubCredentialTokens.set("user-1", {
        accessToken: "github-token",
        clientId: "github-client-id"
    });

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(revokeCalls.map((call) => ({
        uid: call.uid,
        clientId: call.configuration.clientId,
        accessToken: call.credential.accessToken
    })), [{
        uid: "user-1",
        clientId: "github-client-id",
        accessToken: "github-token"
    }]);
    assert.deepStrictEqual(lifecycleEvents, [
        "deletion-marker",
        "github-credential-read",
        "github-grant-revoke",
        "google-credential-read",
        "delete:authCredentials/user-1/providers",
        "delete:users/user-1"
    ]);
}

// Google credential이 있으면 grant를 폐기한 뒤 credential 루트를 삭제하는지 검증합니다.
async function assertGoogleGrantIsRevokedBeforeCredentialRootDeletion() {
    resetState();
    googleCredentialTokens.set("user-1", {
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        clientId: "retired-google-client-id"
    });

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(googleRevokeCalls, [{
        uid: "user-1",
        credential: {
            accessToken: "google-access-token",
            refreshToken: "google-refresh-token",
            clientId: "retired-google-client-id"
        }
    }]);
    assert.ok(
        lifecycleEvents.indexOf("google-grant-revoke") <
        lifecycleEvents.indexOf("delete:authCredentials/user-1/providers")
    );
}

// GitHub 폐기 실패 뒤에도 같은 project의 Google grant 폐기를 시도하는지 검증합니다.
async function assertGoogleGrantIsAttemptedAfterGithubFailure() {
    resetState();
    githubCredentialTokens.set("user-1", {
        accessToken: "github-token",
        clientId: "github-client-id"
    });
    googleCredentialTokens.set("user-1", {
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        clientId: "google-client-id"
    });
    githubRevocationShouldFail = true;

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /사용자 Firestore 데이터 삭제에 실패했습니다/
    );

    assert.strictEqual(googleRevokeCalls.length, 1);
    assert.deepStrictEqual(deleteCalls, []);
}

// Google 폐기 실패 시 credential과 사용자 루트 삭제를 건너뛰는지 검증합니다.
async function assertRootCleanupIsSkippedAfterGoogleFailure() {
    resetState();
    googleCredentialTokens.set("user-1", {
        accessToken: "google-access-token",
        refreshToken: "google-refresh-token",
        clientId: "google-client-id"
    });
    googleRevocationShouldFail = true;

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /사용자 Firestore 데이터 삭제에 실패했습니다/
    );

    assert.deepStrictEqual(deleteCalls, []);
}

// 삭제 표식 기록 실패 시 provider와 사용자 자료 정리를 건너뛰는지 검증합니다.
async function assertMarkerFailureSkipsCleanup() {
    resetState();
    markerShouldFail = true;

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /사용자 Firestore 데이터 삭제에 실패했습니다/
    );

    assert.strictEqual(
        lifecycleEvents.some((event) => event.includes("credential")),
        false
    );
    assert.deepStrictEqual(deleteCalls, []);
}

// 테스트에서 사용할 기본 Firestore를 구성합니다.
function fakeFirestore() {
    return {
        doc(path) {
            return {
                path,
                async set() {
                    lifecycleEvents.push("deletion-marker");
                    if (markerShouldFail) {
                        throw new Error("deletion marker failed");
                    }
                }
            };
        },
        collection(path) {
            return { path };
        },
        async recursiveDelete(reference) {
            lifecycleEvents.push(`delete:${reference.path}`);
            deleteCalls.push(reference.path);
            if (failedPaths.has(reference.path)) {
                throw new Error("recursive delete failed");
            }
        }
    };
}

// 사용자 삭제 기능 테스트의 공유 상태를 초기화합니다.
function resetState() {
    getFirestoreArguments.length = 0;
    deleteCalls.length = 0;
    loggerErrors.length = 0;
    revokeCalls.length = 0;
    googleRevokeCalls.length = 0;
    lifecycleEvents.length = 0;
    failedPaths.clear();
    githubCredentialTokens.clear();
    googleCredentialTokens.clear();
    markerShouldFail = false;
    githubRevocationShouldFail = false;
    googleRevocationShouldFail = false;
}
