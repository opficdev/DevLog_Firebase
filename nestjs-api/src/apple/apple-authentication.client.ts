// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import axios from 'axios';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

import { ApiException } from '../common/api.exception';
import { APPLE_AUTHENTICATION_CONFIGURATION_TOKEN } from './apple-authentication.configuration';
import {
  type AppleAuthenticationConfiguration,
  type AppleOAuthToken,
  type AppleTokenPayload,
} from './apple-authentication.types';

const appleIdentityIssuer = 'https://appleid.apple.com';
const appleTokenUrl = `${appleIdentityIssuer}/auth/token`;
const appleRevokeUrl = `${appleIdentityIssuer}/auth/revoke`;
const appleJwksClient = jwksClient({
  jwksUri: `${appleIdentityIssuer}/auth/keys`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 60 * 60 * 1000,
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

// Apple token 교환 응답입니다.
interface AppleOAuthResponse {
  // Apple API 요청과 grant 폐기에 사용할 access token을 저장합니다.
  access_token?: string;
  // 서버에 보관하고 grant 폐기에 사용할 refresh token을 저장합니다.
  refresh_token?: string;
  // 사용자 식별과 nonce 검증에 사용할 ID token을 저장합니다.
  id_token?: string;
}

// Apple OAuth 요청과 ID token 검증을 담당합니다.
@Injectable()
export class AppleAuthenticationClient {
  // Apple OAuth client 설정을 주입받습니다.
  constructor(
    @Inject(APPLE_AUTHENTICATION_CONFIGURATION_TOKEN)
    private readonly configuration: AppleAuthenticationConfiguration,
  ) {}

  // authorization code를 Apple OAuth token 묶음으로 교환합니다.
  async exchangeAuthorizationCode(
    authorizationCode: string,
  ): Promise<AppleOAuthToken> {
    const clientSecret = this.createClientSecret();
    try {
      const response = await axios.post<AppleOAuthResponse>(
        appleTokenUrl,
        new URLSearchParams({
          client_id: this.configuration.clientId,
          client_secret: clientSecret,
          code: authorizationCode,
          grant_type: 'authorization_code',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
        idToken: response.data.id_token,
      };
    } catch {
      throw appleCodeExchangeException;
    }
  }

  // Apple refresh token을 새 access token으로 교환합니다.
  async requestAccessToken(refreshToken: string): Promise<string> {
    const clientSecret = this.createClientSecret();
    let response;
    try {
      response = await axios.post<AppleOAuthResponse>(
        appleTokenUrl,
        new URLSearchParams({
          client_id: this.configuration.clientId,
          client_secret: clientSecret,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
    } catch (error) {
      if (appleErrorCode(error) === 'invalid_grant') {
        throw invalidAppleRefreshTokenException;
      }
      throw appleAccessTokenRequestException;
    }

    if (!response.data.access_token) {
      throw missingAppleAccessTokenException;
    }
    return response.data.access_token;
  }

  // Apple 공개키와 필수 claim으로 ID token을 검증합니다.
  async verifyIdToken(
    idToken: string,
    expectedHashedNonce?: string,
  ): Promise<AppleTokenPayload> {
    try {
      return await verifyAppleIdToken(
        idToken,
        this.configuration.clientId,
        expectedHashedNonce,
      );
    } catch {
      throw invalidAppleProofException;
    }
  }

  // code 교환 응답에서 필수 refresh token을 반환합니다.
  async requiredRefreshToken(tokens: AppleOAuthToken): Promise<string> {
    if (tokens.refreshToken) {
      return tokens.refreshToken;
    }

    await this.revokeExchangedTokens(tokens);
    throw appleCredentialNotFoundException;
  }

  // code 교환 응답의 credential을 보상 폐기합니다.
  async revokeExchangedTokens(tokens: AppleOAuthToken): Promise<void> {
    const token = tokens.refreshToken ?? tokens.accessToken;
    if (!token) {
      return;
    }

    await this.revokeAppleGrant(
      token,
      tokens.refreshToken ? 'refresh_token' : 'access_token',
    );
  }

  // Apple grant를 폐기하고 이미 무효화된 상태는 완료로 처리합니다.
  async revokeAppleGrant(
    token: string,
    tokenTypeHint: 'access_token' | 'refresh_token',
  ): Promise<void> {
    const clientSecret = this.createClientSecret();
    try {
      await axios.post(
        appleRevokeUrl,
        new URLSearchParams({
          client_id: this.configuration.clientId,
          client_secret: clientSecret,
          token,
          token_type_hint: tokenTypeHint,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        },
      );
    } catch (error) {
      if (isAppleGrantAlreadyRevoked(error)) {
        return;
      }
      throw appleRevokeException;
    }
  }

  // Apple OAuth 요청에 사용할 client secret JWT를 생성합니다.
  private createClientSecret(): string {
    return jwt.sign({}, this.configuration.privateKey, {
      algorithm: 'ES256',
      expiresIn: '5m',
      audience: appleIdentityIssuer,
      issuer: this.configuration.teamId,
      subject: this.configuration.clientId,
      keyid: this.configuration.keyId,
    });
  }
}

// Apple ID token의 이메일 인증 여부 claim을 boolean 값으로 변환합니다.
export function isAppleEmailVerified(payload: AppleTokenPayload): boolean {
  return payload.email_verified === true || payload.email_verified === 'true';
}

// ID token header의 key id로 Apple 공개키를 조회합니다.
function getApplePublicKey(
  header: jwt.JwtHeader | undefined,
  callback: jwt.SigningKeyCallback,
): void {
  if (!header?.kid) {
    callback(new Error('Apple ID token header is missing key id'));
    return;
  }

  appleJwksClient
    .getSigningKey(header.kid)
    .then((key) => callback(null, key.getPublicKey()))
    .catch((error: unknown) => callback(error as Error));
}

// 검증된 JWT payload가 필요한 Apple ID token claim을 포함하는지 확인합니다.
function isAppleTokenPayload(
  payload: unknown,
  clientId: string,
  expectedHashedNonce?: string,
): payload is AppleTokenPayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const record = payload as Record<string, unknown>;
  return (
    record.iss === appleIdentityIssuer &&
    record.aud === clientId &&
    typeof record.sub === 'string' &&
    0 < record.sub.length &&
    typeof record.iat === 'number' &&
    typeof record.exp === 'number' &&
    (!expectedHashedNonce || record.nonce === expectedHashedNonce)
  );
}

// Apple JWKS와 필수 claim으로 ID token을 검증합니다.
function verifyAppleIdToken(
  idToken: string,
  clientId: string,
  expectedHashedNonce?: string,
): Promise<AppleTokenPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      idToken,
      getApplePublicKey,
      {
        algorithms: ['RS256'],
        audience: clientId,
        issuer: appleIdentityIssuer,
      },
      (error, decoded) => {
        if (error) {
          reject(error);
          return;
        }
        const decodedPayload = decoded as unknown;
        if (
          !decodedPayload ||
          typeof decodedPayload === 'string' ||
          !isAppleTokenPayload(decodedPayload, clientId, expectedHashedNonce)
        ) {
          reject(new Error('Invalid Apple ID token payload'));
          return;
        }
        resolve(decodedPayload);
      },
    );
  });
}

// Apple API 오류가 이미 무효화된 grant를 나타내는지 확인합니다.
function isAppleGrantAlreadyRevoked(error: unknown): boolean {
  const code = appleErrorCode(error);
  return code === 'invalid_grant' || code === 'invalid_token';
}

// Apple API 오류 응답에서 구분 코드를 추출합니다.
function appleErrorCode(error: unknown): string | undefined {
  if (!axios.isAxiosError(error)) {
    return undefined;
  }
  const data = error.response?.data as unknown;
  if (!data || typeof data !== 'object') {
    return undefined;
  }
  const code = (data as Record<string, unknown>).error;
  return typeof code === 'string' ? code : undefined;
}

const appleCodeExchangeException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'invalid-apple-proof',
  'Apple authorization code 교환에 실패했습니다.',
);
const invalidAppleRefreshTokenException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'unauthenticated',
  'Apple refresh token이 만료되었거나 유효하지 않습니다.',
);
const appleAccessTokenRequestException = new ApiException(
  HttpStatus.INTERNAL_SERVER_ERROR,
  'internal',
  'Apple access token 발급에 실패했습니다.',
);
const missingAppleAccessTokenException = new ApiException(
  HttpStatus.INTERNAL_SERVER_ERROR,
  'internal',
  'Apple 응답에 access token이 없습니다.',
);
const invalidAppleProofException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'invalid-apple-proof',
  'Apple ID token 검증에 실패했습니다.',
);
const appleCredentialNotFoundException = new ApiException(
  HttpStatus.NOT_FOUND,
  'apple-credential-not-found',
  'Apple 교환 응답에 refresh token이 없습니다.',
);
const appleRevokeException = new ApiException(
  HttpStatus.BAD_GATEWAY,
  'apple-revoke-failed',
  'Apple grant 폐기에 실패했습니다.',
);
