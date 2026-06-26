import { HttpsError } from "firebase-functions/v2/https";
import { FieldPath, FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestorePath } from "../common/firestorePath";

const QUERY_BATCH_SIZE = 200;

export async function requestTodoDeletionInFirestore(
    db: FirebaseFirestore.Firestore,
    userId: string,
    todoId: string
): Promise<void> {
    const todoRef = db.doc(FirestorePath.todo(userId, todoId));
    const todoSnapshot = await todoRef.get();

    if (!todoSnapshot.exists || todoSnapshot.data()?.deletedAt) {
        throw new HttpsError("not-found", "Todo를 찾을 수 없습니다.");
    }

    try {
        await todoRef.set({
            deletedAt: FieldValue.serverTimestamp(),
            isDeleting: FieldValue.delete(),
            isDeleted: FieldValue.delete()
        }, {merge: true});

        await updateNotificationsDeletionState(
            db,
            userId,
            todoId,
            {
                deletingAt: FieldValue.delete(),
                isDeleted: true
            }
        );
    } catch (error) {
        const currentTodoSnapshot = await todoRef.get();

        if (currentTodoSnapshot.exists && !currentTodoSnapshot.data()?.deletedAt) {
            await todoRef.update({
                deletedAt: null,
                isDeleting: FieldValue.delete(),
                isDeleted: FieldValue.delete()
            });
        }

        await updateNotificationsDeletionState(
            db,
            userId,
            todoId,
            {
                deletingAt: FieldValue.delete(),
                isDeleted: false
            }
        );

        logger.error("todo 삭제 요청 실패", toError(error), {
            userId,
            todoId
        });
        throw new HttpsError("internal", "Todo 삭제 요청에 실패했습니다.");
    }
}

export async function undoTodoDeletionInFirestore(
    db: FirebaseFirestore.Firestore,
    userId: string,
    todoId: string
): Promise<void> {
    try {
        const todoRef = db.doc(FirestorePath.todo(userId, todoId));
        const todoSnapshot = await todoRef.get();

        if (todoSnapshot.exists && !!todoSnapshot.data()?.deletedAt) {
            await todoRef.update({
                deletedAt: null,
                isDeleting: FieldValue.delete(),
                isDeleted: FieldValue.delete()
            });
        }

        await updateNotificationsDeletionState(
            db,
            userId,
            todoId,
            {
                deletingAt: FieldValue.delete(),
                isDeleted: false
            }
        );
    } catch (error) {
        logger.error("todo 삭제 취소 실패", toError(error), {
            userId,
            todoId
        });
        throw new HttpsError("internal", "Todo 삭제 취소에 실패했습니다.");
    }
}

async function updateNotificationsDeletionState(
    db: FirebaseFirestore.Firestore,
    userId: string,
    todoId: string,
    data: { [key: string]: FirebaseFirestore.FieldValue | boolean }
): Promise<void> {
    let lastDocument: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | undefined

    while (true) {
        let query = db
            .collection(FirestorePath.notifications(userId))
            .where("todoId", "==", todoId)
            .orderBy(FieldPath.documentId())
            .limit(QUERY_BATCH_SIZE)
        if (lastDocument) {
            query = query.startAfter(lastDocument);
        }

        const snapshot = await query.get();

        if (snapshot.empty) { return; }

        const batch = db.batch();
        snapshot.docs.forEach((document) => {
            batch.update(document.ref, data);
        });
        await batch.commit();

        if (snapshot.size < QUERY_BATCH_SIZE) { return; }
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }
}
