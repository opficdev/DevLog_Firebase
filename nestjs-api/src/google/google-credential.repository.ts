import { randomBytes } from 'crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';
import { type GoogleCredential } from './google-authentication.types';

const accountLinkLeaseMilliseconds = 5 * 60 * 1000;

// 삭제 중인 사용자의 계정 연결 오류입니다.
const userDeletionAccountLinkException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'failed-precondition',
  '삭제 중인 사용자의 Google 계정은 연결할 수 없습니다.',
);

// 삭제 중인 사용자의 credential 저장 오류입니다.
const userDeletionException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'failed-precondition',
  '삭제 중인 사용자의 Google credential은 저장할 수 없습니다.',
);

// 진행 중인 credential 폐기 처리 오류입니다.
const revocationInProgressException = new ApiException(
  HttpStatus.CONFLICT,
  'aborted',
  'Google credential 폐기 처리가 진행 중입니다.',
);

// 진행 중인 Google 계정 연결 처리 오류입니다.
const accountLinkInProgressException = new ApiException(
  HttpStatus.CONFLICT,
  'google-account-link-in-progress',
  'Google 계정 연결 처리가 진행 중입니다.',
);

// 만료된 Google 계정 연결 처리 권한 오류입니다.
const expiredAccountLinkClaimException = new ApiException(
  HttpStatus.CONFLICT,
  'aborted',
  'Google 계정 연결 처리 권한이 만료되었습니다.',
);

// Google OAuth credential의 Firestore 저장을 담당합니다.
@Injectable()
export class GoogleCredentialRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // Google 계정 연결 처리 권한을 획득하고 claim을 반환합니다.
  async claimAccountLink(uid: string): Promise<string> {
    const root = this.firestore.doc(`authCredentials/${uid}`);
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/google`,
    );
    const claim = randomBytes(32).toString('base64url');
    await this.firestore.runTransaction(async (transaction) => {
      const rootSnapshot = await transaction.get(root);
      const snapshot = await transaction.get(reference);
      const rootData: Record<string, unknown> | undefined = rootSnapshot.data();
      const data: Record<string, unknown> | undefined = snapshot.data();
      if (rootData?.deletionStartedAt) {
        throw userDeletionAccountLinkException;
      }

      const revocationExpiresAt = data?.revocationExpiresAt;
      if (
        typeof data?.revocationClaim === 'string' &&
        revocationExpiresAt instanceof Timestamp &&
        Date.now() < revocationExpiresAt.toMillis()
      ) {
        throw revocationInProgressException;
      }

      const accountLinkExpiresAt = data?.accountLinkExpiresAt;
      if (
        typeof data?.accountLinkClaim === 'string' &&
        accountLinkExpiresAt instanceof Timestamp &&
        Date.now() < accountLinkExpiresAt.toMillis()
      ) {
        throw accountLinkInProgressException;
      }
      transaction.set(
        reference,
        {
          accountLinkClaim: claim,
          accountLinkExpiresAt: Timestamp.fromMillis(
            Date.now() + accountLinkLeaseMilliseconds,
          ),
        },
        { merge: true },
      );
    });
    return claim;
  }

  // 소유한 Google 계정 연결 claim의 만료 시간을 연장합니다.
  async renewAccountLink(uid: string, claim: string): Promise<boolean> {
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/google`,
    );
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data: Record<string, unknown> | undefined = snapshot.data();
      if (data?.accountLinkClaim !== claim) {
        return false;
      }
      transaction.update(reference, {
        accountLinkExpiresAt: Timestamp.fromMillis(
          Date.now() + accountLinkLeaseMilliseconds,
        ),
      });
      return true;
    });
  }

  // 소유한 Google 계정 연결 claim을 해제합니다.
  async releaseAccountLink(uid: string, claim: string): Promise<void> {
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/google`,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data: Record<string, unknown> | undefined = snapshot.data();
      if (data?.accountLinkClaim === claim) {
        transaction.update(reference, {
          accountLinkClaim: FieldValue.delete(),
          accountLinkExpiresAt: FieldValue.delete(),
        });
      }
    });
  }

  // credential을 저장하며 refresh token 보존과 계정 연결 claim 해제를 처리합니다.
  async save(
    uid: string,
    credential: GoogleCredential,
    accountLinkClaim?: string,
  ): Promise<void> {
    const root = this.firestore.doc(`authCredentials/${uid}`);
    const reference = this.firestore.doc(
      `authCredentials/${uid}/providers/google`,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const rootSnapshot = await transaction.get(root);
      const snapshot = await transaction.get(reference);
      const rootData: Record<string, unknown> | undefined = rootSnapshot.data();
      const data: Record<string, unknown> | undefined = snapshot.data();
      if (rootData?.deletionStartedAt) {
        throw userDeletionException;
      }

      const revocationExpiresAt = data?.revocationExpiresAt;
      if (
        typeof data?.revocationClaim === 'string' &&
        revocationExpiresAt instanceof Timestamp &&
        Date.now() < revocationExpiresAt.toMillis()
      ) {
        throw revocationInProgressException;
      }

      const accountLinkExpiresAt = data?.accountLinkExpiresAt;
      const accountLinkActive =
        typeof data?.accountLinkClaim === 'string' &&
        accountLinkExpiresAt instanceof Timestamp &&
        Date.now() < accountLinkExpiresAt.toMillis();
      if (accountLinkActive && data?.accountLinkClaim !== accountLinkClaim) {
        throw accountLinkInProgressException;
      }
      if (accountLinkClaim && data?.accountLinkClaim !== accountLinkClaim) {
        throw expiredAccountLinkClaimException;
      }

      let preservedRefreshToken: string | undefined;
      if (
        typeof data?.accessToken === 'string' &&
        typeof data?.clientId === 'string' &&
        data.clientId === credential.clientId &&
        typeof data?.refreshToken === 'string'
      ) {
        preservedRefreshToken = data.refreshToken;
      }
      const refreshToken = credential.refreshToken ?? preservedRefreshToken;
      const value: Record<string, unknown> = {
        accessToken: credential.accessToken,
        clientId: credential.clientId,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (refreshToken) {
        value.refreshToken = refreshToken;
      } else if (snapshot.exists) {
        value.refreshToken = FieldValue.delete();
      }
      if (accountLinkClaim) {
        value.accountLinkClaim = FieldValue.delete();
        value.accountLinkExpiresAt = FieldValue.delete();
      }
      transaction.set(reference, value, { merge: true });
    });
  }

  // 저장된 Google OAuth credential을 반환합니다.
  async find(uid: string): Promise<GoogleCredential | undefined> {
    const snapshot = await this.firestore
      .doc(`authCredentials/${uid}/providers/google`)
      .get();
    const data: Record<string, unknown> | undefined = snapshot.data();
    const accessToken = data?.accessToken;
    const clientId = data?.clientId;
    const refreshToken = data?.refreshToken;
    if (typeof accessToken !== 'string' || typeof clientId !== 'string') {
      return undefined;
    }
    return {
      accessToken,
      clientId,
      refreshToken: typeof refreshToken === 'string' ? refreshToken : undefined,
    };
  }
}
