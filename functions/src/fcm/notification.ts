import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { createHash } from "crypto";
import * as admin from "firebase-admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import type { Message } from "firebase-admin/messaging";
import * as logger from "firebase-functions/logger";
import { formatDateKey, toDate } from "../common/date";
import { toError } from "../common/error";
import {
    FirestoreDatabase,
    firestoreFor,
    isFirebaseDB
} from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";
import { resolveTimeZone } from "./shared";

const processingDurationMilliseconds = 30 * 1000;

// 푸시 알림 작업 하나를 검증하고 발송하는 데 필요한 데이터를 저장합니다.
type TaskPayload = {
    // 작업 데이터가 속한 Firestore 데이터베이스를 저장합니다.
    firebaseDB: FirestoreDatabase;
    // Todo와 알림 기록의 소유자를 저장합니다.
    userId: string;
    // 마감일 검증에 사용할 Todo 문서 ID를 저장합니다.
    todoId: string;
    // 멱등성 확인에 사용할 예상 로컬 마감일 키를 저장합니다.
    dueDateKey: string;
    // FCM으로 보낼 알림 제목을 저장합니다.
    title: string;
    // FCM으로 보낼 알림 본문을 저장합니다.
    body: string;
};

// 큐에 적재된 알림 payload 검증 및 실제 푸시 발송 수행
export const sendPushNotification = onTaskDispatched({
        maxInstances: 10,
        region: "asia-northeast3",
        retryConfig: { maxAttempts: 3, minBackoffSeconds: 5 },
        rateLimits: { maxDispatchesPerSecond: 10 },
    },
    async (req) => {
        const parsed = parseTaskPayload(req.data);
        if (!parsed) {
            logger.warn("유효하지 않은 푸시 알림 payload", req.data);
            return;
        }

        const prepared = await prepareNotification(parsed, req.data);
        if (!prepared) { return; }

        const {
            userId, todoId, dueDateKey,
            title, body
        } = parsed;
        const {
            db, dispatchDocRef, notificationDocRef,
            dispatchId, todoCategory, notificationData
        } = prepared;

        try {
            await saveNotification(
                notificationDocRef,
                notificationData,
                req.data,
                userId,
                todoId,
                dueDateKey
            );
        } catch (error) {
            await expireProcessing(dispatchDocRef);
            throw error;
        }

        const completedDispatchData = {
            todoId,
            dueDateKey,
            status: "completed",
            completedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp()
        };
        let fcmToken: string | undefined;
        let unreadNotificationCount = 0;

        try {
            // 1. 사용자 FCM 토큰과 읽지 않은 알림 수 가져오기
            const unreadCountPromise = db
                .collection(FirestorePath.notifications(userId))
                .where("isRead", "==", false)
                .count()
                .get();
            // 2. 사용자 FCM 토큰 가져오기
            const tokenDocPromise = db
                .doc(FirestorePath.userData(userId, FirestorePath.UserDataDocument.tokens))
                .get();
            const [tokenDoc, unreadCountSnapshot] = await Promise.all([
                tokenDocPromise,
                unreadCountPromise
            ]);
            fcmToken = tokenDoc.data()?.fcmToken;
            unreadNotificationCount = unreadCountSnapshot.data().count;

            if (!fcmToken) {
                logger.warn(`사용자 ${userId}의 fcmToken이 없어 푸시 발송은 건너뜁니다. Firestore에는 기록했습니다.`);
                await dispatchDocRef.set(completedDispatchData, { merge: true });
                return;
            }
        } catch (error) {
            logger.error("알림 발송 중 오류 발생", toError(error), {
                payload: req.data
            });
            await expireProcessing(dispatchDocRef);
            throw error;
        }

        // 2. 푸시 알림 발송
        const collapseId = createHash("sha256").update(dispatchId).digest("hex");
        const message: Message = {
            notification: { title, body },
            data: {
                todoId: todoId,
                todoCategory: todoCategory
            },
            apns: {
                headers: {
                    "apns-collapse-id": collapseId
                },
                payload: {
                    aps: {
                        sound: "default",
                        badge: unreadNotificationCount
                    }
                }
            },
            token: fcmToken,
        };
        try {
            await admin.messaging().send(message);
        } catch (error) {
            if (isPermanentFcmTokenError(error)) {
                logger.warn(`[${userId}] 재시도해도 복구되지 않는 FCM token 오류입니다. completed로 처리합니다.`, error);
                try {
                    await dispatchDocRef.set(completedDispatchData, { merge: true });
                } catch (completionError) {
                    await expireProcessing(dispatchDocRef);
                    throw completionError;
                }
                return;
            }

            logger.warn(`[${userId}] 푸시 발송 실패. Firestore 기록은 유지됩니다.`, error);
            await expireProcessing(dispatchDocRef);
            throw error;
        }

        try {
            await dispatchDocRef.set(completedDispatchData, { merge: true });

        } catch (error) {
            logger.error("알림 발송 중 오류 발생", toError(error), {
                payload: req.data
            });
            await expireProcessing(dispatchDocRef);
            throw error;
        }
    }
);

