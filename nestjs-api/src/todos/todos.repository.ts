import { Inject, Injectable } from '@nestjs/common';
import {
  type CollectionReference,
  type DocumentReference,
  FieldPath,
  FieldValue,
  type Firestore,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';

import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';

const notificationQueryBatchSize = 200;

/** Todo 문서에 저장된 삭제 처리 상태입니다. */
export type TodoDeletionState = 'missing' | 'active' | 'deleted';

/** Todo와 연결 알림의 Firestore 저장 동작을 담당합니다. */
@Injectable()
export class TodosRepository {
  /** Firestore 저장소 의존성을 주입받습니다. */
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  /** Todo 문서의 현재 삭제 처리 상태를 반환합니다. */
  async getTodoDeletionState(
    uid: string,
    todoId: string,
  ): Promise<TodoDeletionState> {
    const snapshot = await this.todoDocument(uid, todoId).get();

    if (!snapshot.exists) {
      return 'missing';
    }

    return snapshot.data()?.deletedAt ? 'deleted' : 'active';
  }

  /** Todo 문서에 삭제 요청 상태를 기록합니다. */
  // prettier-ignore
  async markTodoDeletionRequested(
    uid: string,
    todoId: string,
  ): Promise<void> {
    await this.todoDocument(uid, todoId).set(
      {
        deletedAt: FieldValue.serverTimestamp(),
        isDeleting: FieldValue.delete(),
        isDeleted: FieldValue.delete(),
      },
      { merge: true },
    );
  }

  /** Todo 문서에 기록된 삭제 상태를 복구합니다. */
  // prettier-ignore
  async restoreTodoDeletion(
    uid: string,
    todoId: string,
  ): Promise<void> {
    await this.todoDocument(uid, todoId).update({
      deletedAt: null,
      isDeleting: FieldValue.delete(),
      isDeleted: FieldValue.delete(),
    });
  }

  /** Todo에 연결된 알림에 삭제 상태를 기록합니다. */
  // prettier-ignore
  async markNotificationsDeleted(
    uid: string,
    todoId: string,
  ): Promise<void> {
    await this.updateNotificationsDeletionState(uid, todoId, true);
  }

  /** Todo에 연결된 알림의 삭제 상태를 복구합니다. */
  // prettier-ignore
  async restoreNotifications(
    uid: string,
    todoId: string,
  ): Promise<void> {
    await this.updateNotificationsDeletionState(uid, todoId, false);
  }

  /** 연결 알림을 문서 ID 순서에 따라 일정 개수씩 갱신합니다. */
  private async updateNotificationsDeletionState(
    uid: string,
    todoId: string,
    isDeleted: boolean,
  ): Promise<void> {
    let lastDocument: QueryDocumentSnapshot | undefined;

    while (true) {
      let query = this.notificationsCollection(uid)
        .where('todoId', '==', todoId)
        .orderBy(FieldPath.documentId())
        .limit(notificationQueryBatchSize);
      if (lastDocument) {
        query = query.startAfter(lastDocument);
      }

      const snapshot = await query.get();
      if (snapshot.empty) {
        return;
      }

      const batch = this.firestore.batch();
      for (const document of snapshot.docs) {
        batch.update(document.ref, {
          deletingAt: FieldValue.delete(),
          isDeleted,
        });
      }
      await batch.commit();

      if (snapshot.size < notificationQueryBatchSize) {
        return;
      }
      lastDocument = snapshot.docs[snapshot.docs.length - 1];
    }
  }

  /** 검증된 사용자 UID 범위에서 Todo 문서 참조를 생성합니다. */
  // prettier-ignore
  private todoDocument(
    uid: string,
    todoId: string,
  ): DocumentReference {
    return this.firestore.doc(`users/${uid}/todoLists/${todoId}`);
  }

  /** 검증된 사용자 UID 범위에서 알림 collection 참조를 생성합니다. */
  private notificationsCollection(uid: string): CollectionReference {
    return this.firestore.collection(`users/${uid}/notifications`);
  }
}
