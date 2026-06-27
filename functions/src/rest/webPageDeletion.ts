import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestorePath } from "../common/firestorePath";

export async function requestWebPageDeletionByDocumentID(
    db: FirebaseFirestore.Firestore,
    userId: string,
    webPageId: string
): Promise<void> {
    const webPageRef = db.doc(FirestorePath.webPage(userId, webPageId));
    const webPageSnapshot = await webPageRef.get();

    if (!webPageSnapshot.exists || webPageSnapshot.data()?.isDeleted === true) {
        throw new HttpsError("not-found", "WebPage를 찾을 수 없습니다.");
    }

    await requestWebPageDeletionWithReference(webPageRef, { userId, webPageId });
}

export async function undoWebPageDeletionByDocumentID(
    db: FirebaseFirestore.Firestore,
    userId: string,
    webPageId: string
): Promise<void> {
    const webPageRef = db.doc(FirestorePath.webPage(userId, webPageId));
    await undoWebPageDeletionWithReference(webPageRef, { userId, webPageId });
}

async function requestWebPageDeletionWithReference(
    webPageRef: FirebaseFirestore.DocumentReference,
    logContext: Record<string, string>
): Promise<void> {
    try {
        await webPageRef.set({
            deletingAt: FieldValue.delete(),
            isDeleted: true
        }, { merge: true });
    } catch (error) {
        try {
            const currentWebPageSnapshot = await webPageRef.get();
            if (currentWebPageSnapshot.exists && currentWebPageSnapshot.data()?.isDeleted === true) {
                await webPageRef.update({
                    deletingAt: FieldValue.delete(),
                    isDeleted: false
                });
            }
        } catch (cleanupError) {
            logger.error("웹페이지 삭제 요청 cleanup 실패", toError(cleanupError), logContext);
        }

        logger.error("웹페이지 삭제 요청 실패", toError(error), logContext);
        throw new HttpsError("internal", "웹페이지 삭제 요청에 실패했습니다.");
    }
}

async function undoWebPageDeletionWithReference(
    webPageRef: FirebaseFirestore.DocumentReference,
    logContext: Record<string, string>
): Promise<void> {
    try {
        const currentWebPageSnapshot = await webPageRef.get();
        if (currentWebPageSnapshot.exists && currentWebPageSnapshot.data()?.isDeleted === true) {
            await webPageRef.update({
                deletingAt: FieldValue.delete(),
                isDeleted: false
            });
        }
    } catch (error) {
        logger.error("웹페이지 삭제 취소 실패", toError(error), logContext);
        throw new HttpsError("internal", "웹페이지 삭제 취소에 실패했습니다.");
    }
}
