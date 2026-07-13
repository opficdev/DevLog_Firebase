const assert = require("assert");
const functionsTest = require("firebase-functions-test")();

const deleteCalls = [];
const failedPaths = new Set();
const failedMarkerDatabases = new Set();
const loggerErrors = [];
const githubCredentialTokens = new Map();
const googleCredentialTokens = new Map();
const failedGithubRevocationDatabases = new Set();
const failedGoogleRevocationDatabases = new Set();
const revokeCalls = [];
const googleRevokeCalls = [];
const lifecycleEvents = [];

require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        info() {},
        error(...values) {
            loggerErrors.push(values);
        }
    }
};
require.cache[require.resolve("../lib/common/firestore")] = {
    exports: {
        firebaseDBs: () => ["staging", "prod"],
        firestoreFor: (firebaseDB) => fakeFirestore(firebaseDB)
    }
};
require.cache[require.resolve("../lib/rest/githubConfiguration")] = {
    exports: {
        githubRevocationConfiguration: (firebaseDB) => ({
            clientId: `${firebaseDB}-client-id`,
            clientSecret: `${firebaseDB}-client-secret`,
            callbackURL: `https://example.com/${firebaseDB}/callback`
        })
    }
};
require.cache[require.resolve("../lib/rest/githubCredential")] = {
    exports: {
        githubCredentialForUser: async (db, uid) => {
            lifecycleEvents.push(`${db.firebaseDB}:github-credential-read`);
            return githubCredentialTokens.get(uid);
        },
        revokeGithubCredential: async (db, uid, configuration, credential) => {
            lifecycleEvents.push(`${db.firebaseDB}:grant-revoke`);
            revokeCalls.push({ uid, configuration, credential });
            if (failedGithubRevocationDatabases.has(db.firebaseDB)) {
                throw new Error("GitHub grant revoke failed");
            }
        },
        revokePendingGithubCredentials: async () => {}
    }
};
require.cache[require.resolve("../lib/rest/googleCredential")] = {
    exports: {
        googleCredentialForUser: async (db, uid) => {
            lifecycleEvents.push(`${db.firebaseDB}:google-credential-read`);
            return googleCredentialTokens.get(`${db.firebaseDB}:${uid}`);
        },
        revokeGoogleCredential: async (db, uid, credential) => {
            lifecycleEvents.push(`${db.firebaseDB}:google-grant-revoke`);
            googleRevokeCalls.push({ firebaseDB: db.firebaseDB, uid, credential });
            if (failedGoogleRevocationDatabases.has(db.firebaseDB)) {
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
    await assertBothRootsAreDeletedFromNamedDatabases();
    await assertEachRootDeletionIsAttemptedAfterFailure();
    await assertGithubGrantIsRevokedBeforeCredentialRootDeletion();
    await assertGoogleGrantIsRevokedBeforeCredentialRootDeletion();
    await assertGoogleGrantIsAttemptedAfterGithubFailure();
    await assertOtherDatabaseCleanupAfterGoogleFailure();
    await assertMarkerFailureSkipsDatabaseCleanup();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    functionsTest.cleanup();
});

// 각 named database에서 사용자 루트와 provider credential을 삭제하는지 검증합니다.
async function assertBothRootsAreDeletedFromNamedDatabases() {
    resetState();

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "staging", path: "authCredentials/user-1/providers" },
        { firebaseDB: "staging", path: "users/user-1" },
        { firebaseDB: "prod", path: "authCredentials/user-1/providers" },
        { firebaseDB: "prod", path: "users/user-1" }
    ]);
    assert.deepStrictEqual(loggerErrors, []);
}

// GitHub credential이 있으면 database별 grant를 폐기한 뒤 credential 루트를 삭제하는지 검증합니다.
async function assertGithubGrantIsRevokedBeforeCredentialRootDeletion() {
    resetState();
    githubCredentialTokens.set("user-1", {
        accessToken: "github-token",
        clientId: "staging-client-id"
    });

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(revokeCalls.map((call) => ({
        uid: call.uid,
        clientId: call.configuration.clientId,
        accessToken: call.credential.accessToken
    })), [
        { uid: "user-1", clientId: "staging-client-id", accessToken: "github-token" },
        { uid: "user-1", clientId: "prod-client-id", accessToken: "github-token" }
    ]);
    assert.deepStrictEqual(lifecycleEvents, [
        "staging:deletion-marker",
        "staging:github-credential-read",
        "staging:grant-revoke",
        "staging:google-credential-read",
        "staging:delete:authCredentials/user-1/providers",
        "staging:delete:users/user-1",
        "prod:deletion-marker",
        "prod:github-credential-read",
        "prod:grant-revoke",
        "prod:google-credential-read",
        "prod:delete:authCredentials/user-1/providers",
        "prod:delete:users/user-1"
    ]);
}

// Google credential이 있으면 해당 database grant를 폐기한 뒤 credential 루트를 삭제하는지 검증합니다.
async function assertGoogleGrantIsRevokedBeforeCredentialRootDeletion() {
    resetState();
    googleCredentialTokens.set("staging:user-1", {
        accessToken: "staging-access-token",
        refreshToken: "staging-refresh-token",
        clientId: "retired-staging-google-client-id"
    });
    googleCredentialTokens.set("prod:user-1", {
        accessToken: "prod-access-token",
        refreshToken: "prod-refresh-token",
        clientId: "retired-prod-google-client-id"
    });

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(googleRevokeCalls, [{
        firebaseDB: "staging",
        uid: "user-1",
        credential: {
            accessToken: "staging-access-token",
            refreshToken: "staging-refresh-token",
            clientId: "retired-staging-google-client-id"
        }
    }, {
        firebaseDB: "prod",
        uid: "user-1",
        credential: {
            accessToken: "prod-access-token",
            refreshToken: "prod-refresh-token",
            clientId: "retired-prod-google-client-id"
        }
    }]);
    assert.ok(
        lifecycleEvents.indexOf("staging:google-grant-revoke") <
        lifecycleEvents.indexOf("staging:delete:authCredentials/user-1/providers")
    );
    assert.ok(
        lifecycleEvents.indexOf("prod:google-grant-revoke") <
        lifecycleEvents.indexOf("prod:delete:authCredentials/user-1/providers")
    );
}

