import { Inject, Injectable } from '@nestjs/common';
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';

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

  /** 검증된 사용자 UID 범위에서 Todo 문서 참조를 생성합니다. */
  // prettier-ignore
  private todoDocument(
    uid: string,
    todoId: string,
  ): DocumentReference {
    return this.firestore.doc(`users/${uid}/todoLists/${todoId}`);
  }
}
