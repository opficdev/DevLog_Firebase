import { createHash, randomBytes } from 'crypto';

// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import { FIREBASE_FIRESTORE_TOKEN } from '../firebase/firebase.tokens';

const challengeLifetimeMilliseconds = 5 * 60 * 1000;

// 클라이언트에 전달하는 Apple 인증 challenge 응답입니다.
export interface AppleChallengeResponse {
  // 저장된 challenge 문서 식별자를 저장합니다.
  challengeId: string;
  // Apple 인증 요청에 전달할 nonce hash를 저장합니다.
  hashedNonce: string;
  // challenge 만료 시각의 ISO 8601 문자열을 저장합니다.
  expiresAt: string;
}

// 존재하지 않거나 형식이 잘못된 Apple challenge 오류입니다.
const invalidChallengeException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-apple-challenge',
  'Apple 인증 challenge를 찾을 수 없습니다.',
);

// 형식이 잘못된 Apple challenge 오류입니다.
const malformedChallengeException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-apple-challenge',
  'Apple 인증 challenge 형식이 올바르지 않습니다.',
);

// 이미 소비된 Apple challenge 오류입니다.
const consumedChallengeException = new ApiException(
  HttpStatus.CONFLICT,
  'consumed-apple-challenge',
  'Apple 인증 challenge가 이미 사용되었습니다.',
);

// 만료된 Apple challenge 오류입니다.
const expiredChallengeException = new ApiException(
  HttpStatus.GONE,
  'expired-apple-challenge',
  'Apple 인증 challenge가 만료되었습니다.',
);

// Apple 인증 challenge의 생성과 1회 소비를 담당합니다.
@Injectable()
export class AppleChallengeRepository {
  // Firestore 저장소 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
  ) {}

  // nonce hash와 만료 시간을 포함한 challenge를 생성합니다.
  async create(): Promise<AppleChallengeResponse> {
    const nonce = randomBytes(32).toString('hex');
    const hashedNonce = createHash('sha256').update(nonce).digest('hex');
    const expiresAt = Timestamp.fromMillis(
      Date.now() + challengeLifetimeMilliseconds,
    );
    const reference = this.firestore.collection('authChallenges').doc();

    await reference.create({
      expectedHashedNonce: hashedNonce,
      expiresAt,
      consumedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    return {
      challengeId: reference.id,
      hashedNonce,
      expiresAt: expiresAt.toDate().toISOString(),
    };
  }

  // 유효한 challenge를 transaction에서 한 번 소비하고 nonce hash를 반환합니다.
  async consume(challengeId: string): Promise<string> {
    const reference = this.firestore.doc(`authChallenges/${challengeId}`);
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        throw invalidChallengeException;
      }

      const data: Record<string, unknown> | undefined = snapshot.data();
      const expectedHashedNonce = data?.expectedHashedNonce;
      const expiresAtMilliseconds = timestampMillisecondsFrom(data?.expiresAt);
      if (
        typeof expectedHashedNonce !== 'string' ||
        expiresAtMilliseconds === undefined
      ) {
        throw malformedChallengeException;
      }
      if (data?.consumedAt) {
        throw consumedChallengeException;
      }
      if (expiresAtMilliseconds <= Date.now()) {
        throw expiredChallengeException;
      }

      transaction.update(reference, {
        consumedAt: FieldValue.serverTimestamp(),
      });
      return expectedHashedNonce;
    });
  }
}

// Firestore Timestamp 계열 값을 epoch millisecond로 변환합니다.
function timestampMillisecondsFrom(value: unknown): number | undefined {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  return undefined;
}
