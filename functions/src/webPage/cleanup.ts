import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldPath } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import {
    FirestoreDatabase,
    firebaseDBs,
    firestoreFor
} from "../common/firestore";

const LOCATION = "asia-northeast3";
const CLEANUP_BATCH_SIZE = 200;

export const cleanupSoftDeletedWebPages = onSchedule({
        maxInstances: 1,
        region: LOCATION,
        schedule: "0 0 * * *",
        timeZone: "UTC"
    },
    async () => {
        try {
            for (const firebaseDB of firebaseDBs()) {
                await cleanupSoftDeletedWebPagesIn(firebaseDB);
            }
        } catch (error) {
            logger.error("soft delete WebPage cleanup 실패", toError(error), {
                collectionGroup: "webPages",
                filter: "isDeleted == true",
                orderBy: "documentId",
                cleanupBatchSize: CLEANUP_BATCH_SIZE
            });
        }
    }
);

// cleanupSoftDeletedWebPagesIn은 하나의 Firestore 데이터베이스에서 삭제 표시된 WebPage 문서를 제거합니다.
async function cleanupSoftDeletedWebPagesIn(firebaseDB: FirestoreDatabase): Promise<void> {
    const db = firestoreFor(firebaseDB);
    let lastDocument:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData> | undefined;

    while (true) {
        let query = db
            .collectionGroup("webPages")
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
