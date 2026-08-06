import { randomBytes, timingSafeEqual } from 'crypto';

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type DocumentData,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';
import { challengeFor } from './oauth-proof';
import { type ClaimedOAuthTicket, type OAuthPurpose } from './oauth.types';

const claimLifetimeMilliseconds = 60 * 1000;
const appVerifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/;

// OAuth ticket의 claim과 소비 상태 전이를 담당합니다.
@Injectable()
export class OAuthTicketRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // app verifier와 결합 조건을 확인하고 ticket을 claim합니다.
  async claim(
    ticket: string,
    appVerifier: string,
    expectedProvider: string,
    expectedPurpose: OAuthPurpose,
    expectedUID?: string,
  ): Promise<ClaimedOAuthTicket> {
    if (!appVerifierPattern.test(appVerifier)) {
      throw invalidAppVerifierException;
    }

    const reference = this.firestore.doc(`oauthTickets/${ticket}`);
    const claim = randomValue();
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (!snapshot.exists || !data) {
        throw invalidOAuthTicketException('OAuth ticket을 찾을 수 없습니다.');
      }
      validateStoredTicket(data);
      if (!challengeMatches(appVerifier, data.appChallenge as string)) {
        throw invalidAppVerifierException;
      }
      if (
        data.provider !== expectedProvider ||
        data.purpose !== expectedPurpose ||
        (expectedUID !== undefined && data.uid !== expectedUID)
      ) {
        throw mismatchedOAuthTicketException;
      }
      if (!claimAvailable(data)) {
        throw consumedOAuthTicketException;
      }

      transaction.update(reference, {
        status: 'processing',
        claim,
        processingAt: FieldValue.serverTimestamp(),
      });
      return {
        claim,
        ticket,
        sessionId: data.sessionId as string,
        provider: data.provider as string,
        purpose: data.purpose as OAuthPurpose,
        uid: typeof data.uid === 'string' ? data.uid : undefined,
        payload: data.payload as Record<string, unknown>,
      };
    });
  }

  // 처리에 성공한 ticket을 transaction에서 한 번만 소비합니다.
  async consume(ticket: ClaimedOAuthTicket): Promise<void> {
    const reference = this.firestore.doc(`oauthTickets/${ticket.ticket}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (
        !snapshot.exists ||
        !data ||
        data.status !== 'processing' ||
        data.claim !== ticket.claim
      ) {
        throw consumedOAuthTicketException;
      }
      transaction.update(reference, {
        status: 'consumed',
        consumedAt: FieldValue.serverTimestamp(),
        claim: FieldValue.delete(),
        payload: FieldValue.delete(),
      });
    });
  }

  // 처리 실패 뒤 같은 verifier가 다시 요청할 수 있도록 claim을 해제합니다.
  async release(ticket: ClaimedOAuthTicket): Promise<void> {
    const reference = this.firestore.doc(`oauthTickets/${ticket.ticket}`);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const data = snapshot.data();
      if (
        snapshot.exists &&
        data?.status === 'processing' &&
        data.claim === ticket.claim
      ) {
        transaction.update(reference, {
          status: 'ready',
          claim: FieldValue.delete(),
          processingAt: FieldValue.delete(),
        });
      }
    });
  }
}

// 저장된 ticket 형식과 만료 시각을 검증합니다.
function validateStoredTicket(data: DocumentData): void {
  if (
    typeof data.provider !== 'string' ||
    (data.purpose !== 'signIn' && data.purpose !== 'link') ||
    typeof data.sessionId !== 'string' ||
    typeof data.appChallenge !== 'string' ||
    !data.payload ||
    typeof data.payload !== 'object'
  ) {
    throw invalidOAuthTicketException('OAuth ticket 형식이 올바르지 않습니다.');
  }
  if (expired(data.expiresAt)) {
    throw expiredOAuthTicketException;
  }
}

// 원본 verifier에서 계산한 challenge를 timing-safe 방식으로 비교합니다.
function challengeMatches(appVerifier: string, appChallenge: string): boolean {
  const actual = Buffer.from(challengeFor(appVerifier));
  const expected = Buffer.from(appChallenge);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
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

// ticket claim 식별자로 사용할 임의 값을 생성합니다.
function randomValue(): string {
  return randomBytes(32).toString('base64url');
}

// OAuth ticket 조회·형식 검증 실패 오류를 구성합니다.
function invalidOAuthTicketException(message: string): ApiException {
  return new ApiException(
    HttpStatus.BAD_REQUEST,
    'invalid-oauth-ticket',
    message,
  );
}

// 만료된 OAuth ticket 오류입니다.
const expiredOAuthTicketException = new ApiException(
  HttpStatus.GONE,
  'expired-oauth-ticket',
  'OAuth ticket이 만료되었습니다.',
);

// 이미 처리 중이거나 소비된 OAuth ticket 오류입니다.
const consumedOAuthTicketException = new ApiException(
  HttpStatus.CONFLICT,
  'consumed-oauth-ticket',
  'OAuth ticket이 이미 사용되었습니다.',
);

// OAuth ticket 결합 정보 불일치 오류입니다.
const mismatchedOAuthTicketException = new ApiException(
  HttpStatus.FORBIDDEN,
  'mismatched-oauth-ticket',
  'OAuth ticket 결합 정보가 일치하지 않습니다.',
);

// app verifier 검증 실패 오류입니다.
const invalidAppVerifierException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'invalid-app-verifier',
  'app verifier가 유효하지 않습니다.',
);
