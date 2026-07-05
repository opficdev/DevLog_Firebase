const assert = require("assert");
const { requestTodoDeletionInFirestore } = require("../lib/rest/todoDeletion");

(async () => {
    const db = fakeFirestore();

    await assert.rejects(
        () => requestTodoDeletionInFirestore(db, "user-1", "todo-1"),
        (error) => {
            assert.strictEqual(error.code, "internal");
            return true;
        }
    );

    assert.strictEqual(db.todoData.deletedAt, null);
    assert.strictEqual(db.notificationQueries, 2);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

function fakeFirestore() {
    const todoData = {
        title: "Todo"
    };
    let notificationQueries = 0;

    return {
        todoData,
        get notificationQueries() {
            return notificationQueries;
        },
        doc(path) {
            assert.strictEqual(path, "users/user-1/todoLists/todo-1");
            return {
                async get() {
                    return {
                        exists: true,
                        data: () => todoData
                    };
                },
                async set(data) {
                    Object.assign(todoData, data);
                },
                async update(data) {
                    Object.assign(todoData, data);
                }
            };
        },
        collection(path) {
            assert.strictEqual(path, "users/user-1/notifications");
            return fakeNotificationQuery(() => {
                notificationQueries += 1;
                if (notificationQueries === 1) {
                    throw new Error("notification update failed");
                }
                return {
                    empty: true
                };
            });
        },
        batch() {
            return {
                update() {},
                async commit() {}
            };
        }
    };
}

function fakeNotificationQuery(getSnapshot) {
    return {
        where() { return this; },
        orderBy() { return this; },
        limit() { return this; },
        startAfter() { return this; },
        get: getSnapshot
    };
}