// GitHub 폐기 실패 뒤에도 같은 database의 Google grant와 다른 database 정리를 시도하는지 검증합니다.
async function assertGoogleGrantIsAttemptedAfterGithubFailure() {
    resetState();
    githubCredentialTokens.set("user-1", {
        accessToken: "github-token",
        clientId: "staging-client-id"
    });
    googleCredentialTokens.set("staging:user-1", {
        accessToken: "staging-access-token",
        refreshToken: "staging-refresh-token",
        clientId: "staging-google-client-id"
    });
    googleCredentialTokens.set("prod:user-1", {
        accessToken: "prod-access-token",
        refreshToken: "prod-refresh-token",
        clientId: "prod-google-client-id"
    });
    failedGithubRevocationDatabases.add("staging");

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다/
    );

    assert.deepStrictEqual(googleRevokeCalls.map((call) => ({
        firebaseDB: call.firebaseDB,
        accessToken: call.credential.accessToken
    })), [
        { firebaseDB: "staging", accessToken: "staging-access-token" },
        { firebaseDB: "prod", accessToken: "prod-access-token" }
    ]);
    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "prod", path: "authCredentials/user-1/providers" },
        { firebaseDB: "prod", path: "users/user-1" }
    ]);
}

// Google 폐기 실패 뒤에도 다음 database의 provider와 사용자 자료를 정리하는지 검증합니다.
async function assertOtherDatabaseCleanupAfterGoogleFailure() {
    resetState();
    googleCredentialTokens.set("staging:user-1", {
        accessToken: "staging-access-token",
        refreshToken: "staging-refresh-token",
        clientId: "staging-google-client-id"
    });
    googleCredentialTokens.set("prod:user-1", {
        accessToken: "prod-access-token",
        refreshToken: "prod-refresh-token",
        clientId: "prod-google-client-id"
    });
    failedGoogleRevocationDatabases.add("staging");

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다/
    );

    assert.deepStrictEqual(googleRevokeCalls.map((call) => call.firebaseDB), [
        "staging",
        "prod"
    ]);
    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "prod", path: "authCredentials/user-1/providers" },
        { firebaseDB: "prod", path: "users/user-1" }
    ]);
}

// 삭제 표식 기록 실패 시 해당 database 정리를 건너뛰고 다음 database를 처리하는지 검증합니다.
async function assertMarkerFailureSkipsDatabaseCleanup() {
    resetState();
    failedMarkerDatabases.add("staging");

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다/
    );

    assert.strictEqual(
        lifecycleEvents.some((event) => event.startsWith("staging:github")),
        false
    );
    assert.strictEqual(
        lifecycleEvents.some((event) => event.startsWith("staging:google")),
        false
    );
    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "prod", path: "authCredentials/user-1/providers" },
        { firebaseDB: "prod", path: "users/user-1" }
    ]);
}

// 한 루트 삭제 실패가 같은 database의 다른 루트 삭제를 막지 않는지 검증합니다.
async function assertEachRootDeletionIsAttemptedAfterFailure() {
    resetState();
    failedPaths.add("staging:users/user-1");

    await assert.rejects(
        () => wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" })),
        /일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다/
    );

    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "staging", path: "authCredentials/user-1/providers" },
        { firebaseDB: "staging", path: "users/user-1" },
        { firebaseDB: "prod", path: "authCredentials/user-1/providers" },
        { firebaseDB: "prod", path: "users/user-1" }
    ]);
    assert.strictEqual(loggerErrors.length, 1);
}

// 테스트에서 사용할 named database Firestore를 구성합니다.
function fakeFirestore(firebaseDB) {
    return {
        firebaseDB,
        doc(path) {
            return {
                path,
                async set() {
                    lifecycleEvents.push(`${firebaseDB}:deletion-marker`);
                    if (failedMarkerDatabases.has(firebaseDB)) {
                        throw new Error("deletion marker failed");
                    }
                }
            };
        },
        collection(path) {
            return { path };
        },
        async recursiveDelete(reference) {
            lifecycleEvents.push(`${firebaseDB}:delete:${reference.path}`);
            deleteCalls.push({ firebaseDB, path: reference.path });
            if (failedPaths.has(`${firebaseDB}:${reference.path}`)) {
                throw new Error("recursive delete failed");
            }
        }
    };
}

// 사용자 삭제 기능 테스트의 공유 상태를 초기화합니다.
function resetState() {
    deleteCalls.length = 0;
    loggerErrors.length = 0;
    revokeCalls.length = 0;
    googleRevokeCalls.length = 0;
    lifecycleEvents.length = 0;
    failedPaths.clear();
    failedMarkerDatabases.clear();
    failedGithubRevocationDatabases.clear();
    failedGoogleRevocationDatabases.clear();
    githubCredentialTokens.clear();
    googleCredentialTokens.clear();
}
