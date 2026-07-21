const assert = require("assert");

const enqueuedTasks = [];
const updatedTodos = [];
let taskQueueName;

require.cache[require.resolve("firebase-admin/functions")] = {
    exports: {
        getFunctions: () => ({
            taskQueue(name) {
                taskQueueName = name;
                return {
                    async enqueue(data) {
                        enqueuedTasks.push(data);
                    }
                };
            }
        })
    }
};

const firestore = require("firebase-admin/firestore");
require.cache[require.resolve("firebase-admin/firestore")] = {
    exports: {
        ...firestore,
        getFirestore: () => fakeFirestore()
    }
};

require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error() {},
        warn() {}
    }
};

const {
    completeMoveRemovedCategoryTodosToEtc,
    requestMoveRemovedCategoryTodosToEtc
} = require("../lib/todoCategory/update");

(async () => {
    await assertRemovedCategoryEnqueuesProjectTask();
    await assertCategoryTaskUpdatesDefaultFirestore();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 삭제된 사용자 카테고리마다 database 정보 없는 같은 project 작업을 적재하는지 검증합니다.
async function assertRemovedCategoryEnqueuesProjectTask() {
    enqueuedTasks.length = 0;
    taskQueueName = undefined;

    await requestMoveRemovedCategoryTodosToEtc.run({
        params: { userId: "user-1" },
        data: {
            before: {
                data: () => ({
                    items: [
                        { kind: "user", id: "removed-category" },
                        { kind: "user", id: "kept-category" }
                    ]
                })
            },
            after: {
                data: () => ({
                    items: [
                        { kind: "user", id: "kept-category" }
                    ]
                })
            }
        }
    });

    assert.strictEqual(
        requestMoveRemovedCategoryTodosToEtc.__endpoint.eventTrigger.eventFilters.database,
        "(default)"
    );
    assert.strictEqual(
        taskQueueName,
        "locations/asia-northeast3/functions/completeMoveRemovedCategoryTodosToEtc"
    );
    assert.deepStrictEqual(enqueuedTasks, [{
        userId: "user-1",
        id: "removed-category"
    }]);
}

// database 정보 없는 작업이 현재 project의 기본 Firestore에서 Todo 카테고리를 변경하는지 검증합니다.
async function assertCategoryTaskUpdatesDefaultFirestore() {
    updatedTodos.length = 0;

    await completeMoveRemovedCategoryTodosToEtc.run({
        data: {
            userId: "user-1",
            id: "removed-category"
        }
    });

    assert.deepStrictEqual(updatedTodos, [{
        path: "users/user-1/todoLists/todo-1",
        data: { category: "etc" }
    }]);
}

// 카테고리 정리 기능이 사용할 기본 Firestore 대역을 반환합니다.
function fakeFirestore() {
    return {
        collection(path) {
            return fakeQuery(path);
        },
        batch() {
            return {
                update(reference, data) {
                    updatedTodos.push({
                        path: reference.path,
                        data
                    });
                },
                async commit() {}
            };
        }
    };
}

// 하나의 삭제된 카테고리 Todo를 반환하는 쿼리 대역을 구성합니다.
function fakeQuery(path) {
    return {
        where() {
            return this;
        },
        orderBy() {
            return this;
        },
        limit() {
            return this;
        },
        startAfter() {
            return this;
        },
        async get() {
            const docs = [{
                ref: {
                    path: `${path}/todo-1`
                }
            }];
            return {
                docs,
                empty: false,
                size: docs.length
            };
        }
    };
}
