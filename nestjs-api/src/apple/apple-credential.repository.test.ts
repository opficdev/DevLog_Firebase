import { HttpStatus } from '@nestjs/common';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { AppleCredentialRepository } from './apple-credential.repository';

describe(AppleCredentialRepository.name, () => {
  const transactionGet = jest.fn();
  const set = jest.fn<
    void,
    [unknown, Record<string, unknown>, { merge: boolean }]
  >();
  const update = jest.fn<void, [unknown, Record<string, unknown>]>();
  const deleteDocument = jest.fn<void, [unknown]>();
  const rootReference = { path: 'authCredentials/user-1' };
  const credentialReference = {
    path: 'authCredentials/user-1/providers/apple',
  };
  const legacyReference = { path: 'users/user-1/userData/tokens' };
  const doc = jest.fn();
  const runTransaction = jest.fn();
  const repository = new AppleCredentialRepository({
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

  it('Apple credential을 서버 전용 경로에 저장한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.save('user-1', 'refresh-token');

    expect(doc).toHaveBeenNthCalledWith(1, 'authCredentials/user-1');
    expect(doc).toHaveBeenNthCalledWith(
      2,
      'authCredentials/user-1/providers/apple',
    );
    expect(doc).toHaveBeenNthCalledWith(3, 'users/user-1/userData/tokens');
    expect(set).toHaveBeenCalledWith(
      credentialReference,
      {
        refreshToken: 'refresh-token',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('기존 Apple refresh token 필드를 제거한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ appleRefreshToken: 'legacy-refresh-token' }),
      });

    await repository.save('user-1', 'refresh-token');

    expect(update).toHaveBeenCalledWith(legacyReference, {
      appleRefreshToken: FieldValue.delete(),
    });
  });

  it('기존 Apple refresh token 필드가 없으면 문서를 갱신하지 않는다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: true, data: () => ({}) });

    await repository.save('user-1', 'refresh-token');

    expect(update).not.toHaveBeenCalled();
  });

  it('삭제 중인 사용자의 Apple credential 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ deletionStartedAt: {} }) })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      repository.save('user-1', 'refresh-token'),
    ).rejects.toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      response: {
        code: 'failed-precondition',
        message: '삭제 중인 사용자의 Apple credential은 저장할 수 없습니다.',
      },
    });
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('같은 credential 저장을 재시도해도 기존 token 필드는 한 번만 제거한다', async () => {
    const legacyData: Record<string, unknown> = {
      appleRefreshToken: 'legacy-refresh-token',
    };
    transactionGet.mockImplementation((reference: unknown) => {
      if (reference === rootReference) {
        return Promise.resolve({ data: () => undefined });
      }
      return Promise.resolve({
        exists: true,
        data: () => legacyData,
      });
    });
    update.mockImplementation(() => {
      delete legacyData.appleRefreshToken;
    });

    await repository.save('user-1', 'refresh-token');
    await repository.save('user-1', 'refresh-token');

    expect(set).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenNthCalledWith(
      2,
      credentialReference,
      {
        refreshToken: 'refresh-token',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('새 경로의 Apple refresh token을 우선 반환하고 기존 필드를 제거한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => ({ refreshToken: 'stored-refresh-token' }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ appleRefreshToken: 'legacy-refresh-token' }),
      });

    await expect(repository.find('user-1')).resolves.toBe(
      'stored-refresh-token',
    );
    expect(set).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(legacyReference, {
      appleRefreshToken: FieldValue.delete(),
    });
  });

  it('기존 Apple refresh token을 새 경로로 이관해 반환한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ appleRefreshToken: 'legacy-refresh-token' }),
      });

    await expect(repository.find('user-1')).resolves.toBe(
      'legacy-refresh-token',
    );
    expect(set).toHaveBeenCalledWith(
      credentialReference,
      {
        refreshToken: 'legacy-refresh-token',
        migratedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    expect(update).toHaveBeenCalledWith(legacyReference, {
      appleRefreshToken: FieldValue.delete(),
    });
  });

  it('삭제 중인 사용자의 기존 token은 새 경로에 이관하지 않는다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ deletionStartedAt: {} }) })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ appleRefreshToken: 'legacy-refresh-token' }),
      });

    await expect(repository.find('user-1')).resolves.toBe(
      'legacy-refresh-token',
    );
    expect(set).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(legacyReference, {
      appleRefreshToken: FieldValue.delete(),
    });
  });

  it('저장된 Apple refresh token이 없으면 undefined를 반환한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(repository.find('user-1')).resolves.toBeUndefined();
    expect(set).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('Apple credential과 기존 refresh token 필드를 삭제한다', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({ appleRefreshToken: 'legacy-refresh-token' }),
    });

    await repository.delete('user-1');

    expect(deleteDocument).toHaveBeenCalledWith(credentialReference);
    expect(update).toHaveBeenCalledWith(legacyReference, {
      appleRefreshToken: FieldValue.delete(),
    });
  });

  it('기존 refresh token 필드가 없어도 Apple credential을 삭제한다', async () => {
    transactionGet.mockResolvedValue({
      exists: true,
      data: () => ({}),
    });

    await repository.delete('user-1');

    expect(deleteDocument).toHaveBeenCalledWith(credentialReference);
    expect(update).not.toHaveBeenCalled();
  });
});
