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
  const deleteDocument = jest.fn<void, [unknown]>();
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
          delete: typeof deleteDocument;
        }) => Promise<unknown>,
      ) =>
        callback({
          get: transactionGet,
          set,
          update,
          delete: deleteDocument,
        }),
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

  it('저장된 GitHub credential을 반환하고 기존 token 필드를 제거한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => credential('access-token') })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ githubAccessToken: 'legacy-token' }),
      });

    await expect(repository.find('user-1')).resolves.toEqual(
      credential('access-token'),
    );
    expect(update).toHaveBeenCalledWith(legacyReference, {
      githubAccessToken: FieldValue.delete(),
    });
  });

  it('clientId가 없는 저장 credential을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ accessToken: 'access-token' }) })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(repository.find('user-1')).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: { code: 'internal' },
    });
  });

  it('현재 credential의 폐기 claim을 획득한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => credential('access-token'),
    });

    const claim = await repository.claimRevocation(
      'user-1',
      credential('access-token'),
    );

    expect(Buffer.from(claim, 'base64url')).toHaveLength(32);
    expect(update.mock.calls[0]?.[0]).toBe(credentialReference);
    expect(update.mock.calls[0]?.[1].revocationClaim).toBe(claim);
    expect(update.mock.calls[0]?.[1].revocationExpiresAt).toBeInstanceOf(
      Timestamp,
    );
  });

  it('변경되었거나 폐기 중인 credential의 claim 획득을 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        ...credential('other-token'),
        revocationClaim: 'other-claim',
        revocationExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    });

    await expect(
      repository.claimRevocation('user-1', credential('access-token')),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('claim한 credential과 기존 token 필드를 삭제한다', async () => {
    transactionGet
      .mockResolvedValueOnce({
        data: () => ({
          ...credential('access-token'),
          revocationClaim: 'claim',
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ githubAccessToken: 'legacy-token' }),
      });

    await repository.deleteRevoked(
      'user-1',
      credential('access-token'),
      'claim',
    );

    expect(deleteDocument).toHaveBeenCalledWith(credentialReference);
    expect(update).toHaveBeenCalledWith(legacyReference, {
      githubAccessToken: FieldValue.delete(),
    });
  });

  it('소유한 credential 폐기 claim을 해제한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ revocationClaim: 'claim' }),
    });

    await repository.releaseRevocation('user-1', 'claim');

    expect(update).toHaveBeenCalledWith(credentialReference, {
      revocationClaim: FieldValue.delete(),
      revocationExpiresAt: FieldValue.delete(),
    });
  });

  it('비어 있는 credential 문서를 삭제한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.deleteEmpty('user-1');

    expect(deleteDocument).toHaveBeenCalledWith(credentialReference);
  });

  it('credential이나 폐기 상태가 남은 문서 정리를 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({
        data: () => ({
          ...credential('access-token'),
          pendingRevocations: [credential('old-token')],
        }),
      })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(repository.deleteEmpty('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});

// GitHub credential 대역을 구성합니다.
function credential(accessToken: string, clientId = 'client-id') {
  return { accessToken, clientId };
}
