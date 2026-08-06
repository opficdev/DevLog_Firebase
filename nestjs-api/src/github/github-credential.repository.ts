import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';
import { type GitHubCredential } from './github-authentication.types';

// 삭제 중인 사용자의 credential 저장 오류입니다.
const userDeletionException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'failed-precondition',
  '삭제 중인 사용자의 GitHub credential은 저장할 수 없습니다.',
);

// 진행 중인 credential 폐기 처리 오류입니다.
const revocationInProgressException = new ApiException(
  HttpStatus.CONFLICT,
  'aborted',
  'GitHub credential 폐기 처리가 진행 중입니다.',
);

// GitHub OAuth credential의 Firestore 저장을 담당합니다.
@Injectable()
export class GitHubCredentialRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // 새 GitHub credential을 저장하고 같은 App의 이전 token을 폐기 대상으로 남깁니다.
  async save(uid: string, credential: GitHubCredential): Promise<void> {
    const root = this.firestore.doc(`authCredentials/${uid}`);
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/github`,
    );
    const legacyReference = this.firestore.doc(`users/${uid}/userData/tokens`);
    await this.firestore.runTransaction(async (transaction) => {
      const rootSnapshot = await transaction.get(root);
      const snapshot = await transaction.get(reference);
      const legacySnapshot = await transaction.get(legacyReference);
      const rootData: Record<string, unknown> | undefined = rootSnapshot.data();
      const data: Record<string, unknown> | undefined = snapshot.data();
      const legacyData: Record<string, unknown> | undefined =
        legacySnapshot.data();
      if (rootData?.deletionStartedAt) {
        throw userDeletionException;
      }
      if (revocationLeaseActive(data)) {
        throw revocationInProgressException;
      }

      const pendingRevocations = pendingCredentialsFrom(data).filter(
        (pending) =>
          pending.accessToken !== credential.accessToken &&
          pending.clientId === credential.clientId,
      );
      const stored = credentialFromData(data);
      if (
        stored &&
        stored.accessToken !== credential.accessToken &&
        stored.clientId === credential.clientId
      ) {
        pendingRevocations.push(stored);
      }
      const uniquePendingRevocations = Array.from(
        new Map(
          pendingRevocations.map((pending) => [
            JSON.stringify([pending.clientId, pending.accessToken]),
            pending,
          ]),
        ).values(),
      );
      transaction.set(
        reference,
        {
          accessToken: credential.accessToken,
          clientId: credential.clientId,
          pendingRevocations: uniquePendingRevocations,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      if (
        legacySnapshot.exists &&
        typeof legacyData?.githubAccessToken === 'string'
      ) {
        transaction.update(legacyReference, {
          githubAccessToken: FieldValue.delete(),
        });
      }
    });
  }

  // 저장된 credential 문서에서 폐기 대기 중인 이전 token을 반환합니다.
  async pendingRevocations(uid: string): Promise<GitHubCredential[]> {
    const snapshot = await this.firestore
      .doc(`authCredentials/${uid}/providers/github`)
      .get();
    return pendingCredentialsFrom(snapshot.data());
  }

  // 폐기에 성공한 credential을 폐기 대기 목록에서 제거합니다.
  async removePending(uid: string, removed: GitHubCredential): Promise<void> {
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/github`,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const remaining = pendingCredentialsFrom(snapshot.data()).filter(
        (credential) => credential.accessToken !== removed.accessToken,
      );
      transaction.set(
        reference,
        {
          pendingRevocations: remaining,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  }
}

// credential 문서 데이터에서 현재 GitHub credential을 반환합니다.
function credentialFromData(
  data: Record<string, unknown> | undefined,
): GitHubCredential | undefined {
  const accessToken = data?.accessToken;
  const clientId = data?.clientId;
  return typeof accessToken === 'string' && typeof clientId === 'string'
    ? { accessToken, clientId }
    : undefined;
}

// credential 문서에 유효한 grant 폐기 lease가 남아 있는지 반환합니다.
function revocationLeaseActive(
  data: Record<string, unknown> | undefined,
): boolean {
  const expiresAt = data?.revocationExpiresAt;
  return (
    typeof data?.revocationClaim === 'string' &&
    expiresAt instanceof Timestamp &&
    Date.now() < expiresAt.toMillis()
  );
}

// credential 문서 데이터에서 폐기 대기 중인 이전 credential을 반환합니다.
function pendingCredentialsFrom(
  data: Record<string, unknown> | undefined,
): GitHubCredential[] {
  const pendingRevocations = data?.pendingRevocations;
  if (!Array.isArray(pendingRevocations)) {
    return [];
  }
  return pendingRevocations.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object') {
      return [];
    }
    const credential = value as Record<string, unknown>;
    return typeof credential.accessToken === 'string' &&
      typeof credential.clientId === 'string'
      ? [{ accessToken: credential.accessToken, clientId: credential.clientId }]
      : [];
  });
}
