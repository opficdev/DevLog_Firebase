import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import jwksClient, { SigningKeyNotFoundError } from 'jwks-rsa';

import { ApiException } from '../common/api.exception';
import { GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN } from './google-authentication.configuration';
import {
  type GoogleAuthenticationConfiguration,
  type GoogleOAuthToken,
  type GoogleTokenPayload,
} from './google-authentication.types';

const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const googleRevokeUrl = 'https://oauth2.googleapis.com/revoke';
const googleIdentityIssuers: [string, ...string[]] = [
  'https://accounts.google.com',
  'accounts.google.com',
];
const googleJwksClient = jwksClient({
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 60 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

// Google authorization code 교환 응답입니다.
interface GoogleOAuthResponse {
  // 발급된 사용자 access token을 저장합니다.
  access_token?: string;

  // 검증할 OpenID Connect ID token을 저장합니다.
  id_token?: string;

  // 장기 grant 폐기에 사용할 refresh token을 저장합니다.
  refresh_token?: string;
}

// Google JWKS 통신·응답 실패를 token 검증 실패와 구분합니다.
export class GoogleJwksLookupError extends Error {}

// Google OAuth 요청과 ID token 검증을 담당합니다.
@Injectable()
export class GoogleAuthenticationClient {
  // Google 외부 요청 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GoogleAuthenticationClient.name);

  // Google OAuth client 설정을 주입받습니다.
  constructor(
    @Inject(GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN)
    private readonly configuration: GoogleAuthenticationConfiguration,
  ) {}

  // serverAuthCode를 Google OAuth token 묶음으로 교환합니다.
  async exchangeAuthorizationCode(
    serverAuthCode: string,
  ): Promise<GoogleOAuthToken> {
    const requestBody = new URLSearchParams({
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      code: serverAuthCode,
      redirect_uri: '',
      grant_type: 'authorization_code',
    });
    const response = await this.requestGoogleApi(() =>
      axios.post<GoogleOAuthResponse>(googleTokenUrl, requestBody, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    const accessToken = response.data.access_token;
    const idToken = response.data.id_token;
    if (!accessToken || !idToken) {
      throw googleProviderException;
    }
    return {
      accessToken,
      idToken,
      refreshToken: response.data.refresh_token,
    };
  }

  // Google 공개키와 필수 claim으로 ID token을 검증합니다.
  async verifyIdToken(idToken: string): Promise<GoogleTokenPayload> {
    try {
      return await verifyGoogleIdToken(idToken, this.configuration.clientId);
    } catch (error) {
      if (error instanceof GoogleJwksLookupError) {
        throw googleProviderException;
      }
      throw invalidGoogleProofException;
    }
  }

  // Google grant를 폐기하고 이미 폐기된 token은 성공으로 처리합니다.
  async revokeOAuthToken(uid: string, token: string): Promise<void> {
    try {
      const response = await axios.post(
        googleRevokeUrl,
        new URLSearchParams({ token }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      if (response.status === Number(HttpStatus.OK)) {
        return;
      }
    } catch (error) {
      if (alreadyInvalidToken(error)) {
        this.logger.warn({
          message: 'Google OAuth token이 이미 무효화되어 성공으로 처리합니다.',
          uid,
          google: errorMetadata(error),
        });
        return;
      }
      this.logger.error({
        message: 'Google OAuth grant 폐기에 실패했습니다.',
        ...errorMetadata(error),
      });
      throw googleRevocationException;
    }
    this.logger.error({
      message: 'Google OAuth grant 폐기에 실패했습니다.',
      errorMessage: 'Google OAuth token 폐기 응답이 올바르지 않습니다.',
    });
    throw googleRevocationException;
  }

  // Google token endpoint 오류를 계약 오류로 변환합니다.
  private async requestGoogleApi<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      if (invalidGoogleGrant(error)) {
        throw invalidGoogleProofException;
      }
      this.logger.error({
        message: 'Google 인증 서버 요청에 실패했습니다.',
        ...errorMetadata(error),
      });
      throw googleProviderException;
    }
  }
}

// ID token header의 key id로 Google 공개키를 조회합니다.
function getGooglePublicKey(
  header: jwt.JwtHeader | undefined,
  callback: jwt.SigningKeyCallback,
): void {
  if (!header?.kid) {
    callback(new Error('Google ID token header is missing key id'));
    return;
  }
  googleJwksClient
    .getSigningKey(header.kid)
    .then((key) => callback(null, key.getPublicKey()))
    .catch((error: unknown) =>
      callback(
        error instanceof SigningKeyNotFoundError
          ? error
          : new GoogleJwksLookupError('Google JWKS lookup failed'),
      ),
    );
}

// 검증된 JWT payload가 필요한 Google ID token claim을 포함하는지 확인합니다.
function isGoogleTokenPayload(
  payload: unknown,
  clientId: string,
): payload is GoogleTokenPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    typeof record.iss === 'string' &&
    googleIdentityIssuers.includes(record.iss) &&
    record.aud === clientId &&
    typeof record.sub === 'string' &&
    0 < record.sub.length &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number'
  );
}

// Google JWKS와 필수 claim으로 ID token을 검증합니다.
function verifyGoogleIdToken(
  idToken: string,
  clientId: string,
): Promise<GoogleTokenPayload> {
  return new Promise((resolve, reject) => {
    let publicKeyError: Error | null = null;
    jwt.verify(
      idToken,
      (header, callback) =>
        getGooglePublicKey(header, (error, publicKey) => {
          publicKeyError = error;
          callback(error, publicKey);
        }),
      {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: googleIdentityIssuers,
      },
      (error, decoded) => {
        if (error) {
          reject(
            publicKeyError ?? new Error('Google ID token verification failed'),
          );
          return;
        }
        const decodedPayload = decoded as unknown;
        if (
          !decodedPayload ||
          typeof decodedPayload === 'string' ||
          !isGoogleTokenPayload(decodedPayload, clientId)
        ) {
          reject(new Error('Invalid Google ID token payload'));
          return;
        }
        resolve(decodedPayload);
      },
    );
  });
}

// Google revoke 오류가 이미 무효화된 token을 의미하는지 확인합니다.
function alreadyInvalidToken(error: unknown): boolean {
  if (!axios.isAxiosError(error) || error.response?.status !== 400) {
    return false;
  }
  const data = error.response.data as unknown;
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).error === 'invalid_token'
  );
}

