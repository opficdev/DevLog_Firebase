import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { FieldPath } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestoreDatabase, firestoreFor } from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";

const LOCATION = "asia-northeast3";
const BATCH_SIZE = 200;

// syncTodoNotificationCategory는 지정한 Firestore 데이터베이스에서 Todo 카테고리 변경 시 알림 문서 카테고리를 동기화하는 함수를 반환합니다.
export function syncTodoNotificationCategory(firebaseDB: FirestoreDatabase) {
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

        const beforeCategory = typeof beforeData?.category === "string" ? beforeData.category.trim() : "";
        const afterCategory = typeof afterData?.category === "string" ? afterData.category.trim() : "";

        if (!beforeCategory || !afterCategory || beforeCategory == afterCategory) {
            return;
        }

        try {
            await updateNotifications(firestoreFor(firebaseDB), userId, todoId, afterCategory);
        } catch (error) {
            logger.error("todo 카테고리 변경 후 알림 데이터 동기화 실패", toError(error), {
                firebaseDB,
                userId,
                todoId,
                beforeCategory,
                afterCategory
            });
            throw error;
        }
    }
    );
}

// 변경된 카테고리 값의 해당 Todo 알림 문서 반영
async function updateNotifications(
    db: FirebaseFirestore.Firestore,
    userId: string,
    todoId: string,
    todoCategory: string
): Promise<void> {
    await updateNotificationBatch(db, userId, todoId, todoCategory);
}

// 알림 문서의 배치 단위 순회 및 카테고리 값 갱신
async function updateNotificationBatch(
    db: FirebaseFirestore.Firestore,
    userId: string,
    todoId: string,
    todoCategory: string,
    lastDocument?:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
): Promise<void> {
    let query = db
        .collection(FirestorePath.notifications(userId))
        .where("todoId", "==", todoId)
        .orderBy(FieldPath.documentId())
        .limit(BATCH_SIZE);

    if (lastDocument) {
        query = query.startAfter(lastDocument);
    }

    const snapshot = await query.get();
    if (snapshot.empty) { return; }

    const batch = db.batch();
    snapshot.docs.forEach((document) => {
        batch.update(document.ref, { todoCategory });
    });
    await batch.commit();

    if (snapshot.size < BATCH_SIZE) { return; }

    await updateNotificationBatch(
        db,
        userId,
        todoId,
        todoCategory,
        snapshot.docs[snapshot.docs.length - 1]
    );
}
