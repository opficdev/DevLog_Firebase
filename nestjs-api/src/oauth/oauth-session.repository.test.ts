import { HttpStatus } from '@nestjs/common';
import { type Firestore, Timestamp } from 'firebase-admin/firestore';

import { challengeFor } from './oauth-proof';
import { OAuthSessionRepository } from './oauth-session.repository';

describe(OAuthSessionRepository.name, () => {
  let fake: FakeFirestore;
  let repository: OAuthSessionRepository;

  beforeEach(() => {
    fake = fakeFirestore();
    repository = new OAuthSessionRepository(fake.firestore);
  });

  it('공개 값과 서버 전용 PKCE verifier를 10분 session에 저장한다', async () => {
    const now = Date.parse('2026-08-06T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const creation = await repository.create({
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
    });

    expect(creation.providerPKCEChallenge).toBe(
      challengeFor('provider-verifier'),
    );
    expect(creation.expiresAt).toEqual(new Date('2026-08-06T00:10:00.000Z'));
    expect(fake.data.get(`oauthSessions/${creation.state}`)).toMatchObject({
      state: creation.state,
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      uid: null,
      status: 'ready',
      expiresAt: Timestamp.fromMillis(now + 10 * 60 * 1000),
    });
  });

  it('형식이 잘못된 app challenge를 거부한다', async () => {
    await expect(
      repository.create({
        provider: 'github',
        purpose: 'signIn',
        appChallenge: 'invalid',
        providerPKCEVerifier: 'provider-verifier',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'invalid-app-challenge' },
    });
  });

  it('계정 연결 session에 UID가 없으면 거부한다', async () => {
    await expect(
      repository.create({
        provider: 'github',
        purpose: 'link',
        appChallenge: 'a'.repeat(43),
        providerPKCEVerifier: 'provider-verifier',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'invalid-oauth-session' },
    });
  });

  it('유효한 session을 processing 상태로 claim한다', async () => {
    fake.data.set('oauthSessions/state-1', {
      provider: 'github',
      purpose: 'link',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      uid: 'current-uid',
      status: 'ready',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });

    const session = await repository.claim('state-1', 'github');

    expect(session).toMatchObject({
      state: 'state-1',
      provider: 'github',
      purpose: 'link',
      uid: 'current-uid',
    });
    expect(fake.data.get('oauthSessions/state-1')).toMatchObject({
      status: 'processing',
      claim: session.claim,
    });
  });

  it('만료되거나 이미 처리한 session을 구분해 거부한다', async () => {
    fake.data.set('oauthSessions/expired', {
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      status: 'ready',
      expiresAt: Timestamp.fromMillis(Date.now()),
    });
    fake.data.set('oauthSessions/completed', {
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      status: 'completed',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });

    await expect(repository.claim('expired', 'github')).rejects.toMatchObject({
      status: HttpStatus.GONE,
      response: { code: 'expired-oauth-session' },
    });
    await expect(repository.claim('completed', 'github')).rejects.toMatchObject(
      {
        status: HttpStatus.CONFLICT,
        response: { code: 'consumed-oauth-session' },
      },
    );
  });

  it('claim한 session을 완료하고 5분 ticket을 생성한다', async () => {
    fake.data.set('oauthSessions/state-1', {
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      status: 'ready',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    const session = await repository.claim('state-1', 'github');

    const ticket = await repository.complete({
      session,
      payload: { accessToken: 'access-token', clientId: 'client-id' },
    });

    expect(fake.data.get(`oauthTickets/${ticket}`)).toMatchObject({
      provider: 'github',
      purpose: 'signIn',
      sessionId: 'state-1',
      appChallenge: 'a'.repeat(43),
      uid: null,
      payload: { accessToken: 'access-token', clientId: 'client-id' },
      status: 'ready',
    });
    expect(fake.data.get('oauthSessions/state-1')).toMatchObject({
      status: 'completed',
      ticketId: ticket,
    });
  });

  it('실패한 session claim을 해제하고 cleanup payload를 저장한다', async () => {
    fake.data.set('oauthSessions/state-1', {
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'a'.repeat(43),
      providerPKCEVerifier: 'provider-verifier',
      status: 'ready',
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
    });
    const session = await repository.claim('state-1', 'github');

    await repository.storeCleanupPayload(session, {
      accessToken: 'access-token',
    });
    await repository.release(session);

    expect(fake.data.get('oauthSessions/state-1')).toMatchObject({
      status: 'ready',
      cleanupPayload: { accessToken: 'access-token' },
    });
  });
});

// transaction 동작을 메모리에서 실행하는 Firestore 대역입니다.
interface FakeFirestore {
  // Firestore 주입 대역을 저장합니다.
  firestore: Firestore;
  // 문서 경로별 데이터를 저장합니다.
  data: Map<string, Record<string, unknown>>;
}

// OAuth Repository 시험용 Firestore 대역을 구성합니다.
function fakeFirestore(): FakeFirestore {
  const data = new Map<string, Record<string, unknown>>();
  const reference = (path: string) => ({ path });
  const write = (target: { path: string }, value: Record<string, unknown>) => {
    data.set(target.path, { ...(data.get(target.path) ?? {}), ...value });
  };
  const firestore = {
    doc(path: string) {
      return {
        ...reference(path),
        create(value: Record<string, unknown>) {
          data.set(path, value);
          return Promise.resolve();
        },
      };
    },
    runTransaction(
      callback: (transaction: {
        get(target: { path: string }): Promise<{
          exists: boolean;
          data(): Record<string, unknown> | undefined;
        }>;
        create(target: { path: string }, value: Record<string, unknown>): void;
        update(target: { path: string }, value: Record<string, unknown>): void;
      }) => Promise<unknown>,
    ) {
      return callback({
        get(target) {
          return Promise.resolve({
            exists: data.has(target.path),
            data: () => data.get(target.path),
          });
        },
        create(target, value) {
          data.set(target.path, value);
        },
        update: write,
      });
    },
  } as unknown as Firestore;
  return { firestore, data };
}
