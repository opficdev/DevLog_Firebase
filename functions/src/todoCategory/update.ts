import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFunctions } from "firebase-admin/functions";
import { FieldPath, getFirestore } from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import { toError } from "../common/error";
import { FirestorePath } from "../common/firestorePath";

const LOCATION = "asia-northeast3";
const BATCH_SIZE = 200;
const ETC_CATEGORY = "etc";

// 사용자 카테고리 항목의 비교에 필요한 원본 필드를 저장합니다.
type CategoryItem = {
    // 카테고리 항목의 종류를 저장합니다.
    kind?: unknown;
    // 사용자 카테고리 식별자를 저장합니다.
    id?: unknown;
};

// 삭제된 카테고리의 Todo 정리 작업에 필요한 데이터를 저장합니다.
type TodoCategoryUpdateTaskData = {
    // 정리 대상 Todo 소유자를 저장합니다.
    userId: string;
    // 삭제된 사용자 카테고리 식별자를 저장합니다.
    id: string;
};

// 현재 Firebase project에서 삭제된 사용자 카테고리의 Todo 정리 작업을 요청합니다.
export const requestMoveRemovedCategoryTodosToEtc = onDocumentUpdated({
        maxInstances: 1,
        document: "users/{userId}/userData/categories",
        region: LOCATION
    },
    async (event) => {
        const userId = event.params.userId;
        const beforeData = event.data?.before.data();
        const afterData = event.data?.after.data();

        if (!beforeData || !afterData) { return; }

        const beforeItems = Array.isArray(beforeData.items) ? beforeData.items as CategoryItem[] : [];
        const afterItems = Array.isArray(afterData.items) ? afterData.items as CategoryItem[] : [];
        const removedIDs = getRemovedIDs(beforeItems, afterItems);

        if (removedIDs.length === 0) { return; }

        try {
            const queue = getFunctions().taskQueue(
                `locations/${LOCATION}/functions/completeMoveRemovedCategoryTodosToEtc`
            );

            for (const id of removedIDs) {
                const taskData = {
                    userId,
                    id
                };

                try {
                    await queue.enqueue(taskData);
                } catch (error) {
                    throw error;
                }
            }
        } catch (error) {
            logger.error("삭제된 사용자 카테고리 todo 정리 요청 실패", toError(error), {
                userId,
                removedIDs
            });
            throw error;
        }
    }
    );

// 삭제된 사용자 카테고리에 속한 Todo를 etc 카테고리로 이동
export const completeMoveRemovedCategoryTodosToEtc = onTaskDispatched({
        maxInstances: 2,
        region: LOCATION,
        retryConfig: { maxAttempts: 3, minBackoffSeconds: 5 },
        rateLimits: { maxDispatchesPerSecond: 2 },
    },
    async (request) => {
        const taskData = parseTaskPayload(request.data);
        if (!taskData) {
            logger.warn("유효하지 않은 카테고리 정리 payload", request.data);
            return;
        }
        const { userId, id } = taskData;

        try {
            await updateTodos(getFirestore(), userId, id);
        } catch (error) {
            logger.error("삭제된 사용자 카테고리 todo 정리 실패", toError(error), {
                userId,
                id,
                payload: request.data
            });
            throw error;
        }
    }
);

// 카테고리 정리 작업 payload의 필수 필드를 검증합니다.
function parseTaskPayload(data: unknown): TodoCategoryUpdateTaskData | null {
    const userId = typeof (data as TodoCategoryUpdateTaskData | undefined)?.userId === "string" ?
        (data as TodoCategoryUpdateTaskData).userId.trim() :
        "";
    const id = typeof (data as TodoCategoryUpdateTaskData | undefined)?.id === "string" ?
        (data as TodoCategoryUpdateTaskData).id.trim() :
        "";

    if (!userId || !id) {
        return null;
    }

    return {
        userId,
        id
    };
}

// 이전 카테고리 목록에서 제거된 사용자 카테고리 ID 목록을 반환합니다.
function getRemovedIDs(
    beforeItems: CategoryItem[],
    afterItems: CategoryItem[]
): string[] {
    const beforeIDs = new Set(
        beforeItems.flatMap((item) => {
            if (item.kind !== "user") { return []; }
            return typeof item.id === "string" ? [item.id] : [];
        })
    );
    const afterIDs = new Set(
        afterItems.flatMap((item) => {
            if (item.kind !== "user") { return []; }
            return typeof item.id === "string" ? [item.id] : [];
        })
    );

    return Array.from(beforeIDs).filter((id) => !afterIDs.has(id));
}

// 삭제된 카테고리를 사용하는 Todo를 etc 카테고리로 이동합니다.
async function updateTodos(
    db: FirebaseFirestore.Firestore,
    userId: string,
    id: string
): Promise<void> {
    await updateTodoBatch(db, userId, id);
}

// Todo 문서를 배치 단위로 순회하며 카테고리 값을 갱신합니다.
async function updateTodoBatch(
    db: FirebaseFirestore.Firestore,
    userId: string,
    id: string,
    lastDocument?:
        FirebaseFirestore.QueryDocumentSnapshot<FirebaseFirestore.DocumentData>
): Promise<void> {
    let query = db
        .collection(FirestorePath.todos(userId))
        .where("category", "==", id)
        .orderBy(FieldPath.documentId())
        .limit(BATCH_SIZE);

    if (lastDocument) {
        query = query.startAfter(lastDocument);
    }

    const snapshot = await query.get();
    if (snapshot.empty) { return; }

    const batch = db.batch();
    snapshot.docs.forEach((document) => {
        batch.update(document.ref, {
            category: ETC_CATEGORY
        });
    });
    await batch.commit();

    if (snapshot.size < BATCH_SIZE) { return; }

    await updateTodoBatch(
        db,
        userId,
        id,
        snapshot.docs[snapshot.docs.length - 1]
    );
}
