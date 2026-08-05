import { Inject, Injectable } from '@nestjs/common';
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';

// PushNotification 문서에 저장된 삭제 처리 상태입니다.
export type PushNotificationDeletionState = 'missing' | 'active' | 'deleted';

// PushNotification의 Firestore 저장 동작을 담당합니다.
@Injectable()
export class PushNotificationsRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // PushNotification 문서의 현재 삭제 처리 상태를 반환합니다.
  async getPushNotificationDeletionState(
    uid: string,
    notificationId: string,
  ): Promise<PushNotificationDeletionState> {
    const snapshot = await this.pushNotificationDocument(
      uid,
      notificationId,
    ).get();

    if (!snapshot.exists) {
      return 'missing';
    }

    return snapshot.data()?.isDeleted === true ? 'deleted' : 'active';
  }

  // PushNotification 문서에 삭제 요청 상태를 기록합니다.
  async markPushNotificationDeletionRequested(
    uid: string,
    notificationId: string,
  ): Promise<void> {
    await this.pushNotificationDocument(uid, notificationId).set(
      {
        deletingAt: FieldValue.delete(),
        isDeleted: true,
      },
      { merge: true },
    );
  }

  // PushNotification 문서에 기록된 삭제 상태를 복구합니다.
  // prettier-ignore
  async restorePushNotificationDeletion(
    uid: string,
    notificationId: string,
  ): Promise<void> {
    await this.pushNotificationDocument(uid, notificationId).update({
      deletingAt: FieldValue.delete(),
      isDeleted: false,
    });
  }

  // 검증된 사용자 UID 범위에서 PushNotification 문서 참조를 생성합니다.
  // prettier-ignore
  private pushNotificationDocument(
    uid: string,
    notificationId: string,
  ): DocumentReference {
    return this.firestore.doc(`users/${uid}/notifications/${notificationId}`);
  }
}
