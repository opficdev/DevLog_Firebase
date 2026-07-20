const assert = require("assert");

const firestoreDocs = new Map();
const writtenDocs = [];
const deletedDocs = [];
const sentMessages = [];

class FakeTimestamp {}

const fakeMessaging = {
    async send(message) {
        sentMessages.push(message);
        return "message-id";
    }
};

require.cache[require.resolve("firebase-admin")] = {
    exports: {
        firestore: {
            Timestamp: FakeTimestamp
        },
        messaging: () => fakeMessaging
    }
};

const firestore = require("firebase-admin/firestore");
require.cache[require.resolve("firebase-admin/firestore")] = {
    exports: {
        ...firestore,
        getFirestore: () => fakeFirestore()
    }
};

const { sendPushNotification } = require("../lib/fcm/notification");

(async () => {
    resetStores();

    firestoreDocs.set(
        "users/user-1/userData/settings",
        {
            allowPushNotification: true,
            timeZone: "UTC"
        }
    );
    firestoreDocs.set(
        "users/user-1/todoLists/todo-1",
        {
            dueDate: new Date("2026-07-10T09:00:00.000Z"),
            category: "work",
            isCompleted: false,
            title: " \n\t "
        }
    );
    firestoreDocs.set(
        "users/user-1/userData/tokens",
        {
            fcmToken: "fcm-token"
        }
    );
    firestoreDocs.set(
        "users/user-1/notifications/todo-1",
        {
            title: "기존 제목",
            body: "기존 본문",
            todoTitle: "기존 Todo 제목",
            receivedAt: new Date("2026-07-09T09:00:00.000Z"),
            isRead: true,
            isDeleted: true,
            todoId: "todo-1",
            todoCategory: "personal"
        }
    );
    firestoreDocs.set(
        "users/user-1/notifications/todo-1_2026-07-09",
        {
            todoId: "todo-1",
            isRead: true,
            isDeleted: false
        }
    );

    await sendPushNotification.run({
        data: {
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10",
            title: "DevLog",
            body: "Todo reminder"
        }
    });

    assert.ok(
        writtenDocs.some((item) => item.path === "users/user-1/notificationDispatches/todo-1_2026-07-10"),
        "dispatch 문서는 todoId_dueDateKey id를 유지해야 합니다."
    );
    const notificationWrite = writtenDocs.find(
        (item) => item.path === "users/user-1/notifications/todo-1"
    );

    assert.ok(notificationWrite, "notification 문서는 todoId id를 사용해야 합니다.");
    const titlelessNotification = firestoreDocs.get("users/user-1/notifications/todo-1");

    assert.strictEqual(titlelessNotification.title, undefined);
    assert.strictEqual(titlelessNotification.body, undefined);
    assert.strictEqual(titlelessNotification.todoTitle, undefined);
    assert.ok(titlelessNotification.receivedAt);
    assert.strictEqual(titlelessNotification.isRead, false);
    assert.strictEqual(titlelessNotification.isDeleted, false);
    assert.strictEqual(titlelessNotification.todoId, "todo-1");
    assert.strictEqual(titlelessNotification.todoCategory, "work");
    assert.ok(
        deletedDocs.includes("users/user-1/notifications/todo-1_2026-07-09"),
        "같은 todo의 기존 notification 문서는 삭제되어야 합니다."
    );
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(
        sentMessages[0].notification,
        {
            title: "DevLog",
            body: "제목 없는 Todo의 마감일이 내일입니다."
        }
    );

    resetStores();

    firestoreDocs.set(
        "users/user-1/userData/settings",
        {
            allowPushNotification: true,
            timeZone: "UTC"
        }
    );
    firestoreDocs.set(
        "users/user-1/todoLists/todo-1",
        {
            dueDate: new Date("2026-07-10T09:00:00.000Z"),
            category: "work",
            isCompleted: false,
            title: "  테스트 작성  "
        }
    );
    firestoreDocs.set(
        "users/user-1/userData/tokens",
        {
            fcmToken: "fcm-token",
            pushLanguageCode: "en"
        }
    );

    await sendPushNotification.run({
        data: {
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10"
        }
    });

    assert.ok(
        writtenDocs.some((item) => item.path === "users/user-1/notifications/todo-1"),
        "기존 문서가 없어도 notification 문서가 작성되어야 합니다."
    );
    const titledNotification = firestoreDocs.get("users/user-1/notifications/todo-1");

    assert.strictEqual(titledNotification.title, undefined);
    assert.strictEqual(titledNotification.body, undefined);
    assert.strictEqual(titledNotification.todoTitle, "  테스트 작성  ");
    assert.ok(titledNotification.receivedAt);
    assert.strictEqual(titledNotification.isRead, false);
    assert.strictEqual(titledNotification.isDeleted, false);
    assert.strictEqual(titledNotification.todoId, "todo-1");
    assert.strictEqual(titledNotification.todoCategory, "work");
    assert.strictEqual(deletedDocs.length, 0);
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(
        sentMessages[0].notification,
        {
            title: "DevLog",
            body: "  테스트 작성   is due tomorrow."
        }
    );

    resetStores();

    firestoreDocs.set(
        "users/user-1/userData/settings",
        {
            allowPushNotification: true,
            timeZone: "UTC"
        }
    );
    firestoreDocs.set(
        "users/user-1/todoLists/todo-1",
        {
            dueDate: new Date("2026-07-10T09:00:00.000Z"),
            category: "work",
            isCompleted: false
        }
    );
    firestoreDocs.set(
        "users/user-1/userData/tokens",
        {
            fcmToken: "fcm-token",
            pushLanguageCode: "ja"
        }
    );

    for (let index = 0; index < 201; index += 1) {
        firestoreDocs.set(
            `users/user-1/notifications/todo-1_legacy-${String(index).padStart(3, "0")}`,
            {
                todoId: "todo-1",
                isRead: true,
                isDeleted: false
            }
        );
    }

    await sendPushNotification.run({
        data: {
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10",
            title: "DevLog",
            body: "Todo reminder"
        }
    });

    assert.ok(
        writtenDocs.some((item) => item.path === "users/user-1/notifications/todo-1"),
        "cleanup이 여러 batch로 나뉘어도 notification 문서가 작성되어야 합니다."
    );
    assert.strictEqual(deletedDocs.length, 201);
    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(
        sentMessages[0].notification,
        {
            title: "DevLog",
            body: "제목 없는 Todo의 마감일이 내일입니다."
        }
    );

    resetStores();
    setReminderDocuments("영어 공부", "ko");

    await sendPushNotification.run({
        data: {
            firebaseDB: "prod",
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10"
        }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(
        sentMessages[0].notification,
        {
            title: "DevLog",
            body: "'영어 공부'의 마감일이 내일입니다."
        }
    );

    resetStores();
    setReminderDocuments(undefined, "en");

    await sendPushNotification.run({
        data: {
            firebaseDB: "prod",
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10"
        }
    });

    assert.strictEqual(sentMessages.length, 1);
    assert.deepStrictEqual(
        sentMessages[0].notification,
        {
            title: "DevLog",
            body: "An untitled Todo is due tomorrow."
        }
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

function resetStores() {
    firestoreDocs.clear();
    writtenDocs.length = 0;
    deletedDocs.length = 0;
    sentMessages.length = 0;
}

function setReminderDocuments(title, pushLanguageCode) {
    firestoreDocs.set(
        "users/user-1/userData/settings",
        {
            allowPushNotification: true,
            timeZone: "UTC"
        }
    );
    firestoreDocs.set(
        "users/user-1/todoLists/todo-1",
        {
            dueDate: new Date("2026-07-10T09:00:00.000Z"),
            category: "work",
            isCompleted: false,
            ...(title === undefined ? {} : { title })
        }
    );
    firestoreDocs.set(
        "users/user-1/userData/tokens",
        {
            fcmToken: "fcm-token",
            pushLanguageCode
        }
    );
}

function fakeFirestore() {
    return {
        doc(path) {
            return fakeDocumentReference(path);
        },
        collection(path) {
            return fakeCollectionReference(path);
        },
        batch() {
            return fakeBatch();
        },
        async runTransaction(callback) {
            return callback(fakeTransaction());
        }
    };
}

function fakeDocumentReference(path) {
    return {
        path,
        async get() {
            return fakeDocumentSnapshot(path);
        },
        async set(data) {
            writtenDocs.push({ path, data });
            applyDocumentWrite(path, data);
        },
        async delete() {
            deletedDocs.push(path);
            firestoreDocs.delete(path);
        }
    };
}

function fakeDocumentSnapshot(path) {
    const data = firestoreDocs.get(path);

    return {
        exists: data !== undefined,
        data: () => data
    };
}

function fakeCollectionReference(path) {
    return {
        where(field, operator, value) {
            return fakeQuery(path, [
                { field, operator, value }
            ]);
        }
    };
}

function fakeQuery(path, filters) {
    return {
        _limit: undefined,
        where(field, operator, value) {
            return fakeQuery(path, [
                ...filters,
                { field, operator, value }
            ]);
        },
        count() {
            return {
                async get() {
                    return {
                        data: () => ({
                            count: matchingDocuments(path, filters).length
                        })
                    };
                }
            };
        },
        limit(size) {
            this._limit = size;
            return this;
        },
        orderBy() {
            return this;
        },
        startAfter() {
            return this;
        },
        async get() {
            let entries = matchingDocuments(path, filters);
            if (this._limit !== undefined) {
                entries = entries.slice(0, this._limit);
            }

            const docs = entries
                .map(([documentPath, data]) => ({
                    id: documentPath.split("/").pop(),
                    ref: fakeDocumentReference(documentPath),
                    data: () => data
                }));

            return {
                empty: docs.length === 0,
                size: docs.length,
                docs
            };
        }
    };
}

function matchingDocuments(path, filters) {
    const prefix = `${path}/`;

    return Array.from(firestoreDocs.entries())
        .filter(([documentPath]) => documentPath.startsWith(prefix))
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .filter(([, data]) => filters.every((filter) => data[filter.field] === filter.value));
}

function fakeTransaction() {
    return {
        async get(documentRef) {
            return fakeDocumentSnapshot(documentRef.path);
        },
        set(documentRef, data) {
            writtenDocs.push({ path: documentRef.path, data });
            applyDocumentWrite(documentRef.path, data);
        }
    };
}

function fakeBatch() {
    const updates = [];

    return {
        set(documentRef, data) {
            updates.push({
                type: "set",
                path: documentRef.path,
                data
            });
        },
        delete(documentRef) {
            updates.push({
                type: "delete",
                path: documentRef.path
            });
        },
        async commit() {
            updates.forEach((update) => {
                if (update.type === "set") {
                    writtenDocs.push({
                        path: update.path,
                        data: update.data
                    });
                    applyDocumentWrite(update.path, update.data);
                } else {
                    deletedDocs.push(update.path);
                    firestoreDocs.delete(update.path);
                }
            });
        }
    };
}

function applyDocumentWrite(path, data) {
    const document = {
        ...(firestoreDocs.get(path) ?? {})
    };

    Object.entries(data).forEach(([field, value]) => {
        if (value?.constructor?.name === "DeleteTransform") {
            delete document[field];
        } else {
            document[field] = value;
        }
    });
    firestoreDocs.set(path, document);
}