// Google token endpoint 오류가 유효하지 않은 authorization code인지 확인합니다.
function invalidGoogleGrant(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }
  const data = error.response?.data as unknown;
  return (
    !!data &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).error === 'invalid_grant'
  );
}

// 외부 요청 오류에서 비밀값을 제외한 상태와 문구를 반환합니다.
function errorMetadata(error: unknown): Record<string, unknown> {
  if (axios.isAxiosError(error)) {
    const responseData = error.response?.data as unknown;
    const providerError =
      responseData && typeof responseData === 'object'
        ? (responseData as Record<string, unknown>).error
        : undefined;
    return {
      status: error.response?.status,
      errorMessage: error.message,
      error: typeof providerError === 'string' ? providerError : undefined,
    };
  }
  return {
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
  };
}

// 유효하지 않은 Google 인증 증명 오류입니다.
const invalidGoogleProofException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'invalid-google-proof',
  'Google 인증 증명이 유효하지 않습니다.',
);

// Google 인증 서버 실패 오류입니다.
const googleProviderException = new ApiException(
  HttpStatus.BAD_GATEWAY,
  'google-provider-failed',
  'Google 인증 서버 요청에 실패했습니다.',
);

// Google grant 폐기 실패 오류입니다.
const googleRevocationException = new ApiException(
  HttpStatus.BAD_GATEWAY,
  'google-revoke-failed',
  'Google grant 폐기에 실패했습니다.',
);