// 발송 전 사용자 설정과 Todo 상태를 검증하고 저장할 알림 데이터를 구성합니다.
async function prepareNotification(
    parsed: TaskPayload,
    payload: FirebaseFirestore.DocumentData | undefined
) {
    const { firebaseDB, userId, todoId, dueDateKey, body } = parsed;
    const db = firestoreFor(firebaseDB);
    const dispatchId = `${todoId}_${dueDateKey}`;
    const dispatchDocRef = db.doc(FirestorePath.notificationDispatch(userId, dispatchId));
    const notificationDocRef = db.doc(FirestorePath.notification(userId, todoId));
    let todoCategory = "";
    let notificationData: FirebaseFirestore.DocumentData | null = null;

    try {
        const settingsDocRef = db
            .doc(FirestorePath.userData(userId, FirestorePath.UserDataDocument.settings));
        const todoDocRef = db.doc(FirestorePath.todo(userId, todoId));
        const [settingsDoc, todoDoc] = await Promise.all([
            settingsDocRef.get(),
            todoDocRef.get()
        ]);
        const settingsData = settingsDoc.data();
        const allowPushNotification = settingsData?.allowPushNotification ?? true;
        if (!allowPushNotification) { return null; }

        const todoData = todoDoc.data();
        if (!todoDoc.exists || !todoData || todoData.isCompleted === true) { return null; }
        todoCategory = typeof todoData.category === "string" ? todoData.category.trim() : "";
        if (!todoCategory) { return null; }

        const timeZone = resolveTimeZone(settingsData);

        const currentDueDate = toDate(todoData.dueDate);
        if (!currentDueDate) { return null; }
        if (formatDateKey(currentDueDate, timeZone) !== dueDateKey) { return null; }

        notificationData = {
            title: "Todo 알림",
            body,
            receivedAt: FieldValue.serverTimestamp(),
            isRead: false,
            isDeleted: false,
            todoId: todoId,
            todoCategory: todoCategory
        };
    } catch (error) {
        logger.error("알림 발송 중 오류 발생", toError(error), {
            payload
        });
        throw error;
    }

    if (!notificationData) { return null; }

    const didClaimDispatch = await claimDispatch(
        db,
        dispatchDocRef,
        todoId,
        dueDateKey
    );
    if (!didClaimDispatch) { return null; }

    return {
        db, dispatchDocRef, notificationDocRef,
        dispatchId, todoCategory, notificationData
    };
}

