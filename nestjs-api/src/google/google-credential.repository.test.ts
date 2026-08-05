import { HttpStatus } from '@nestjs/common';
import {
  FieldValue,
  type Firestore,
  Timestamp,
} from 'firebase-admin/firestore';

import { GoogleCredentialRepository } from './google-credential.repository';

describe(GoogleCredentialRepository.name, () => {
  const transactionGet = jest.fn();
  const set = jest.fn<
    void,
    [unknown, Record<string, unknown>, { merge: boolean }]
  >();
  const update = jest.fn<void, [unknown, Record<string, unknown>]>();
  const deleteDocument = jest.fn<void, [unknown]>();
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

  it('Google 계정 연결 claim을 획득한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({ data: () => undefined });

    const claim = await repository.claimAccountLink('user-1');

    expect(Buffer.from(claim, 'base64url')).toHaveLength(32);
    expect(set).toHaveBeenCalledWith(
      reference,
      expect.objectContaining({ accountLinkClaim: claim }),
      { merge: true },
    );
    expect(set.mock.calls[0]?.[1].accountLinkExpiresAt).toBeInstanceOf(
      Timestamp,
    );
  });

  it('삭제 중인 사용자의 계정 연결 claim 획득을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => ({ deletionStartedAt: {} }) })
      .mockResolvedValueOnce({ data: () => undefined });

    await expect(repository.claimAccountLink('user-1')).rejects.toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      response: { code: 'failed-precondition' },
    });
  });

  it('credential 폐기 중이면 계정 연결 claim 획득을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => ({
          revocationClaim: 'revocation-claim',
          revocationExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      });

    await expect(repository.claimAccountLink('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('계정 연결 중이면 새 claim 획득을 거부한다', async () => {
    transactionGet
      .mockResolvedValueOnce({ data: () => undefined })
      .mockResolvedValueOnce({
        data: () => ({
          accountLinkClaim: 'account-link-claim',
          accountLinkExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
        }),
      });

    await expect(repository.claimAccountLink('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'google-account-link-in-progress' },
    });
  });

  it('소유한 계정 연결 claim을 연장한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ accountLinkClaim: 'claim' }),
    });

    await expect(repository.renewAccountLink('user-1', 'claim')).resolves.toBe(
      true,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toBe(reference);
    expect(update.mock.calls[0]?.[1].accountLinkExpiresAt).toBeInstanceOf(
      Timestamp,
    );
  });

  it('소유하지 않은 계정 연결 claim은 연장하지 않는다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ accountLinkClaim: 'other-claim' }),
    });

    await expect(repository.renewAccountLink('user-1', 'claim')).resolves.toBe(
      false,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('소유한 계정 연결 claim을 해제한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ accountLinkClaim: 'claim' }),
    });

    await repository.releaseAccountLink('user-1', 'claim');

    expect(update).toHaveBeenCalledWith(reference, {
      accountLinkClaim: FieldValue.delete(),
      accountLinkExpiresAt: FieldValue.delete(),
    });
  });

  it('소유하지 않은 계정 연결 claim은 해제하지 않는다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ accountLinkClaim: 'other-claim' }),
    });

    await repository.releaseAccountLink('user-1', 'claim');

    expect(update).not.toHaveBeenCalled();
  });

  it('현재 credential의 폐기 claim을 획득한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      }),
    });

    const claim = await repository.claimRevocation('user-1', {
      accessToken: 'access-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    });

    expect(Buffer.from(claim, 'base64url')).toHaveLength(32);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[0]).toBe(reference);
    expect(update.mock.calls[0]?.[1].revocationClaim).toBe(claim);
    expect(update.mock.calls[0]?.[1].revocationExpiresAt).toBeInstanceOf(
      Timestamp,
    );
  });

  it('변경된 credential의 폐기 claim 획득을 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'other-access-token',
        clientId: 'client-id',
      }),
    });

    await expect(
      repository.claimRevocation('user-1', {
        accessToken: 'access-token',
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('credential 폐기 중이면 새 폐기 claim 획득을 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        revocationClaim: 'other-claim',
        revocationExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    });

    await expect(
      repository.claimRevocation('user-1', {
        accessToken: 'access-token',
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('계정 연결 중이면 credential 폐기 claim 획득을 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        accountLinkClaim: 'account-link-claim',
        accountLinkExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    });

    await expect(
      repository.claimRevocation('user-1', {
        accessToken: 'access-token',
        clientId: 'client-id',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('claim한 credential 문서를 삭제한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        revocationClaim: 'claim',
      }),
    });

    await repository.deleteRevoked(
      'user-1',
      { accessToken: 'access-token', clientId: 'client-id' },
      'claim',
    );

    expect(deleteDocument).toHaveBeenCalledWith(reference);
  });

  it('소유하지 않은 폐기 claim의 결과 적용을 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accessToken: 'access-token',
        clientId: 'client-id',
        revocationClaim: 'other-claim',
      }),
    });

    await expect(
      repository.deleteRevoked(
        'user-1',
        { accessToken: 'access-token', clientId: 'client-id' },
        'claim',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('소유한 credential 폐기 claim을 해제한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ revocationClaim: 'claim' }),
    });

    await repository.releaseRevocation('user-1', 'claim');

    expect(update).toHaveBeenCalledWith(reference, {
      revocationClaim: FieldValue.delete(),
      revocationExpiresAt: FieldValue.delete(),
    });
  });

  it('소유하지 않은 credential 폐기 claim은 해제하지 않는다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ revocationClaim: 'other-claim' }),
    });

    await repository.releaseRevocation('user-1', 'claim');

    expect(update).not.toHaveBeenCalled();
  });

  it('비어 있는 credential 문서를 삭제한다', async () => {
    transactionGet.mockResolvedValue({ data: () => undefined });

    await repository.deleteEmpty('user-1');

    expect(deleteDocument).toHaveBeenCalledWith(reference);
  });

  it('credential이 남아 있으면 빈 문서 정리를 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ accessToken: 'access-token', clientId: 'client-id' }),
    });

    await expect(repository.deleteEmpty('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('폐기 claim이 남아 있으면 빈 문서 정리를 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({ revocationClaim: 'claim' }),
    });

    await expect(repository.deleteEmpty('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
  });

  it('계정 연결 중이면 빈 credential 문서 정리를 거부한다', async () => {
    transactionGet.mockResolvedValue({
      data: () => ({
        accountLinkClaim: 'claim',
        accountLinkExpiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      }),
    });

    await expect(repository.deleteEmpty('user-1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'aborted' },
    });
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
