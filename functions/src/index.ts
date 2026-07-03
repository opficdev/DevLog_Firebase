import * as admin from "firebase-admin";
import * as dotenv from "dotenv";
import * as path from "path";
import { firebaseDBs } from "./common/firestore";

// import {

// } from "./auth/google";

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

import {
    prodApi,
    stagingApi
} from "./rest/api";

// Cloud Functions REST base URLs:
// staging: https://${region}-${projectId}.cloudfunctions.net/stagingApi/api
// prod: https://${region}-${projectId}.cloudfunctions.net/prodApi/api

// .env 파일 로드
dotenv.config({
    path: path.resolve(__dirname, "../.env"),
    override: true
});

// Firebase 앱 초기화
admin.initializeApp();

// firestoreDatabaseFunctionGroups는 이름 지정 데이터베이스별 Firestore trigger export 묶음을 저장합니다.
const firestoreDatabaseFunctionGroups: Record<string, unknown> = {};
for (const firebaseDB of firebaseDBs()) {
    firestoreDatabaseFunctionGroups[firebaseDB] = {
        removeTodoNotificationDocuments: removeTodoNotificationDocuments(firebaseDB),
        removeCompletedTodoNotificationRecords: removeCompletedTodoNotificationRecords(firebaseDB),
        syncTodoNotificationCategory: syncTodoNotificationCategory(firebaseDB),
        requestMoveRemovedCategoryTodosToEtc: requestMoveRemovedCategoryTodosToEtc(firebaseDB)
    };
}
Object.assign(exports, firestoreDatabaseFunctionGroups);

// Google 인증 함수들 (나중에 구현되면 추가)

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
    prodApi,
    stagingApi
};
