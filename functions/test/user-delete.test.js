const assert = require("assert");
const functionsTest = require("firebase-functions-test")();

const deleteCalls = [];
const failedPaths = new Set();
const loggerErrors = [];

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

const {
    cleanupDeletedUserFirestoreData
} = require("../lib/user/delete");
const wrapped = functionsTest.wrap(cleanupDeletedUserFirestoreData);

(async () => {
    await assertBothRootsAreDeletedFromNamedDatabases();
    await assertEachRootDeletionIsAttemptedAfterFailure();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    functionsTest.cleanup();
});

// 각 named database에서 사용자와 서버 credential 루트를 삭제하는지 검증합니다.
async function assertBothRootsAreDeletedFromNamedDatabases() {
    resetState();

    await wrapped(functionsTest.auth.makeUserRecord({ uid: "user-1" }));

    assert.deepStrictEqual(deleteCalls, [
        { firebaseDB: "staging", path: "users/user-1" },
        { firebaseDB: "staging", path: "authCredentials/user-1" },
        { firebaseDB: "prod", path: "users/user-1" },
        { firebaseDB: "prod", path: "authCredentials/user-1" }
    ]);
    assert.deepStrictEqual(loggerErrors, []);
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
        { firebaseDB: "staging", path: "users/user-1" },
        { firebaseDB: "staging", path: "authCredentials/user-1" },
        { firebaseDB: "prod", path: "users/user-1" },
        { firebaseDB: "prod", path: "authCredentials/user-1" }
    ]);
    assert.strictEqual(loggerErrors.length, 1);
}

// 테스트에서 사용할 named database Firestore를 구성합니다.
function fakeFirestore(firebaseDB) {
    return {
        doc(path) {
            return { path };
        },
        async recursiveDelete(reference) {
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
    failedPaths.clear();
}
