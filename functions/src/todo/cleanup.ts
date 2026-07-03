import { onSchedule } from "firebase-functions/v2/scheduler";
import {
    FieldPath,
    FieldValue,
    Timestamp
} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import {
    FirestoreDatabase,
    firebaseDBs,
    firestoreFor
} from "../common/firestore";

const LOCATION = "asia-northeast3";
const CLEANUP_BATCH_SIZE = 200;
const TOMBSTONE_GRACE_PERIOD_HOURS = 24;

// 삭제 후 유예 기간이 지난 todo를 표시용 최소 필드만 남는 축약 문서 형태로 압축
export const compactSoftDeletedTodos = onSchedule({
        maxInstances: 1,
        region: LOCATION,
        schedule: "0 9 * * *",
        timeZone: "Asia/Seoul"
    },
    async () => {
        const cutoff = new Date(Date.now() - (TOMBSTONE_GRACE_PERIOD_HOURS * 60 * 60 * 1000));

        try {
            for (const firebaseDB of firebaseDBs()) {
                await compactSoftDeletedTodosIn(firebaseDB, cutoff);
            }
        } catch (error) {
            logger.error(
                "soft deleted todo 축약 문서 압축 실패",
                toError(error),
                {
                    collectionGroup: "todoLists",
                    filter: `deletedAt <= now - ${TOMBSTONE_GRACE_PERIOD_HOURS}h`,
                    orderBy: ["deletedAt", "documentId"],
                    cleanupBatchSize: CLEANUP_BATCH_SIZE
                }
            );
        }
    }
);

// 하나의 Firestore 데이터베이스에서 삭제 유예 기간이 지난 Todo를 압축합니다.
async function compactSoftDeletedTodosIn(
    firebaseDB: FirestoreDatabase,
    cutoff: Date
): Promise<void> {
    const db = firestoreFor(firebaseDB);
    let lastDocument:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | undefined;

    while (true) {
        let query = db
            .collectionGroup("todoLists")
            .where("deletedAt", "<=", Timestamp.fromDate(cutoff))
            .orderBy("deletedAt")
            .orderBy(FieldPath.documentId())
            .limit(CLEANUP_BATCH_SIZE);
        if (lastDocument) {
            query = query.startAfter(lastDocument);
        }

        const snapshot = await query.get();
        if (snapshot.empty) { return; }

        const batch = db.batch();
        snapshot.docs.forEach((document) => {
            if (document.data()?.compactedAt) {
                return;
            }
            batch.update(document.ref, {
                compactedAt: FieldValue.serverTimestamp(),
                content: FieldValue.delete(),
                dueDate: FieldValue.delete(),
                isChecked: FieldValue.delete(),
                isCompleted: FieldValue.delete(),
                isDeleting: FieldValue.delete(),
                isPinned: FieldValue.delete(),
                isDeleted: FieldValue.delete(),
                tags: FieldValue.delete()
            });
        });
        await batch.commit();

        if (snapshot.size < CLEANUP_BATCH_SIZE) { return; }
        lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }
}
