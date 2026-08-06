import { randomBytes } from 'crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type DocumentData,
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';
import { challengeFor } from './oauth-proof';
import {
  type ClaimedOAuthSession,
  type OAuthSessionCreation,
  type OAuthSessionInput,
  type OAuthTicketInput,
} from './oauth.types';

const sessionLifetimeMilliseconds = 10 * 60 * 1000;
const ticketLifetimeMilliseconds = 5 * 60 * 1000;
const claimLifetimeMilliseconds = 60 * 1000;
const appChallengeLength = 43;

// OAuth session의 생성과 callback 상태 전이를 담당합니다.
@Injectable()
export class OAuthSessionRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // OAuth session을 생성하고 공개 가능한 PKCE 값을 반환합니다.
  async create(input: OAuthSessionInput): Promise<OAuthSessionCreation> {
    validateAppChallenge(input.appChallenge);
    if (input.purpose === 'link' && !input.uid) {
      throw invalidOAuthSessionException(
        '계정 연결 OAuth session에는 Firebase uid가 필요합니다.',
      );
    }

    const state = randomValue();
    const expiresAt = Timestamp.fromMillis(
      Date.now() + sessionLifetimeMilliseconds,
    );
    await this.firestore.doc(`oauthSessions/${state}`).create({
      state,
      provider: input.provider,
      purpose: input.purpose,
      appChallenge: input.appChallenge,
      providerPKCEVerifier: input.providerPKCEVerifier,
      uid: input.uid ?? null,
      status: 'ready',
      expiresAt,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      state,
      providerPKCEChallenge: challengeFor(input.providerPKCEVerifier),
      expiresAt: expiresAt.toDate(),
    };
  }

  // callback state에 대응하는 session을 transaction으로 한 번만 claim합니다.
  async claim(
    state: string,
    expectedProvider: string,
  ): Promise<ClaimedOAuthSession> {
    const reference = this.firestore.doc(`oauthSessions/${state}`);
    const claim = randomValue();
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!snapshot.exists || !data || data.provider !== expectedProvider) {
        throw invalidOAuthSessionException('OAuth session을 찾을 수 없습니다.');
      }
      validateStoredSession(data);
      if (!claimAvailable(data)) {
        throw consumedOAuthSessionException;
      }

      transaction.update(reference, {
        status: 'processing',
        claim,
        processingAt: FieldValue.serverTimestamp(),
      });
      return {
        claim,
        state,
        provider: data.provider as string,
        purpose: data.purpose as ClaimedOAuthSession['purpose'],
        appChallenge: data.appChallenge as string,
        providerPKCEVerifier: data.providerPKCEVerifier as string,
        uid: typeof data.uid === 'string' ? data.uid : undefined,
      };
    });
  }

  // callback 결과를 ticket으로 저장하고 session을 완료 상태로 전환합니다.
  async complete(input: OAuthTicketInput): Promise<string> {
    const ticket = randomValue();
    const sessionReference = this.firestore.doc(
      `oauthSessions/${input.session.state}`,
    );
    const ticketReference = this.firestore.doc(`oauthTickets/${ticket}`);
    const expiresAt = Timestamp.fromMillis(
      Date.now() + ticketLifetimeMilliseconds,
    );
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(sessionReference);
      const data = snapshot.data();
      if (
        !snapshot.exists ||
        !data ||
        data.status !== 'processing' ||
        data.claim !== input.session.claim
      ) {
        throw consumedOAuthSessionException;
      }

      transaction.create(ticketReference, {
        provider: input.session.provider,
        purpose: input.session.purpose,
        sessionId: input.session.state,
        appChallenge: input.session.appChallenge,
        uid: input.session.uid ?? null,
        payload: input.payload,
        status: 'ready',
        expiresAt,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(sessionReference, {
        status: 'completed',
        ticketId: ticket,
        completedAt: FieldValue.serverTimestamp(),
        claim: FieldValue.delete(),
        providerPKCEVerifier: FieldValue.delete(),
      });
    });
    return ticket;
  }

  // callback 실패 뒤 같은 session을 다시 처리할 수 있도록 claim을 해제합니다.
  async release(session: ClaimedOAuthSession): Promise<void> {
    const reference = this.firestore.doc(`oauthSessions/${session.state}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (
        snapshot.exists &&
        data?.status === 'processing' &&
        data.claim === session.claim
      ) {
        transaction.update(reference, {
          status: 'ready',
          claim: FieldValue.delete(),
          processingAt: FieldValue.delete(),
        });
      }
    });
  }

  // callback 보상 폐기에 실패한 credential을 session에 저장합니다.
  async storeCleanupPayload(
    session: ClaimedOAuthSession,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const reference = this.firestore.doc(`oauthSessions/${session.state}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        throw invalidOAuthSessionException(
          '정리할 OAuth session을 찾을 수 없습니다.',
        );
      }
      transaction.update(reference, {
        cleanupPayload: payload,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }
}

// 저장된 session 형식과 만료 시각을 검증합니다.
function validateStoredSession(data: DocumentData): void {
  if (
    typeof data.provider !== 'string' ||
    (data.purpose !== 'signIn' && data.purpose !== 'link') ||
    typeof data.appChallenge !== 'string' ||
    typeof data.providerPKCEVerifier !== 'string'
  ) {
    throw invalidOAuthSessionException(
      'OAuth session 형식이 올바르지 않습니다.',
    );
  }
  if (expired(data.expiresAt)) {
    throw expiredOAuthSessionException;
  }
}

// app challenge 입력 형식을 검증합니다.
function validateAppChallenge(appChallenge: string): void {
  if (
    appChallenge.length !== appChallengeLength ||
    !/^[A-Za-z0-9_-]+$/.test(appChallenge)
  ) {
    throw invalidAppChallengeException;
  }
}

// ready 상태이거나 processing lease가 만료된 문서인지 반환합니다.
function claimAvailable(data: DocumentData): boolean {
  if (data.status === 'ready') {
    return true;
  }
  if (data.status !== 'processing') {
    return false;
  }
  const processingAt = timestampMilliseconds(data.processingAt);
  return (
    processingAt === undefined ||
    processingAt + claimLifetimeMilliseconds <= Date.now()
  );
}

// Firestore 만료 시각이 지났는지 반환합니다.
function expired(value: unknown): boolean {
  const milliseconds = timestampMilliseconds(value);
  return milliseconds === undefined || milliseconds <= Date.now();
}

// Firestore Timestamp 계열 값을 epoch millisecond로 변환합니다.
function timestampMilliseconds(value: unknown): number | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value instanceof Date ? value.getTime() : undefined;
}

// URL과 문서 식별자에 사용할 임의 값을 생성합니다.
function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

// 공개 app challenge 검증 실패 오류입니다.
const invalidAppChallengeException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-app-challenge',
  'app challenge가 유효하지 않습니다.',
);

// OAuth session 조회·형식 검증 실패 오류를 구성합니다.
function invalidOAuthSessionException(message: string): ApiException {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    'invalid-oauth-session',
    message,
  );
}

// 만료된 OAuth session 오류입니다.
const expiredOAuthSessionException = new ApiException(
  HttpStatus.GONE,
  'expired-oauth-session',
  'OAuth session이 만료되었습니다.',
);

// 이미 처리 중이거나 소비된 OAuth session 오류입니다.
const consumedOAuthSessionException = new ApiException(
  HttpStatus.CONFLICT,
  'consumed-oauth-session',
  'OAuth session이 이미 처리되었습니다.',
);
