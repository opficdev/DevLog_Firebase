// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';

// 삭제 중인 사용자의 Apple credential 저장 오류입니다.
const userDeletionException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'failed-precondition',
  '삭제 중인 사용자의 Apple credential은 저장할 수 없습니다.',
);

// Apple OAuth credential의 Firestore 저장을 담당합니다.
@Injectable()
export class AppleCredentialRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // 새 Apple credential을 저장하고 기존 사용자 token 필드를 제거합니다.
  // prettier-ignore
  async save(
    uid: string,
    refreshToken: string,
  ): Promise<void> {
    const root = this.firestore.doc(`authCredentials/${uid}`);
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/apple`,
    );
    const legacyReference = this.firestore.doc(
      `users/${uid}/userData/tokens`,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const rootSnapshot = await transaction.get(root);
      const legacySnapshot = await transaction.get(legacyReference);
      const rootData: Record<string, unknown> | undefined = rootSnapshot.data();
      const legacyData: Record<string, unknown> | undefined =
        legacySnapshot.data();
      if (rootData?.deletionStartedAt) {
        throw userDeletionException;
      }

      transaction.set(
        reference,
        {
          refreshToken,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (
        legacySnapshot.exists &&
        legacyData &&
        'appleRefreshToken' in legacyData
      ) {
        transaction.update(legacyReference, {
          appleRefreshToken: FieldValue.delete(),
        });
      }
    });
  }

  // 새 경로를 우선해 credential을 읽고 기존 값은 새 값을 보존하며 이관합니다.
  async find(uid: string): Promise<string | undefined> {
    const root = this.firestore.doc(`authCredentials/${uid}`);
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/apple`,
    );
    const legacyReference = this.firestore.doc(`users/${uid}/userData/tokens`);
    return this.firestore.runTransaction(async (transaction) => {
      const rootSnapshot = await transaction.get(root);
      const snapshot = await transaction.get(reference);
      const legacySnapshot = await transaction.get(legacyReference);
      const rootData: Record<string, unknown> | undefined = rootSnapshot.data();
      const data: Record<string, unknown> | undefined = snapshot.data();
      const legacyData: Record<string, unknown> | undefined =
        legacySnapshot.data();
      const storedRefreshToken = data?.refreshToken;
      const legacyRefreshToken = legacyData?.appleRefreshToken;
      const refreshToken =
        typeof storedRefreshToken === 'string'
          ? storedRefreshToken
          : typeof legacyRefreshToken === 'string'
            ? legacyRefreshToken
            : undefined;

      if (!rootData?.deletionStartedAt && !storedRefreshToken && refreshToken) {
        transaction.set(
          reference,
          {
            refreshToken,
            migratedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      }
      if (legacySnapshot.exists && typeof legacyRefreshToken === 'string') {
        transaction.update(legacyReference, {
          appleRefreshToken: FieldValue.delete(),
        });
      }
      return refreshToken;
    });
  }
}
