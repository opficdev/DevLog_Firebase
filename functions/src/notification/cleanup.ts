import { onDocumentDeleted, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toDate } from "../common/date";
import { toError } from "../common/error";
import {
    FirestoreDatabase,
    firebaseDBs,
    firestoreFor
} from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";

const LOCATION = "asia-northeast3";
const CLEANUP_BATCH_SIZE = 200;
const DELETE_BATCH_SIZE = 200;
const QUERY_BATCH_SIZE = 100;

// 지정한 Firestore 데이터베이스에서 Todo 삭제 시 연결된 알림 문서를 제거하는 함수를 반환합니다.
export function removeTodoNotificationDocuments(firebaseDB: FirestoreDatabase) {
    return onDocumentDeleted({
        maxInstances: 1,
        database: firebaseDB,
        document: "users/{userId}/todoLists/{todoId}",
        region: LOCATION
    },
    async (event) => {
        const userId = event.params.userId;
        const todoId = event.params.todoId;

        try {
            const db = firestoreFor(firebaseDB);
            await deleteByTodoId(db, userId, "notificationDispatches", todoId);
            await deleteByTodoId(db, userId, "notifications", todoId);
        } catch (error) {
            logger.error(
                "todo 삭제 후 notification 문서 정리 실패",
                toError(error),
                {
                    firebaseDB,
                    userId,
                    todoId,
                    collections: ["notificationDispatches", "notifications"]
                }
            );
        }
    }
    );
}

// 지정한 Firestore 데이터베이스에서 완료된 Todo의 알림 발송 기록을 정리하는 함수를 반환합니다.
export function removeCompletedTodoNotificationRecords(firebaseDB: FirestoreDatabase) {
    return onDocumentUpdated({
        maxInstances: 1,
        database: firebaseDB,
        document: "users/{userId}/todoLists/{todoId}",
        region: LOCATION
    },
    async (event) => {
        const beforeData = event.data?.before.data();
        const afterData = event.data?.after.data();
        const userId = event.params.userId;
        const todoId = event.params.todoId;

        if (!beforeData || !afterData) { return; }
        if (beforeData.isCompleted === true || afterData.isCompleted !== true) { return; }

        const dueDate = toDate(afterData.dueDate);

        if (!dueDate || Date.now() <= dueDate.getTime()) { return; }

        try {
            await deleteByTodoId(firestoreFor(firebaseDB), userId, "notificationDispatches", todoId);
        } catch (error) {
            logger.error(
                "완료된 todo의 notification record 정리 실패",
                toError(error),
                {
                    firebaseDB,
                    userId,
                    todoId,
                    collection: "notificationDispatches"
                }
            );
        }
    }
    );
}

export const cleanupSoftDeletedNotifications = onSchedule({
        maxInstances: 1,
        region: LOCATION,
        schedule: "0 0 * * *",
        timeZone: "UTC"
    },
    async () => {
        try {
            for (const firebaseDB of firebaseDBs()) {
                await cleanupSoftDeletedNotificationsIn(firebaseDB);
            }
        } catch (error) {
            logger.error(
                "soft delete Notification cleanup 실패",
                toError(error),
                {
                    collectionGroup: "notifications",
                    filter: "isDeleted == true",
                    orderBy: "documentId",
                    cleanupBatchSize: CLEANUP_BATCH_SIZE
                }
            );
        }
    }
);

// 하나의 Firestore 데이터베이스에서 삭제 표시된 알림 문서를 제거합니다.
async function cleanupSoftDeletedNotificationsIn(firebaseDB: FirestoreDatabase): Promise<void> {
    const db = firestoreFor(firebaseDB);
    let lastDocument:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | undefined;

    while (true) {
        let query = db
            .collectionGroup("notifications")
            .where("isDeleted", "==", true)
            .orderBy(FieldPath.documentId())
            .limit(CLEANUP_BATCH_SIZE)
        if (lastDocument) {
            query = query.startAfter(lastDocument);
        }

        const snapshot = await query.get();

        if (snapshot.empty) { return; }

        const batch = db.batch();
        snapshot.docs.forEach((document) => {
            batch.delete(document.ref);
        });
        await batch.commit();

        if (snapshot.size < CLEANUP_BATCH_SIZE) { return; }
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }
}

