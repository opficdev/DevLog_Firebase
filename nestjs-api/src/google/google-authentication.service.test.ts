import { Logger } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { GoogleAuthenticationClient } from './google-authentication.client';
import { GoogleAuthenticationService } from './google-authentication.service';
import {
  type GoogleAuthenticationConfiguration,
  type GoogleTokenPayload,
} from './google-authentication.types';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

describe(GoogleAuthenticationService.name, () => {
  const exchangeAuthorizationCode = jest.fn();
  const verifyIdToken = jest.fn();
  const revokeOAuthToken = jest.fn();
  const resolveUid = jest.fn();
  const link = jest.fn();
  const claimAccountLink = jest.fn();
  const renewAccountLink = jest.fn();
  const releaseAccountLink = jest.fn();
  const find = jest.fn();
  const deleteEmpty = jest.fn();
  const claimRevocation = jest.fn();
  const deleteRevoked = jest.fn();
  const releaseRevocation = jest.fn();
  const save = jest.fn();
  const createCustomToken = jest.fn();
  const updateUser = jest.fn();
  const loggerError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation();
  const configuration: GoogleAuthenticationConfiguration = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
  const service = new GoogleAuthenticationService(
    { createCustomToken, updateUser } as unknown as Auth,
    configuration,
    {
      exchangeAuthorizationCode,
      revokeOAuthToken,
      verifyIdToken,
    } as unknown as GoogleAuthenticationClient,
    {
      claimAccountLink,
      claimRevocation,
      deleteEmpty,
      deleteRevoked,
      find,
      releaseAccountLink,
      releaseRevocation,
      renewAccountLink,
      save,
    } as unknown as GoogleCredentialRepository,
    { link, resolveUid } as unknown as GoogleProviderRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('Google 인증 자료를 저장한 뒤 Firebase custom token을 반환한다', async () => {
    const sequence: string[] = [];
    const payload = googleTokenPayload();
    exchangeAuthorizationCode.mockImplementation(() => {
      sequence.push('authorization code 교환');
      return Promise.resolve({
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
      });
    });
    verifyIdToken.mockImplementation(() => {
      sequence.push('ID token 검증');
      return Promise.resolve(payload);
    });
    resolveUid.mockImplementation(() => {
      sequence.push('Firebase uid 결정');
      return Promise.resolve('user-1');
    });
    save.mockImplementation(() => {
      sequence.push('credential 저장');
      return Promise.resolve();
    });
    createCustomToken.mockImplementation(() => {
      sequence.push('custom token 생성');
      return Promise.resolve('custom-token');
    });

    await expect(service.customToken('server-auth-code')).resolves.toBe(
      'custom-token',
    );
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith('server-auth-code');
    expect(verifyIdToken).toHaveBeenCalledWith('id-token');
    expect(resolveUid).toHaveBeenCalledWith(payload);
    expect(save).toHaveBeenCalledWith('user-1', {
      accessToken: 'access-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    });
    expect(createCustomToken).toHaveBeenCalledWith('user-1');
    expect(sequence).toEqual([
      'authorization code 교환',
      'ID token 검증',
      'Firebase uid 결정',
      'credential 저장',
      'custom token 생성',
    ]);
  });

  it('credential 저장 실패 시 Firebase custom token을 생성하지 않는다', async () => {
    const error = new Error('credential 저장 실패');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    resolveUid.mockResolvedValue('user-1');
    save.mockRejectedValue(error);

    await expect(service.customToken('server-auth-code')).rejects.toBe(error);
    expect(createCustomToken).not.toHaveBeenCalled();
  });

  it('계정 연결 claim으로 provider와 credential을 순서대로 연결한다', async () => {
    const sequence: string[] = [];
    const payload = googleTokenPayload();
    claimAccountLink.mockImplementation(() => {
      sequence.push('계정 연결 claim 획득');
      return Promise.resolve('claim');
    });
    exchangeAuthorizationCode.mockImplementation(() => {
      sequence.push('authorization code 교환');
      return Promise.resolve({
        accessToken: 'access-token',
        idToken: 'id-token',
        refreshToken: 'refresh-token',
      });
    });
    verifyIdToken.mockImplementation(() => {
      sequence.push('ID token 검증');
      return Promise.resolve(payload);
    });
    link.mockImplementation(() => {
      sequence.push('provider 연결');
      return Promise.resolve(true);
    });
    save.mockImplementation(() => {
      sequence.push('credential 저장');
      return Promise.resolve();
    });

    await expect(
      service.link('user-1', 'server-auth-code'),
    ).resolves.toBeUndefined();
    expect(claimAccountLink).toHaveBeenCalledWith('user-1');
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith('server-auth-code');
    expect(verifyIdToken).toHaveBeenCalledWith('id-token');
    expect(link).toHaveBeenCalledWith('user-1', payload);
    expect(save).toHaveBeenCalledWith(
      'user-1',
      {
        accessToken: 'access-token',
        clientId: 'client-id',
        refreshToken: 'refresh-token',
      },
      'claim',
    );
    expect(sequence).toEqual([
      '계정 연결 claim 획득',
      'authorization code 교환',
      'ID token 검증',
      'provider 연결',
      'credential 저장',
    ]);
    expect(releaseAccountLink).not.toHaveBeenCalled();
  });

  it('Google 인증 실패 시 계정 연결 claim을 해제한다', async () => {
    const error = new Error('Google 인증 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockRejectedValue(error);

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(releaseAccountLink).toHaveBeenCalledWith('user-1', 'claim');
    expect(renewAccountLink).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('새 provider 연결 뒤 credential 저장 실패를 보상한다', async () => {
    const sequence: string[] = [];
    const error = new Error('credential 저장 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    link.mockImplementation(() => {
      sequence.push('provider 연결');
      return Promise.resolve(true);
    });
    save.mockImplementation(() => {
      sequence.push('credential 저장 실패');
      return Promise.reject(error);
    });
    renewAccountLink.mockImplementation(() => {
      sequence.push('claim 갱신');
      return Promise.resolve(true);
    });
    updateUser.mockImplementation(() => {
      sequence.push('provider 연결 보상');
      return Promise.resolve();
    });
    releaseAccountLink.mockImplementation(() => {
      sequence.push('claim 해제');
      return Promise.resolve();
    });

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(renewAccountLink).toHaveBeenCalledWith('user-1', 'claim');
    expect(updateUser).toHaveBeenCalledWith('user-1', {
      providersToUnlink: ['google.com'],
    });
    expect(releaseAccountLink).toHaveBeenCalledWith('user-1', 'claim');
    expect(sequence).toEqual([
      'provider 연결',
      'credential 저장 실패',
      'claim 갱신',
      'provider 연결 보상',
      'claim 해제',
    ]);
  });

  it('기존 provider의 credential 저장 실패는 연결을 보상하지 않는다', async () => {
    const error = new Error('credential 저장 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    link.mockResolvedValue(false);
    save.mockRejectedValue(error);

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(renewAccountLink).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    expect(releaseAccountLink).toHaveBeenCalledWith('user-1', 'claim');
  });

  it('claim 소유권을 잃으면 provider 연결을 보상하지 않는다', async () => {
    const error = new Error('credential 저장 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    link.mockResolvedValue(true);
    save.mockRejectedValue(error);
    renewAccountLink.mockResolvedValue(false);

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(releaseAccountLink).toHaveBeenCalledWith('user-1', 'claim');
  });

  it('claim 갱신과 해제 실패가 원래 오류를 덮지 않는다', async () => {
    const error = new Error('credential 저장 실패');
    const renewError = new Error('claim 갱신 실패');
    const releaseError = new Error('claim 해제 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    link.mockResolvedValue(true);
    save.mockRejectedValue(error);
    renewAccountLink.mockRejectedValue(renewError);
    releaseAccountLink.mockRejectedValue(releaseError);

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      'Google 계정 연결 lease 갱신 실패',
      renewError,
      { uid: 'user-1' },
    );
    expect(loggerError).toHaveBeenCalledWith(
      'Google 계정 연결 lease 해제 실패',
      releaseError,
      { uid: 'user-1' },
    );
  });

  it('provider 연결 보상 실패가 원래 오류를 덮지 않는다', async () => {
    const error = new Error('credential 저장 실패');
    const compensationError = new Error('provider 연결 보상 실패');
    claimAccountLink.mockResolvedValue('claim');
    exchangeAuthorizationCode.mockResolvedValue({
      accessToken: 'access-token',
      idToken: 'id-token',
    });
    verifyIdToken.mockResolvedValue(googleTokenPayload());
    link.mockResolvedValue(true);
    save.mockRejectedValue(error);
    renewAccountLink.mockResolvedValue(true);
    updateUser.mockRejectedValue(compensationError);

    await expect(service.link('user-1', 'server-auth-code')).rejects.toBe(
      error,
    );
    expect(releaseAccountLink).toHaveBeenCalledWith('user-1', 'claim');
    expect(loggerError).toHaveBeenCalledWith(
      'Google provider 연결 보상 실패',
      compensationError,
      { uid: 'user-1' },
    );
  });

  it('refresh token으로 grant를 폐기한 뒤 credential을 삭제한다', async () => {
    const sequence: string[] = [];
    const credential = {
      accessToken: 'access-token',
      clientId: 'client-id',
      refreshToken: 'refresh-token',
    };
    find.mockImplementation(() => {
      sequence.push('credential 조회');
      return Promise.resolve(credential);
    });
    claimRevocation.mockImplementation(() => {
      sequence.push('폐기 claim 획득');
      return Promise.resolve('claim');
    });
    revokeOAuthToken.mockImplementation(() => {
      sequence.push('Google grant 폐기');
      return Promise.resolve();
    });
    deleteRevoked.mockImplementation(() => {
      sequence.push('credential 삭제');
      return Promise.resolve();
    });

    await expect(service.revoke('user-1')).resolves.toBeUndefined();
    expect(find).toHaveBeenCalledWith('user-1');
    expect(claimRevocation).toHaveBeenCalledWith('user-1', credential);
    expect(revokeOAuthToken).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(deleteRevoked).toHaveBeenCalledWith('user-1', credential, 'claim');
    expect(sequence).toEqual([
      'credential 조회',
      '폐기 claim 획득',
      'Google grant 폐기',
      'credential 삭제',
    ]);
  });

  it('refresh token이 없으면 access token으로 grant를 폐기한다', async () => {
    const credential = {
      accessToken: 'access-token',
      clientId: 'client-id',
    };
    find.mockResolvedValue(credential);
    claimRevocation.mockResolvedValue('claim');

    await expect(service.revoke('user-1')).resolves.toBeUndefined();
    expect(revokeOAuthToken).toHaveBeenCalledWith('user-1', 'access-token');
    expect(deleteRevoked).toHaveBeenCalledWith('user-1', credential, 'claim');
  });

  it('저장된 credential이 없으면 빈 문서만 삭제한다', async () => {
    find.mockResolvedValue(undefined);

    await expect(service.revoke('user-1')).resolves.toBeUndefined();
    expect(deleteEmpty).toHaveBeenCalledWith('user-1');
    expect(claimRevocation).not.toHaveBeenCalled();
    expect(revokeOAuthToken).not.toHaveBeenCalled();
    expect(deleteRevoked).not.toHaveBeenCalled();
  });

  it('Google grant 폐기 실패 시 claim을 해제하고 오류를 전달한다', async () => {
    const error = new Error('Google grant 폐기 실패');
    const credential = {
      accessToken: 'access-token',
      clientId: 'client-id',
    };
    find.mockResolvedValue(credential);
    claimRevocation.mockResolvedValue('claim');
    revokeOAuthToken.mockRejectedValue(error);

    await expect(service.revoke('user-1')).rejects.toBe(error);
    expect(releaseRevocation).toHaveBeenCalledWith('user-1', 'claim');
    expect(deleteRevoked).not.toHaveBeenCalled();
  });

  it('credential 삭제 실패 시 claim을 해제하고 오류를 전달한다', async () => {
    const error = new Error('credential 삭제 실패');
    const credential = {
      accessToken: 'access-token',
      clientId: 'client-id',
    };
    find.mockResolvedValue(credential);
    claimRevocation.mockResolvedValue('claim');
    deleteRevoked.mockRejectedValue(error);

    await expect(service.revoke('user-1')).rejects.toBe(error);
    expect(releaseRevocation).toHaveBeenCalledWith('user-1', 'claim');
  });

  it('claim 해제 실패 시 해제 오류를 전달한다', async () => {
    const revocationError = new Error('Google grant 폐기 실패');
    const releaseError = new Error('claim 해제 실패');
    find.mockResolvedValue({
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    claimRevocation.mockResolvedValue('claim');
    revokeOAuthToken.mockRejectedValue(revocationError);
    releaseRevocation.mockRejectedValue(releaseError);

    await expect(service.revoke('user-1')).rejects.toBe(releaseError);
  });
});

// 검증된 Google ID token payload 대역을 구성합니다.
function googleTokenPayload(): GoogleTokenPayload {
  return {
    iss: 'https://accounts.google.com',
    sub: 'google-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    email: 'user@example.com',
    email_verified: true,
  };
}
