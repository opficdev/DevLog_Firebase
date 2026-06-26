import { HttpsError } from "firebase-functions/v2/https";
import { FieldValue } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestorePath } from "../common/firestorePath";

export async function requestPushNotificationDeletionInFirestore(
    db: FirebaseFirestore.Firestore,
    userId: string,
    notificationId: string
): Promise<void> {
    const notificationRef = db.doc(FirestorePath.notification(userId, notificationId));
    const notificationSnapshot = await notificationRef.get();

    if (!notificationSnapshot.exists || notificationSnapshot.data()?.isDeleted === true) {
        throw new HttpsError("not-found", "Notification을 찾을 수 없습니다.");
    }

    try {
        await notificationRef.set({
            deletingAt: FieldValue.delete(),
            isDeleted: true
        }, {merge: true});
    } catch (error) {
        try {
            const currentNotificationSnapshot = await notificationRef.get();
            if (currentNotificationSnapshot.exists && currentNotificationSnapshot.data()?.isDeleted === true) {
                await notificationRef.update({
                    deletingAt: FieldValue.delete(),
                    isDeleted: false
                });
            }
        } catch (cleanupError) {
            logger.error("푸시 알림 삭제 요청 cleanup 실패", toError(cleanupError), { userId, notificationId });
        }

        logger.error("푸시 알림 삭제 요청 실패", toError(error), { userId, notificationId });
        throw new HttpsError("internal", "푸시 알림 삭제 요청에 실패했습니다.");
    }
}

export async function undoPushNotificationDeletionInFirestore(
    db: FirebaseFirestore.Firestore,
    userId: string,
    notificationId: string
): Promise<void> {
    const notificationRef = db.doc(FirestorePath.notification(userId, notificationId));

    try {
        const notificationSnapshot = await notificationRef.get();
        if (notificationSnapshot.exists && notificationSnapshot.data()?.isDeleted === true) {
            await notificationRef.update({
                deletingAt: FieldValue.delete(),
                isDeleted: false
            });
        }
    } catch (error) {
        logger.error("푸시 알림 삭제 취소 실패", toError(error), {
            userId,
            notificationId
        });
        throw new HttpsError("internal", "푸시 알림 삭제 취소에 실패했습니다.");
    }
}
