import { HttpStatus } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { AppleChallengeRepository } from './apple-challenge.repository';

describe(AppleChallengeRepository.name, () => {
  const transactionGet = jest.fn();
  const update = jest.fn<void, [unknown, Record<string, unknown>]>();
  const create = jest.fn();
  const reference = { id: 'challenge-1', create };
  const collectionDocument = jest.fn().mockReturnValue(reference);
  const collection = jest.fn().mockReturnValue({ doc: collectionDocument });
  const doc = jest.fn().mockReturnValue(reference);
  const runTransaction = jest.fn();
  const repository = new AppleChallengeRepository({
    collection,
    doc,
    runTransaction,
  } as unknown as Firestore);

  beforeEach(() => {
    jest.resetAllMocks();
    collection.mockReturnValue({ doc: collectionDocument });
    collectionDocument.mockReturnValue(reference);
    doc.mockReturnValue(reference);
    runTransaction.mockImplementation(
      async (
        callback: (transaction: {
          get: typeof transactionGet;
          update: typeof update;
        }) => Promise<unknown>,
      ) => callback({ get: transactionGet, update }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('nonce hash와 5분 만료 시간을 challenge 문서에 저장한다', async () => {
    const now = Date.parse('2026-08-06T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const challenge = await repository.create();

    expect(collection).toHaveBeenCalledWith('authChallenges');
    expect(collectionDocument).toHaveBeenCalledWith();
    expect(challenge.hashedNonce).toMatch(/^[a-f0-9]{64}$/);
    expect(challenge).toEqual({
      challengeId: 'challenge-1',
      hashedNonce: challenge.hashedNonce,
      expiresAt: '2026-08-06T00:05:00.000Z',
    });
    expect(create).toHaveBeenCalledWith({
      expectedHashedNonce: challenge.hashedNonce,
      expiresAt: Timestamp.fromMillis(now + 5 * 60 * 1000),
      consumedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  it('유효한 challenge를 transaction에서 한 번 소비한다', async () => {
    transactionGet.mockResolvedValue(
      challengeSnapshot({
        expectedHashedNonce: 'hashed-nonce',
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        consumedAt: null,
      }),
    );

    await expect(repository.consume('challenge-1')).resolves.toBe(
      'hashed-nonce',
    );
    expect(doc).toHaveBeenCalledWith('authChallenges/challenge-1');
    expect(update).toHaveBeenCalledWith(reference, {
      consumedAt: FieldValue.serverTimestamp(),
    });
  });

  it('존재하지 않는 challenge를 거부한다', async () => {
    transactionGet.mockResolvedValue({ exists: false });

    await expect(repository.consume('missing')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-apple-challenge',
        message: 'Apple 인증 challenge를 찾을 수 없습니다.',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    [{ expiresAt: Timestamp.now() }],
    [{ expectedHashedNonce: 'hashed-nonce', expiresAt: 'invalid' }],
  ])('형식이 올바르지 않은 challenge를 거부한다', async (data) => {
    transactionGet.mockResolvedValue(challengeSnapshot(data));

    await expect(repository.consume('invalid')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-apple-challenge',
        message: 'Apple 인증 challenge 형식이 올바르지 않습니다.',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('이미 소비된 challenge를 거부한다', async () => {
    transactionGet.mockResolvedValue(
      challengeSnapshot({
        expectedHashedNonce: 'hashed-nonce',
        expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        consumedAt: Timestamp.now(),
      }),
    );

    await expect(repository.consume('consumed')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: {
        code: 'consumed-apple-challenge',
        message: 'Apple 인증 challenge가 이미 사용되었습니다.',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('만료된 challenge를 거부한다', async () => {
    transactionGet.mockResolvedValue(
      challengeSnapshot({
        expectedHashedNonce: 'hashed-nonce',
        expiresAt: Timestamp.fromMillis(Date.now()),
        consumedAt: null,
      }),
    );

    await expect(repository.consume('expired')).rejects.toMatchObject({
      status: HttpStatus.GONE,
      response: {
        code: 'expired-apple-challenge',
        message: 'Apple 인증 challenge가 만료되었습니다.',
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('동시에 소비하면 한 요청만 성공한다', async () => {
    let data: Record<string, unknown> = {
      expectedHashedNonce: 'hashed-nonce',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      consumedAt: null,
    };
    let queue = Promise.resolve<unknown>(undefined);
    const serializedGet = jest.fn(() =>
      Promise.resolve(challengeSnapshot(data)),
    );
    const serializedUpdate = jest.fn(
      (_reference: unknown, value: Record<string, unknown>) => {
        data = { ...data, ...value };
      },
    );
    runTransaction.mockImplementation(
      (
        callback: (transaction: {
          get: typeof serializedGet;
          update: typeof serializedUpdate;
        }) => Promise<unknown>,
      ) => {
        const execution = queue.then(() =>
          callback({ get: serializedGet, update: serializedUpdate }),
        );
        queue = execution.then(
          () => undefined,
          () => undefined,
        );
        return execution;
      },
    );

    const results = await Promise.allSettled([
      repository.consume('challenge-1'),
      repository.consume('challenge-1'),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toEqual([
      { status: 'fulfilled', value: 'hashed-nonce' },
    ]);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: {
        status: HttpStatus.CONFLICT,
        response: { code: 'consumed-apple-challenge' },
      },
    });
    expect(serializedUpdate).toHaveBeenCalledTimes(1);
  });
});

// Firestore challenge 문서 snapshot 대역을 구성합니다.
function challengeSnapshot(data: Record<string, unknown>) {
  return { exists: true as const, data: () => data };
}
