import { HttpStatus } from '@nestjs/common';
import { type Firestore, Timestamp } from 'firebase-admin/firestore';

import { challengeFor } from './oauth-proof';
import { OAuthTicketRepository } from './oauth-ticket.repository';

describe(OAuthTicketRepository.name, () => {
  let fake: FakeFirestore;
  let repository: OAuthTicketRepository;
  const appVerifier = 'a'.repeat(64);

  beforeEach(() => {
    fake = fakeFirestore();
    repository = new OAuthTicketRepository(fake.firestore);
  });

  it('검증한 sign-in ticket을 한 번 소비한다', async () => {
    fake.data.set('oauthTickets/ticket-1', readyTicket(appVerifier));

    const ticket = await repository.claim(
      'ticket-1',
      appVerifier,
      'github',
      'signIn',
    );
    expect(ticket).toMatchObject({
      ticket: 'ticket-1',
      sessionId: 'session-1',
      provider: 'github',
      purpose: 'signIn',
      payload: { accessToken: 'access-token', clientId: 'client-id' },
    });
    expect(fake.data.get('oauthTickets/ticket-1')).toMatchObject({
      status: 'processing',
      claim: ticket.claim,
    });

    await repository.consume(ticket);
    expect(fake.data.get('oauthTickets/ticket-1')).toMatchObject({
      status: 'consumed',
    });
    await expect(
      repository.claim('ticket-1', appVerifier, 'github', 'signIn'),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'consumed-oauth-ticket' },
    });
  });

  it('형식이 잘못되거나 일치하지 않는 app verifier를 거부한다', async () => {
    fake.data.set('oauthTickets/ticket-1', readyTicket(appVerifier));

    await expect(
      repository.claim('ticket-1', 'invalid', 'github', 'signIn'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'invalid-app-verifier' },
    });
    await expect(
      repository.claim('ticket-1', 'b'.repeat(64), 'github', 'signIn'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'invalid-app-verifier' },
    });
  });

  it('계정 연결 ticket의 UID 결합을 검증한다', async () => {
    fake.data.set('oauthTickets/ticket-1', {
      ...readyTicket(appVerifier),
      purpose: 'link',
      uid: 'current-uid',
    });

    await expect(
      repository.claim('ticket-1', appVerifier, 'github', 'link', 'other-uid'),
    ).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
      response: { code: 'mismatched-oauth-ticket' },
    });
    await expect(
      repository.claim(
        'ticket-1',
        appVerifier,
        'github',
        'link',
        'current-uid',
      ),
    ).resolves.toMatchObject({ uid: 'current-uid', purpose: 'link' });
  });

  it('만료 ticket을 소비하지 않고 거부한다', async () => {
    fake.data.set('oauthTickets/ticket-1', {
      ...readyTicket(appVerifier),
      expiresAt: Timestamp.fromMillis(Date.now()),
    });

    await expect(
      repository.claim('ticket-1', appVerifier, 'github', 'signIn'),
    ).rejects.toMatchObject({
      status: HttpStatus.GONE,
      response: { code: 'expired-oauth-ticket' },
    });
    expect(fake.data.get('oauthTickets/ticket-1')).toMatchObject({
      status: 'ready',
    });
  });

  it('만료된 processing lease를 다시 claim한다', async () => {
    fake.data.set('oauthTickets/ticket-1', {
      ...readyTicket(appVerifier),
      status: 'processing',
      claim: 'abandoned-claim',
      processingAt: Timestamp.fromMillis(Date.now() - 61_000),
    });

    const ticket = await repository.claim(
      'ticket-1',
      appVerifier,
      'github',
      'signIn',
    );

    expect(ticket.claim).not.toBe('abandoned-claim');
  });

  it('처리에 실패한 ticket을 ready 상태로 해제한다', async () => {
    fake.data.set('oauthTickets/ticket-1', readyTicket(appVerifier));
    const ticket = await repository.claim(
      'ticket-1',
      appVerifier,
      'github',
      'signIn',
    );

    await repository.release(ticket);

    expect(fake.data.get('oauthTickets/ticket-1')).toMatchObject({
      status: 'ready',
    });
  });
});

// verifier에 결합된 ready ticket 문서 데이터를 반환합니다.
function readyTicket(appVerifier: string): Record<string, unknown> {
  return {
    provider: 'github',
    purpose: 'signIn',
    sessionId: 'session-1',
    appChallenge: challengeFor(appVerifier),
    uid: null,
    payload: { accessToken: 'access-token', clientId: 'client-id' },
    status: 'ready',
    expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
  };
}

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
  const firestore = {
    doc(path: string) {
      return { path };
    },
    runTransaction(
      callback: (transaction: {
        get(target: { path: string }): Promise<{
          exists: boolean;
          data(): Record<string, unknown> | undefined;
        }>;
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
        update(target, value) {
          data.set(target.path, { ...(data.get(target.path) ?? {}), ...value });
        },
      });
    },
  } as unknown as Firestore;
  return { firestore, data };
}
