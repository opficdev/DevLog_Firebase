const assert = require("assert");
const functionsTest = require("firebase-functions-test")();

const deleteCalls = [];
const failedPaths = new Set();
const loggerErrors = [];
const credentialTokens = new Map();
const revokeCalls = [];
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
            lifecycleEvents.push(`${db.firebaseDB}:credential-read`);
            return credentialTokens.get(uid);
        },
        revokeGithubCredential: async (db, uid, configuration, credential) => {
            lifecycleEvents.push(`${db.firebaseDB}:grant-revoke`);
            revokeCalls.push({ uid, configuration, credential });
        },
        revokePendingGithubCredentials: async () => {}
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
    credentialTokens.set("user-1", {
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
        "staging:credential-read",
        "staging:grant-revoke",
        "staging:delete:authCredentials/user-1/providers",
        "staging:delete:users/user-1",
        "prod:deletion-marker",
        "prod:credential-read",
        "prod:grant-revoke",
        "prod:delete:authCredentials/user-1/providers",
        "prod:delete:users/user-1"
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
    lifecycleEvents.length = 0;
    failedPaths.clear();
    credentialTokens.clear();
}
