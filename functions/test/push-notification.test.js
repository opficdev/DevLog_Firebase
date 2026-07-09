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

require.cache[require.resolve("../lib/common/firestore")] = {
    exports: {
        firebaseDBs: () => ["prod"],
        firestoreFor: () => fakeFirestore(),
        isFirebaseDB: (value) => value === "prod"
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
            isCompleted: false
        }
    );
    firestoreDocs.set(
        "users/user-1/userData/tokens",
        {
            fcmToken: "fcm-token"
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
            firebaseDB: "prod",
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10",
            title: "DevLog",
            body: "Todo reminder"
        }
    });

    assert.ok(
        writtenDocs.some((item) => item.path === "users/user-1/notificationDispatches/todo-1_2026-07-10"),
        "dispatch document should keep todoId_dueDateKey id."
    );
    const notificationWrite = writtenDocs.find(
        (item) => item.path === "users/user-1/notifications/todo-1"
    );

    assert.ok(notificationWrite, "notification document should use todoId id.");
    assert.strictEqual(notificationWrite.data.isRead, false);
    assert.ok(
        deletedDocs.includes("users/user-1/notifications/todo-1_2026-07-09"),
        "legacy notification documents for the same todo should be deleted."
    );
    assert.strictEqual(sentMessages.length, 1);

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
            fcmToken: "fcm-token"
        }
    );

    await sendPushNotification.run({
        data: {
            firebaseDB: "prod",
            userId: "user-1",
            todoId: "todo-1",
            dueDateKey: "2026-07-10",
            title: "DevLog",
            body: "Todo reminder"
        }
    });

    assert.ok(
        writtenDocs.some((item) => item.path === "users/user-1/notifications/todo-1"),
        "notification document should be written when legacy documents do not exist."
    );
    assert.strictEqual(deletedDocs.length, 0);
    assert.strictEqual(sentMessages.length, 1);
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
            firestoreDocs.set(path, {
                ...(firestoreDocs.get(path) ?? {}),
                ...data
            });
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
        limit() {
            return this;
        },
        orderBy() {
            return this;
        },
        startAfter() {
            return this;
        },
        async get() {
            const docs = matchingDocuments(path, filters)
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
        .filter(([, data]) => filters.every((filter) => data[filter.field] === filter.value));
}

function fakeTransaction() {
    return {
        async get(documentRef) {
            return fakeDocumentSnapshot(documentRef.path);
        },
        set(documentRef, data) {
            writtenDocs.push({ path: documentRef.path, data });
            firestoreDocs.set(documentRef.path, {
                ...(firestoreDocs.get(documentRef.path) ?? {}),
                ...data
            });
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
                    firestoreDocs.set(update.path, {
                        ...(firestoreDocs.get(update.path) ?? {}),
                        ...update.data
                    });
                } else {
                    deletedDocs.push(update.path);
                    firestoreDocs.delete(update.path);
                }
            });
        }
    };
}
