import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";

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
            await cleanupSoftDeletedWebPagesIn();
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

// 현재 Firebase project의 기본 Firestore에서 삭제 표시된 웹 페이지 문서를 제거합니다.
async function cleanupSoftDeletedWebPagesIn(): Promise<void> {
    const db = getFirestore();
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
