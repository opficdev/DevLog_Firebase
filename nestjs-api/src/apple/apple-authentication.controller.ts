// prettier-ignore
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Req,
} from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { Public } from '../auth/public.decorator';
import { ApiException } from '../common/api.exception';
import { AppleAuthenticationService } from './apple-authentication.service';
import { type AppleChallengeResponse } from './apple-challenge.repository';

// JSON 요청 body 형식이 올바르지 않을 때 반환할 오류입니다.
const invalidJsonBodyException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-argument',
  'JSON body 형식이 올바르지 않습니다.',
);

// Apple 로그인 HTTP 요청과 응답 경계를 제공합니다.
@Controller('auth/apple')
export class AppleAuthenticationController {
  // Apple 로그인 업무 규칙을 제공하는 의존성을 주입받습니다.
  constructor(private readonly service: AppleAuthenticationService) {}

  // 새 Apple 인증 challenge를 반환합니다.
  @Public()
  @Post('challenges')
  @HttpCode(HttpStatus.OK)
  async createChallenge(): Promise<AppleChallengeResponse> {
    return this.service.createChallenge();
  }

  // challenge 또는 기존 ID token 요청으로 Firebase custom token을 반환합니다.
  @Public()
  @Post('custom-token')
  @HttpCode(HttpStatus.OK)
  async customToken(@Body() body: unknown): Promise<{ customToken: string }> {
    const request = bodyRecord(body);
    if ('challengeId' in request) {
      return {
        customToken: await this.service.requestCustomTokenWithChallenge(
          requiredBodyString(request, 'challengeId'),
          requiredBodyString(request, 'authorizationCode'),
          optionalBodyString(request, 'displayName'),
        ),
      };
    }

    return {
      customToken: await this.service.requestCustomTokenWithIdToken(
        requiredBodyString(request, 'idToken'),
        requiredBodyString(request, 'authorizationCode'),
      ),
    };
  }

  // challenge로 증명한 Apple provider를 인증된 사용자에게 연결합니다.
  @Put('account-link')
  @HttpCode(HttpStatus.OK)
  async link(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ success: true }> {
    const uid = requiredAuthenticatedUid(request);
    const value = bodyRecord(body);
    await this.service.linkProvider(
      uid,
      requiredBodyString(value, 'challengeId'),
      requiredBodyString(value, 'authorizationCode'),
      optionalBodyString(value, 'credentialEmail'),
    );
    return { success: true };
  }

  // authorization code로 Apple refresh token을 저장하고 반환합니다.
  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ success: true; refreshToken: string }> {
    const uid = requiredAuthenticatedUid(request);
    const value = bodyRecord(body);
    const refreshToken = await this.service.requestRefreshToken(
      uid,
      requiredBodyString(value, 'authorizationCode'),
    );
    return { success: true, refreshToken };
  }

  // 저장된 Apple credential로 발급한 access token을 반환합니다.
  @Post('access-token')
  @HttpCode(HttpStatus.OK)
  async accessToken(
    @Req() request: FirebaseAuthenticatedRequest,
  ): Promise<{ token: string }> {
    return {
      token: await this.service.refreshAccessToken(
        requiredAuthenticatedUid(request),
      ),
    };
  }

  // 인증된 사용자의 Apple grant와 credential을 폐기합니다.
  @Delete('access-token')
  @HttpCode(HttpStatus.OK)
  async revokeAccessToken(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<{ success: true }> {
    const value = bodyRecord(body);
    await this.service.revokeAccessToken(
      requiredAuthenticatedUid(request),
      value.token,
    );
    return { success: true };
  }

  // 인증된 사용자의 Apple provider 연결을 해제합니다.
  @Delete('account-link')
  @HttpCode(HttpStatus.OK)
  async unlink(
    @Req() request: FirebaseAuthenticatedRequest,
  ): Promise<{ success: true }> {
    await this.service.unlinkProvider(requiredAuthenticatedUid(request));
    return { success: true };
  }
}

// 인증 경계에서 검증한 사용자 식별자를 반환합니다.
function requiredAuthenticatedUid(
  request: FirebaseAuthenticatedRequest,
): string {
  if (!request.uid) {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      'unauthenticated',
      '인증된 사용자가 아닙니다.',
    );
  }
  return request.uid;
}

// 요청 body를 문자열 필드 조회가 가능한 객체로 변환합니다.
function bodyRecord(body: unknown): Record<string, unknown> {
  if (Buffer.isBuffer(body)) {
    return jsonBodyRecord(body.toString('utf8'));
  }
  if (typeof body === 'string') {
    return jsonBodyRecord(body);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
}

// 문자열 JSON body를 문자열 필드 조회가 가능한 객체로 변환합니다.
function jsonBodyRecord(body: string): Record<string, unknown> {
  if (!body) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw invalidJsonBodyException;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  return parsed as Record<string, unknown>;
}

// 요청 body의 필수 문자열을 공백을 제거해 반환합니다.
// prettier-ignore
function requiredBodyString(
  body: Record<string, unknown>,
  key: string,
): string {
  const value = body[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-argument',
      `${key}가 필요합니다.`,
    );
  }
  return value.trim();
}

// 요청 body의 선택 문자열을 공백을 제거해 반환합니다.
// prettier-ignore
function optionalBodyString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-argument',
      `${key} 형식이 올바르지 않습니다.`,
    );
  }

  return value.trim() || undefined;
}