// 더 이상 필요하지 않은 알림 발송 기록 정리
export const cleanupNotificationDispatches = onSchedule({
        maxInstances: 1,
        region: LOCATION,
        schedule: "0 0 * * *",
        timeZone: "UTC"
    },
    async () => {
        for (const firebaseDB of firebaseDBs()) {
            await cleanupNotificationDispatchesIn(firebaseDB);
        }
    }
);

// 하나의 Firestore 데이터베이스에서 불필요한 알림 발송 기록을 정리합니다.
async function cleanupNotificationDispatchesIn(firebaseDB: FirestoreDatabase): Promise<void> {
    const db = firestoreFor(firebaseDB);

    try {
        await cleanupDispatchesByTodoQuery(db, (lastDocument) => {
            let query = db
                .collectionGroup("todoLists")
                .where("isCompleted", "==", true)
                .where("dueDate", "<", Timestamp.now())
                .orderBy("dueDate")
                .orderBy(FieldPath.documentId())
                .limit(QUERY_BATCH_SIZE);

            if (lastDocument) {
                query = query.startAfter(lastDocument);
            }

            return query;
        });
    } catch (error) {
        logger.error(
            "지난 마감일의 완료된 todo notification record 정리 실패",
            toError(error),
            {
                firebaseDB,
                collectionGroup: "todoLists",
                filter: "isCompleted == true && dueDate < now",
                orderBy: ["dueDate", "documentId"],
                queryBatchSize: QUERY_BATCH_SIZE
            }
        );
    }

    try {
        await cleanupDispatchesByTodoQuery(db, (lastDocument) => {
            let query = db
                .collectionGroup("todoLists")
                .where("dueDate", "==", null)
                .orderBy(FieldPath.documentId())
                .limit(QUERY_BATCH_SIZE);

            if (lastDocument) {
                query = query.startAfter(lastDocument);
            }

            return query;
        });
    } catch (error) {
        logger.error(
            "마감일이 없는 todo notification record 정리 실패",
            toError(error),
            {
                firebaseDB,
                collectionGroup: "todoLists",
                filter: "dueDate == null",
                orderBy: "__name__",
                queryBatchSize: QUERY_BATCH_SIZE
            }
        );
    }
}

// Todo 조회 쿼리를 순회하며 연결된 알림 발송 기록을 정리
async function cleanupDispatchesByTodoQuery(
    db: FirebaseFirestore.Firestore,
    makeQuery: (
        lastDocument?:
            FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
    ) => FirebaseFirestore.Query<FirebaseFirestore.DocumentData>
): Promise<void> {
    let lastDocument:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | undefined;

    while (true) {
        const snapshot = await makeQuery(lastDocument).get();
        if (snapshot.empty) { return; }

        for (const todoDoc of snapshot.docs) {
            const userId = todoDoc.ref.parent.parent?.id;
            if (!userId) { continue; }

            await deleteByTodoId(db, userId, "notificationDispatches", todoDoc.id);
        }

        if (snapshot.size < QUERY_BATCH_SIZE) { return; }
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }
}

// 특정 Todo 연결 문서의 배치 단위 전체 삭제
async function deleteByTodoId(
    db: FirebaseFirestore.Firestore,
    userId: string,
    collectionName: "notificationDispatches" | "notifications",
    todoId: string
): Promise<void> {
    while (true) {
        const collectionPath = collectionName === "notificationDispatches" ?
            FirestorePath.notificationDispatches(userId) :
            FirestorePath.notifications(userId);
        const snapshot = await db
            .collection(collectionPath)
            .where("todoId", "==", todoId)
            .limit(DELETE_BATCH_SIZE)
            .get();

        if (snapshot.empty) { return; }

        const batch = db.batch();
        snapshot.docs.forEach((document) => {
            batch.delete(document.ref);
        });
        await batch.commit();

        if (snapshot.size < DELETE_BATCH_SIZE) { return; }
    }
}
