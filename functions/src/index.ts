import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";
import { firebaseDBs } from "./common/firestore";

import {
    cleanupDeletedUserFirestoreData
} from "./user/delete";

import {
    sendPushNotification
} from "./fcm/notification";

import {
    scheduleTodoReminder
} from "./fcm/schedule";

import {
    compactSoftDeletedTodos
} from "./todo/cleanup";

import {
    syncTodoNotificationCategory
} from "./todo/update";

import {
    requestMoveRemovedCategoryTodosToEtc,
    completeMoveRemovedCategoryTodosToEtc
} from "./todoCategory/update";

import {
    removeTodoNotificationDocuments,
    removeCompletedTodoNotificationRecords,
    cleanupNotificationDispatches,
    cleanupSoftDeletedNotifications
} from "./notification/cleanup";

import {
    cleanupSoftDeletedWebPages
} from "./webPage/cleanup";

import { api } from "./rest/api";
import {
    cleanupExpiredOAuthSessions,
    cleanupExpiredOAuthTickets
} from "./rest/oauth/cleanup";

// Cloud Functions REST base URL: https://${region}-${projectId}.cloudfunctions.net/api/api

// .env 파일 로드
dotenv.config({
    path: path.resolve(__dirname, "../.env"),
    override: true
});

// Firebase 앱 초기화
admin.initializeApp();

// 이름 지정 데이터베이스별 Firestore trigger export 묶음을 저장합니다.
const firestoreDatabaseFunctionGroups: Record<string, unknown> = {};
for (const firebaseDB of firebaseDBs()) {
    firestoreDatabaseFunctionGroups[firebaseDB] = {
        removeTodoNotificationDocuments: removeTodoNotificationDocuments(firebaseDB),
        removeCompletedTodoNotificationRecords: removeCompletedTodoNotificationRecords(firebaseDB),
        cleanupExpiredOAuthSessions: cleanupExpiredOAuthSessions(firebaseDB),
        cleanupExpiredOAuthTickets: cleanupExpiredOAuthTickets(firebaseDB),
        syncTodoNotificationCategory: syncTodoNotificationCategory(firebaseDB),
        requestMoveRemovedCategoryTodosToEtc: requestMoveRemovedCategoryTodosToEtc(firebaseDB)
    };
}
Object.assign(exports, firestoreDatabaseFunctionGroups);

export {
    cleanupDeletedUserFirestoreData
};

// FCM 관련 함수들 내보내기
export {
    sendPushNotification,
    scheduleTodoReminder
};

export {
    cleanupNotificationDispatches,
    compactSoftDeletedTodos,
    completeMoveRemovedCategoryTodosToEtc,
    cleanupSoftDeletedNotifications,
    cleanupSoftDeletedWebPages,
    api
};
