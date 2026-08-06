import { HttpStatus } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { GitHubCredentialRepository } from './github-credential.repository';

describe(GitHubCredentialRepository.name, () => {
  const transactionGet = jest.fn();
  const set = jest.fn<
    void,
    [unknown, Record<string, unknown>, { merge: boolean }]
  >();
  const update = jest.fn<void, [unknown, Record<string, unknown>]>();
  const get = jest.fn();
  const rootReference = { path: 'authCredentials/user-1' };
  const credentialReference = {
    path: 'authCredentials/user-1/providers/github',
    get,
  };
  const legacyReference = { path: 'users/user-1/userData/tokens' };
  const doc = jest.fn();
  const runTransaction = jest.fn();
  const repository = new GitHubCredentialRepository({
    doc,
    runTransaction,
  } as unknown as Firestore);

  beforeEach(() => {
    jest.resetAllMocks();
    doc.mockImplementation((path: string) => {
      if (path === rootReference.path) {
        return rootReference;
      }
      if (path === credentialReference.path) {
        return credentialReference;
      }
      return legacyReference;
    });
    runTransaction.mockImplementation(
      async (
        callback: (transaction: {
          get: typeof transactionGet;
          set: typeof set;
          update: typeof update;
        }) => Promise<unknown>,
      ) => callback({ get: transactionGet, set, update }),
    );
  });

  it('GitHub credential을 서버 전용 경로에 저장한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.save('user-1', credential('new-token'));

    expect(doc).toHaveBeenNthCalledWith(1, rootReference.path);
    expect(doc).toHaveBeenNthCalledWith(2, credentialReference.path);
    expect(doc).toHaveBeenNthCalledWith(3, legacyReference.path);
    expect(set).toHaveBeenCalledWith(
      credentialReference,
      {
        accessToken: 'new-token',
        clientId: 'client-id',
        pendingRevocations: [],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  it('같은 App의 이전 credential을 폐기 대기 목록에 남긴다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => ({
          accessToken: 'old-token',
          clientId: 'client-id',
          pendingRevocations: [
            credential('older-token'),
            credential('older-token'),
            credential('new-token'),
            credential('other-token', 'other-client-id'),
          ],
        }),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.save('user-1', credential('new-token'));

    expect(set).toHaveBeenCalledWith(
      credentialReference,
      expect.objectContaining({
        pendingRevocations: [
          credential('older-token'),
          credential('old-token'),
        ],
      }),
      { merge: true },
    );
  });

  it('다른 App의 이전 credential은 폐기 대기 목록에 남기지 않는다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => credential('old-token', 'old-client-id'),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.save('user-1', credential('new-token'));

    expect(set).toHaveBeenCalledWith(
      credentialReference,
      expect.objectContaining({ pendingRevocations: [] }),
      { merge: true },
    );
  });

  it('기존 사용자 GitHub token 필드를 제거한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ githubAccessToken: 'legacy-token' }),
      });

    await repository.save('user-1', credential('new-token'));

    expect(update).toHaveBeenCalledWith(legacyReference, {
      githubAccessToken: FieldValue.delete(),
    });
  });

  it('삭제 중인 사용자의 credential 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ deletionStartedAt: {} }) })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      repository.save('user-1', credential('new-token')),
    ).rejects.toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      response: { code: 'failed-precondition' },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('폐기 중인 credential 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => ({
          revocationClaim: 'claim',
          revocationExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      repository.save('user-1', credential('new-token')),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
    expect(set).not.toHaveBeenCalled();
  });

  it('폐기 대기 목록에서 유효한 credential만 반환한다', async () => {
    get.mockResolvedValue({
      data: () => ({
        pendingRevocations: [
          credential('old-token'),
          { accessToken: 'missing-client-id' },
          null,
        ],
      }),
    });

    await expect(repository.pendingRevocations('user-1')).resolves.toEqual([
      credential('old-token'),
    ]);
  });

  it('폐기한 credential만 폐기 대기 목록에서 제거한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        pendingRevocations: [
          credential('removed-token'),
          credential('remaining-token'),
        ],
      }),
    });

    await repository.removePending('user-1', credential('removed-token'));

    expect(set).toHaveBeenCalledWith(
      credentialReference,
      {
        pendingRevocations: [credential('remaining-token')],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });
});

// GitHub credential 대역을 구성합니다.
function credential(accessToken: string, clientId = 'client-id') {
  return { accessToken, clientId };
}
