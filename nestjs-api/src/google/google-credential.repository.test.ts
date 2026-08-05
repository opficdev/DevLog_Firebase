import { HttpStatus } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { GoogleCredentialRepository } from './google-credential.repository';

describe(GoogleCredentialRepository.name, () => {
  const transactionGet = jest.fn();
  const set = jest.fn();
  const get = jest.fn();
  const reference = { get };
  const doc = jest.fn().mockReturnValue(reference);
  const runTransaction = jest.fn();
  const repository = new GoogleCredentialRepository({
    doc,
    runTransaction,
  } as unknown as Firestore);

  beforeEach(() => {
    jest.resetAllMocks();
    doc.mockReturnValue(reference);
    runTransaction.mockImplementation(
      async (
        callback: (transaction: {
          get: typeof transactionGet;
          set: typeof set;
        }) => Promise<unknown>,
      ) => callback({ get: transactionGet, set }),
    );
  });

  it('새 Google credential을 저장한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await repository.save('user-1', {
      accessToken: 'access-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    });

    expect(doc).toHaveBeenNthCalledWith(1, 'authCredentials/user-1');
    expect(doc).toHaveBeenNthCalledWith(
      2,
      'authCredentials/user-1/providers/google',
    );
    expect(set).toHaveBeenCalledWith(
      reference,
      {
        accessToken: 'access-token',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  it('같은 client의 기존 refresh token을 보존한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          accessToken: 'old-access-token',
          clientId: 'client-id',
          refreshToken: 'stored-refresh-token',
        }),
      });

    await repository.save('user-1', {
      accessToken: 'new-access-token',
      clientId: 'client-id',
    });

    expect(set).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({ refreshToken: 'stored-refresh-token' }),
      { merge: true },
    );
  });

  it('client가 바뀌면 기존 refresh token을 제거한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          accessToken: 'old-access-token',
          clientId: 'old-client-id',
          refreshToken: 'stored-refresh-token',
        }),
      });

    await repository.save('user-1', {
      accessToken: 'new-access-token',
      clientId: 'new-client-id',
    });

    expect(set).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({ refreshToken: FieldValue.delete() }),
      { merge: true },
    );
  });

  it('계정 연결 claim으로 저장하면 claim을 해제한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          accountLinkClaim: 'claim',
          accountLinkExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      });

    await repository.save(
      'user-1',
      { accessToken: 'access-token', clientId: 'client-id' },
      'claim',
    );

    expect(set).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({
        accountLinkClaim: FieldValue.delete(),
        accountLinkExpiresAt: FieldValue.delete(),
      }),
      { merge: true },
    );
  });

  it('삭제 중인 사용자의 credential 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ deletionStartedAt: {} }) })
      .mockResolvedValueOnce({ exists: false, data: () => undefined });

    await expect(
      repository.save('user-1', {
        accessToken: 'access-token',
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      response: { code: 'failed-precondition' },
    });
  });

  it('폐기 중인 credential 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          revocationClaim: 'claim',
          revocationExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      });

    await expect(
      repository.save('user-1', {
        accessToken: 'access-token',
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('다른 계정 연결 claim이 진행 중이면 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          accountLinkClaim: 'other-claim',
          accountLinkExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      });

    await expect(
      repository.save(
        'user-1',
        { accessToken: 'access-token', clientId: 'client-id' },
        'claim',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'google-account-link-in-progress' },
    });
  });

  it('소유하지 않은 계정 연결 claim으로 저장을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ accountLinkClaim: 'other-claim' }),
      });

    await expect(
      repository.save(
        'user-1',
        { accessToken: 'access-token', clientId: 'client-id' },
        'claim',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('저장된 Google credential을 반환한다', async () => {
    get.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      }),
    });

    await expect(repository.find('user-1')).resolves.toEqual({
      accessToken: 'access-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    });
    expect(doc).toHaveBeenCalledWith('authCredentials/user-1/providers/google');
  });

  it('필수 값이 없는 credential은 반환하지 않는다', async () => {
    get.mockResolvedValue({ data: () => ({ clientId: 'client-id' }) });

    await expect(repository.find('user-1')).resolves.toBeUndefined();
  });
});
