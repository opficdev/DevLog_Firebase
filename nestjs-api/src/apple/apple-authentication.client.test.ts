import { HttpStatus } from '@nestjs/common';
import axios, { type AxiosError } from 'axios';
import * as jwt from 'jsonwebtoken';

import {
  AppleAuthenticationClient,
  isAppleEmailVerified,
} from './apple-authentication.client';
import { type AppleTokenPayload } from './apple-authentication.types';

jest.mock('axios');
jest.mock('jsonwebtoken');
jest.mock('jwks-rsa', () => ({
  __esModule: true,
  default: () => ({
    getSigningKey: jest.fn().mockResolvedValue({
      getPublicKey: () => 'public-key',
    }),
  }),
}));

const mockedAxios = jest.mocked(axios);
const mockedJwt = jest.mocked(jwt);

describe(AppleAuthenticationClient.name, () => {
  const client = new AppleAuthenticationClient({
    teamId: 'team-id',
    clientId: 'client-id',
    keyId: 'key-id',
    privateKey: 'private-key',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.post.mockReset();
    mockedAxios.isAxiosError.mockReset();
    mockedJwt.sign.mockReset();
    mockedJwt.verify.mockReset();
    mockedAxios.isAxiosError.mockImplementation(
      (error) =>
        !!error &&
        typeof error === 'object' &&
        (error as Record<string, unknown>).isAxiosError === true,
    );
    mockedJwt.sign.mockReturnValue('client-secret');
  });

  it('authorization code를 필요한 form 값으로 교환한다', async () => {
    mockedAxios.post.mockResolvedValue({
      status: HttpStatus.OK,
      data: {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
      },
    });

    await expect(
      client.exchangeAuthorizationCode('authorization-code'),
    ).resolves.toEqual({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
    });
    expect(mockedJwt.sign).toHaveBeenCalledWith({}, 'private-key', {
      algorithm: 'ES256',
      expiresIn: '5m',
      audience: 'https://appleid.apple.com',
      issuer: 'team-id',
      subject: 'client-id',
      keyid: 'key-id',
    });
    const requestBody = mockedAxios.post.mock.calls[0][1];
    expect(
      Object.fromEntries(new URLSearchParams(requestBody as string)),
    ).toEqual({
      client_id: 'client-id',
      client_secret: 'client-secret',
      code: 'authorization-code',
      grant_type: 'authorization_code',
    });
    expect(mockedAxios.post.mock.calls[0][0]).toBe(
      'https://appleid.apple.com/auth/token',
    );
  });

  it('authorization code 교환 실패를 인증 증명 오류로 변환한다', async () => {
    mockedAxios.post.mockRejectedValue(
      axiosError(HttpStatus.BAD_REQUEST, { error: 'invalid_grant' }),
    );

    await expect(
      client.exchangeAuthorizationCode('authorization-code'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'invalid-apple-proof',
        message: 'Apple authorization code 교환에 실패했습니다.',
      },
    });
  });

  it('client secret 생성 실패를 authorization code 오류로 변환하지 않는다', async () => {
    const error = new Error('client secret 생성 실패');
    mockedJwt.sign.mockImplementation(() => {
      throw error;
    });

    await expect(
      client.exchangeAuthorizationCode('authorization-code'),
    ).rejects.toBe(error);
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });

  it('Apple JWKS와 필수 claim으로 ID token payload를 반환한다', async () => {
    let signingKeyError: Error | null | undefined;
    let signingKey: jwt.Secret | jwt.PublicKey;
    mockedJwt.verify.mockImplementation((_token, key, _options, callback) => {
      if (typeof key !== 'function') {
        callback?.(new Error('공개키 조회 함수가 필요합니다.'));
        return;
      }
      key({ kid: 'key-id' }, (error, publicKey) => {
        signingKeyError = error;
        signingKey = publicKey;
        callback?.(null, appleTokenPayload({ nonce: 'hashed-nonce' }));
      });
    });

    await expect(
      client.verifyIdToken('id-token', 'hashed-nonce'),
    ).resolves.toMatchObject({
      iss: 'https://appleid.apple.com',
      aud: 'client-id',
      sub: 'apple-subject',
      nonce: 'hashed-nonce',
    });
    expect(signingKeyError).toBeNull();
    expect(signingKey).toBe('public-key');
    expect(mockedJwt.verify).toHaveBeenCalledWith(
      'id-token',
      expect.any(Function),
      {
        algorithms: ['RS256'],
        audience: 'client-id',
        issuer: 'https://appleid.apple.com',
      },
      expect.any(Function),
    );
  });

  it.each([
    ['issuer', { iss: 'https://invalid.example.com' }],
    ['audience', { aud: 'other-client-id' }],
    ['subject', { sub: '' }],
    ['issued-at', { iat: 'invalid' }],
    ['expiration', { exp: 'invalid' }],
    ['nonce', { nonce: 'other-nonce' }],
  ])('유효하지 않은 %s claim을 거부한다', async (_name, overrides) => {
    mockedJwt.verify.mockImplementation((_token, _key, _options, callback) => {
      callback?.(null, appleTokenPayload(overrides));
    });

    await expect(
      client.verifyIdToken('id-token', 'hashed-nonce'),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: { code: 'invalid-apple-proof' },
    });
  });

  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    [undefined, false],
  ])('email_verified %p를 %p로 해석한다', (value, expected) => {
    expect(
      isAppleEmailVerified(appleTokenPayload({ email_verified: value })),
    ).toBe(expected);
  });

  it('교환 결과의 필수 refresh token을 반환한다', async () => {
    await expect(
      client.requiredRefreshToken({ refreshToken: 'refresh-token' }),
    ).resolves.toBe('refresh-token');
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });

  it('필수 refresh token이 없으면 access token을 폐기하고 오류를 반환한다', async () => {
    mockedAxios.post.mockResolvedValue({ status: HttpStatus.OK });

    await expect(
      client.requiredRefreshToken({ accessToken: 'access-token' }),
    ).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { code: 'apple-credential-not-found' },
    });
    const requestBody = mockedAxios.post.mock.calls[0][1];
    expect(
      Object.fromEntries(new URLSearchParams(requestBody as string)),
    ).toMatchObject({
      token: 'access-token',
      token_type_hint: 'access_token',
    });
  });

  it('폐기할 token 없이 필수 refresh token이 없으면 오류만 반환한다', async () => {
    await expect(client.requiredRefreshToken({})).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
      response: { code: 'apple-credential-not-found' },
    });
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });

  it('교환 결과에서 refresh token을 우선 폐기한다', async () => {
    mockedAxios.post.mockResolvedValue({ status: HttpStatus.OK });

    await client.revokeExchangedTokens({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    });

    const requestBody = mockedAxios.post.mock.calls[0][1];
    expect(
      Object.fromEntries(new URLSearchParams(requestBody as string)),
    ).toMatchObject({
      token: 'refresh-token',
      token_type_hint: 'refresh_token',
    });
  });

  it('폐기할 token이 없으면 외부 요청을 생략한다', async () => {
    await expect(client.revokeExchangedTokens({})).resolves.toBeUndefined();
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });

  it.each(['invalid_grant', 'invalid_token'])(
    '이미 무효화된 %s 폐기 오류를 성공으로 처리한다',
    async (providerCode) => {
      mockedAxios.post.mockRejectedValue(
        axiosError(HttpStatus.BAD_REQUEST, { error: providerCode }),
      );

      await expect(
        client.revokeExchangedTokens({ refreshToken: 'refresh-token' }),
      ).resolves.toBeUndefined();
    },
  );

  it('Apple grant 폐기 실패를 계약 오류로 변환한다', async () => {
    mockedAxios.post.mockRejectedValue(
      axiosError(HttpStatus.INTERNAL_SERVER_ERROR, { error: 'server_error' }),
    );

    await expect(
      client.revokeExchangedTokens({ refreshToken: 'refresh-token' }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: {
        code: 'apple-revoke-failed',
        message: 'Apple grant 폐기에 실패했습니다.',
      },
    });
  });

  it('client secret 생성 실패를 Apple grant 폐기 오류로 변환하지 않는다', async () => {
    const error = new Error('client secret 생성 실패');
    mockedJwt.sign.mockImplementation(() => {
      throw error;
    });

    await expect(
      client.revokeExchangedTokens({ refreshToken: 'refresh-token' }),
    ).rejects.toBe(error);
    expect(mockedAxios.post.mock.calls).toHaveLength(0);
  });
});

// 검증된 Apple ID token payload 대역을 구성합니다.
function appleTokenPayload(
  overrides: Partial<Record<keyof AppleTokenPayload, unknown>> = {},
): AppleTokenPayload {
  return {
    iss: 'https://appleid.apple.com',
    sub: 'apple-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    email: 'user@example.com',
    email_verified: true,
    ...overrides,
  } as AppleTokenPayload;
}

// Axios 오류 대역을 구성합니다.
// prettier-ignore
function axiosError(
  status: number,
  data: unknown,
): AxiosError {
  return {
    name: 'AxiosError',
    message: `status ${status}`,
    isAxiosError: true,
    response: { status, data },
  } as AxiosError;
}
