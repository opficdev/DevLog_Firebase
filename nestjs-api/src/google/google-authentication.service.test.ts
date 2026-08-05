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
  const resolveUid = jest.fn();
  const save = jest.fn();
  const createCustomToken = jest.fn();
  const configuration: GoogleAuthenticationConfiguration = {
    clientId: 'client-id',
    clientSecret: 'client-secret',
  };
  const service = new GoogleAuthenticationService(
    { createCustomToken } as unknown as Auth,
    configuration,
    {
      exchangeAuthorizationCode,
      verifyIdToken,
    } as unknown as GoogleAuthenticationClient,
    { save } as unknown as GoogleCredentialRepository,
    { resolveUid } as unknown as GoogleProviderRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
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