// dispatch 문서를 트랜잭션으로 선점하고 이미 완료된 작업은 건너뜁니다.
async function claimDispatch(
    db: FirebaseFirestore.Firestore,
    dispatchDocRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    todoId: string,
    dueDateKey: string
): Promise<boolean> {
    const now = new Date();
    const processingExpiresAt = Timestamp.fromMillis(
        now.getTime() + processingDurationMilliseconds
    );

    return db.runTransaction(async (transaction) => {
        const dispatchDoc = await transaction.get(dispatchDocRef);
        const dispatchData = dispatchDoc.data();
        const dispatchStatus = dispatchData?.status;
        if (dispatchStatus === "completed") { return false; }
        if (dispatchDoc.exists && dispatchStatus === undefined) {
            migrateLegacyDispatch(
                transaction,
                dispatchDocRef,
                todoId,
                dueDateKey
            );
            return false;
        }
        if (isProcessingActive(dispatchData, now)) {
            return false;
        }

        transaction.set(dispatchDocRef, {
            todoId,
            dueDateKey,
            status: "processing",
            processingStartedAt: FieldValue.serverTimestamp(),
            processingExpiresAt,
            failedAt: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        return true;
    });
}

// 상태 필드가 없던 기존 dispatch 문서는 발송 완료 여부를 확정할 수 없어 중복 발송 방지를 우선해 완료 상태로 전환합니다.
function migrateLegacyDispatch(
    transaction: FirebaseFirestore.Transaction,
    dispatchDocRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    todoId: string,
    dueDateKey: string
): void {
    transaction.set(dispatchDocRef, {
        todoId,
        dueDateKey,
        status: "completed",
        legacyMigratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
}

// processing 상태가 아직 유효한지 만료 시각으로 판단합니다.
function isProcessingActive(
    dispatchData: FirebaseFirestore.DocumentData | undefined,
    now: Date
): boolean {
    if (dispatchData?.status !== "processing") { return false; }

    const processingExpiresAt = toDate(dispatchData.processingExpiresAt);
    if (!processingExpiresAt) { return false; }

    return now.getTime() < processingExpiresAt.getTime();
}

// 앱 내 알림 기록을 저장하고 저장 실패를 Cloud Tasks retry로 전달합니다.
async function saveNotification(
    notificationDocRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
    notificationData: FirebaseFirestore.DocumentData,
    payload: FirebaseFirestore.DocumentData | undefined,
    userId: string,
    todoId: string,
    dueDateKey: string
): Promise<void> {
    try {
        await notificationDocRef.set(notificationData, { merge: true });
    } catch (error) {
        logger.error("푸시 알림 문서 저장 실패", toError(error), {
            payload,
            userId,
            todoId,
            dueDateKey
        });
        throw error;
    }
}

// 재시도해도 복구되지 않는 FCM token 오류인지 확인합니다.
function isPermanentFcmTokenError(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    return code === "messaging/invalid-registration-token" ||
        code === "messaging/registration-token-not-registered";
}

// 실패를 감지한 처리 경로에서 다음 retry가 즉시 선점할 수 있도록 processing 만료 시각을 앞당깁니다.
async function expireProcessing(
    dispatchDocRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>
): Promise<void> {
    try {
        await dispatchDocRef.set({
            status: "failed",
            failedAt: FieldValue.serverTimestamp(),
            processingExpiresAt: Timestamp.now(),
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    } catch (error) {
        logger.error("푸시 알림 processing 만료 처리 실패", toError(error), {
            path: dispatchDocRef.path
        });
    }
}

// 큐 payload의 발송 필수 필드 충족 여부 검증
function parseTaskPayload(data: FirebaseFirestore.DocumentData | undefined): TaskPayload | null {
    const {
        firebaseDB,
        userId,
        todoId,
        dueDateKey,
        title,
        body
    } = data ?? {};

    if (
        !isFirebaseDB(firebaseDB) ||
        typeof userId !== "string" ||
        typeof todoId !== "string" ||
        typeof dueDateKey !== "string" ||
        typeof title !== "string" ||
        typeof body !== "string"
    ) {
        return null;
    }

    if (userId.includes("/") || todoId.includes("/")) {
        return null;
    }

    return {
        firebaseDB: firebaseDB.trim(),
        userId,
        todoId,
        dueDateKey,
        title,
        body
    };
}
