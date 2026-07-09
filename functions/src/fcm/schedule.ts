import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFunctions } from "firebase-admin/functions";
import { Timestamp } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { addDays, getZonedParts, zonedDateTimeToUTC } from "../common/date";
import { toError } from "../common/error";
import {
    FirestoreDatabase,
    firebaseDBs,
    firestoreFor
} from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";
import { resolveTimeZone } from "./shared";

const LOCATION = "asia-northeast3";
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;
const MINUTE_INTERVAL = 5;

// 사용자별 설정 시간에 맞춘 내일 마감 Todo 알림 작업 큐 적재
export const scheduleTodoReminder = onSchedule({
        maxInstances: 1,
        region: LOCATION,
        schedule: "*/5 * * * *",
        timeZone: "UTC"
    },
    async (event) => {
        try {
            const now = event.scheduleTime ? new Date(event.scheduleTime) : new Date();
            for (const firebaseDB of firebaseDBs()) {
                try {
                    await enqueueTodoReminderTasks(firebaseDB, now);
                } catch (error) {
                    logger.error("알림 스케줄 작업 적재 실패", toError(error), {
                        firebaseDB
                    });
                }
            }
        } catch (error) {
            logger.error("알림 스케줄 배치 실행 중 오류 발생", toError(error));
        }
    }
);

// 하나의 이름 지정 데이터베이스를 순회하며 마감 Todo 푸시 알림 작업을 적재합니다.
async function enqueueTodoReminderTasks(
    firebaseDB: FirestoreDatabase,
    now: Date
): Promise<void> {
    const db = firestoreFor(firebaseDB);
    const queue = getFunctions().taskQueue(`locations/${LOCATION}/functions/sendPushNotification`);
    let settingsSnapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
    try {
        settingsSnapshot = await db
            .collectionGroup(FirestorePath.userDataCollectionGroup)
            .where("allowPushNotification", "==", true)
            .get();
    } catch (error) {
        logger.error("settings 후보 조회 실패", toError(error), {
            firebaseDB,
            at: "collectionGroup(userData).where(allowPushNotification==true)"
        });
        return;
    }

    for (const settingsDoc of settingsSnapshot.docs) {
        const userId = userIdForReminderSettings(settingsDoc);
        if (!userId) { continue; }

        const settings = settingsDoc.data();
        if (!settings || settings.allowPushNotification !== true) { continue; }

        const hour = Number.isInteger(settings.pushNotificationHour) ? settings.pushNotificationHour : DEFAULT_HOUR;
        const configuredMinute = Number.isInteger(settings.pushNotificationMinute) ?
            Number(settings.pushNotificationMinute) :
            DEFAULT_MINUTE;
        const minute = configuredMinute < 0 || 59 < configuredMinute ?
            DEFAULT_MINUTE :
            configuredMinute - (configuredMinute % MINUTE_INTERVAL);

        const timeZone = resolveTimeZone(settings);

        const localNow = getZonedParts(now, timeZone);
        if (localNow.hour !== hour) { continue; }
        const windowEnd = Math.min(minute + MINUTE_INTERVAL, 60);
        if (localNow.minute < minute || windowEnd <= localNow.minute) { continue; }

        const tomorrow = addDays(localNow.year, localNow.month, localNow.day, 1);
        const dayAfterTomorrow = addDays(localNow.year, localNow.month, localNow.day, 2);
        const startUTC = zonedDateTimeToUTC(
            tomorrow.year,
            tomorrow.month,
            tomorrow.day,
            0, 0,
            timeZone
        );
        const endUTC = zonedDateTimeToUTC(
            dayAfterTomorrow.year,
            dayAfterTomorrow.month,
            dayAfterTomorrow.day,
            0, 0,
            timeZone
        );

        const dueDateKey = `${tomorrow.year}-${tomorrow.month.toString().padStart(2, "0")}-${tomorrow.day.toString().padStart(2, "0")}`;
        let todosSnapshot: FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>;
        try {
            todosSnapshot = await db
                .collection(FirestorePath.todos(userId))
                .where("dueDate", ">=", Timestamp.fromDate(startUTC))
                .where("dueDate", "<", Timestamp.fromDate(endUTC))
                .get();
        } catch (error) {
            logger.error("todoLists 조회 실패", toError(error), {
                firebaseDB,
                userId,
                at: "todoLists.where(dueDate>=start).where(dueDate<end)",
                startUTC: startUTC.toISOString(),
                endUTC: endUTC.toISOString(),
                dueDateKey
            });
            continue;
        }

        for (const todoDoc of todosSnapshot.docs) {
            const todoData = todoDoc.data();
            const todoTitle = typeof todoData.title === "string" && todoData.title.trim() ?
                todoData.title :
                "제목 없음";

            const notificationPayload = {
                firebaseDB,
                userId,
                todoId: todoDoc.id,
                dueDateKey,
                title: "DevLog",
                body: `'${todoTitle}'의 마감일이 내일입니다.`
            };

            try {
                await queue.enqueue(notificationPayload);
            } catch (error) {
                logger.error("Cloud Tasks enqueue 실패", toError(error), {
                    firebaseDB,
                    userId,
                    todoId: todoDoc.id,
                    dueDateKey
                });
            }
        }
    }
}

// 알림 설정 문서 경로에서 사용자 ID를 추출하고 예상하지 않은 collection group 결과를 제외합니다.
function userIdForReminderSettings(
    settingsDoc: FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
): string | null {
    if (settingsDoc.id !== FirestorePath.UserDataDocument.settings) { return null; }

    const userDocRef = settingsDoc.ref.parent.parent;
    if (!userDocRef) { return null; }

    const expectedPath = FirestorePath.userData(
        userDocRef.id,
        FirestorePath.UserDataDocument.settings
    );
    if (settingsDoc.ref.path !== expectedPath) { return null; }

    return userDocRef.id;
}
