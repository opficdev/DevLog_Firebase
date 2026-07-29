const assert = require("assert");

const enqueuedTasks = [];
const getFirestoreArguments = [];
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
        getFirestore: (...args) => {
            getFirestoreArguments.push(args);
            return fakeFirestore();
        }
    }
};

require.cache[require.resolve("firebase-functions/logger")] = {
    exports: {
        error() {}
    }
};

const { scheduleTodoReminder } = require("../lib/fcm/schedule");

(async () => {
    await scheduleTodoReminder.run({
        scheduleTime: "2026-07-09T09:00:00.000Z"
    });

    assert.deepStrictEqual(getFirestoreArguments, [[]]);
    assert.strictEqual(
        taskQueueName,
        "locations/asia-northeast3/functions/sendPushNotification"
    );
    assert.deepStrictEqual(enqueuedTasks, [
        {
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10"
        }
    ]);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 알림 설정과 마감 Todo를 반환하는 기본 Firestore 대역을 구성합니다.
function fakeFirestore() {
    return {
        collectionGroup(path) {
            assert.strictEqual(path, "userData");
            return fakeQuery([reminderSettingsDocument()]);
        },
        collection(path) {
            assert.strictEqual(path, "users/user-1/todoLists");
            return fakeQuery([reminderTodoDocument()]);
        }
    };
}

// 예약 알림 대상 설정 문서를 반환합니다.
function reminderSettingsDocument() {
    return {
        id: "settings",
        ref: {
            path: "users/user-1/userData/settings",
            parent: {
                parent: {
                    id: "user-1"
                }
            }
        },
        data() {
            return {
                allowPushNotification: true,
                pushNotificationHour: 9,
                pushNotificationMinute: 0,
                timeZone: "UTC"
            };
        }
    };
}

// 다음 날 마감되는 Todo 문서를 반환합니다.
function reminderTodoDocument() {
    return {
        id: "todo-1",
        data() {
            return {
                title: "마감 Todo"
            };
        }
    };
}

// 지정된 문서를 반환하는 Firestore 쿼리 대역을 구성합니다.
function fakeQuery(documents) {
    return {
        where() {
            return this;
        },
        async get() {
            return {
                docs: documents,
                empty: documents.length === 0,
                size: documents.length
            };
        }
    };
}
