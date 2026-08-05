import { HttpStatus } from '@nestjs/common';
import axios, { type AxiosError } from 'axios';
import * as jwt from 'jsonwebtoken';

import { GoogleAuthenticationClient } from './google-authentication.client';
import { type GoogleTokenPayload } from './google-authentication.types';

jest.mock('axios');
jest.mock('jsonwebtoken');
jest.mock('jwks-rsa', () => ({
  __esModule: true,
  default: () => ({ getSigningKey: jest.fn() }),
  SigningKeyNotFoundError: class SigningKeyNotFoundError extends Error {},
}));

const mockedAxios = jest.mocked(axios);
const mockedJwt = jest.mocked(jwt);

describe(GoogleAuthenticationClient.name, () => {
  const client = new GoogleAuthenticationClient({
    clientId: 'client-id',
    clientSecret: 'client-secret',
  });

  beforeEach(() => {
    jest.resetAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error) =>
        !!error &&
        typeof error === 'object' &&
        (error as Record<string, unknown>).isAxiosError === true,
    );
  });

  it('serverAuthCode를 필요한 form 값으로 교환한다', async () => {
    mockedAxios.post.mockResolvedValue({
      status: HttpStatus.OK,
      data: {
        access_token: 'access-token',
        id_token: 'id-token',
        refresh_token: 'refresh-token',
      },
    });

    await expect(
      client.exchangeAuthorizationCode('server-auth-code'),
    ).resolves.toEqual({
      accessToken: 'access-token',
      idToken: 'id-token',
      refreshToken: 'refresh-token',
    });
    const requestBody = mockedAxios.post.mock.calls[0][1];
    expect(Object.fromEntries(requestBody as URLSearchParams)).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'server-auth-code',
      redirect_uri: '',
      grant_type: 'authorization_code',
    });
  });

  it.each([
    ['invalid_grant', HttpStatus.UNAUTHORIZED, 'invalid-google-proof'],
    [
      'temporarily_unavailable',
      HttpStatus.BAD_GATEWAY,
      'google-provider-failed',
    ],
  ])(
    'token 교환의 %s 오류 계약을 보존한다',
    async (providerCode, status, code) => {
      mockedAxios.post.mockRejectedValue(
        axiosError(HttpStatus.BAD_REQUEST, { error: providerCode }),
      );

      await expect(
        client.exchangeAuthorizationCode('server-auth-code'),
      ).rejects.toMatchObject({ status, response: { code } });
    },
  );

  it.each(['https://accounts.google.com', 'accounts.google.com'])(
    '%s issuer의 ID token payload를 반환한다',
    async (issuer) => {
      mockedJwt.verify.mockImplementation(
        (_token, _key, _options, callback) => {
          callback?.(null, googleTokenPayload({ iss: issuer }));
        },
      );

      await expect(client.verifyIdToken('id-token')).resolves.toMatchObject({
        iss: issuer,
        aud: 'client-id',
        sub: 'google-subject',
      });
    },
  );

  it('허용하지 않은 issuer의 ID token을 거부한다', async () => {
    mockedJwt.verify.mockImplementation((_token, _key, _options, callback) => {
      callback?.(
        null,
        googleTokenPayload({ iss: 'https://invalid.example.com' }),
      );
    });

    await expect(client.verifyIdToken('id-token')).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'invalid-google-proof' },
    });
  });

  it('지정 token을 form body로 폐기한다', async () => {
    mockedAxios.post.mockResolvedValue({ status: HttpStatus.OK });

    await client.revokeOAuthToken('user-1', 'refresh-token');

    const requestBody = mockedAxios.post.mock.calls[0][1];
    expect(Object.fromEntries(requestBody as URLSearchParams)).toEqual({
      token: 'refresh-token',
    });
  });

  it('이미 무효화된 token 폐기를 성공으로 처리한다', async () => {
    mockedAxios.post.mockRejectedValue(
      axiosError(HttpStatus.BAD_REQUEST, { error: 'invalid_token' }),
    );

    await expect(
      client.revokeOAuthToken('user-1', 'invalid-token'),
    ).resolves.toBeUndefined();
  });

  it('Google revoke 실패를 계약 오류로 변환한다', async () => {
    mockedAxios.post.mockRejectedValue(
      axiosError(HttpStatus.INTERNAL_SERVER_ERROR, { error: 'server_error' }),
    );

    await expect(
      client.revokeOAuthToken('user-1', 'refresh-token'),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { code: 'google-revoke-failed' },
    });
  });
});

// 검증된 Google ID token payload 대역을 구성합니다.
function googleTokenPayload(
  overrides: Partial<GoogleTokenPayload> = {},
): GoogleTokenPayload {
  return {
    iss: 'https://accounts.google.com',
    sub: 'google-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    ...overrides,
  };
}

// Axios 오류 대역을 구성합니다.
function axiosError(status: number, data: unknown): AxiosError {
  return {
    name: 'AxiosError',
    message: `status ${status}`,
    isAxiosError: true,
    response: { status, data },
  } as AxiosError;
}
