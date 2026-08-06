// prettier-ignore
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { ApiException } from '../common/api.exception';
import { AppleAuthenticationService } from './apple-authentication.service';
import { type AppleChallengeResponse } from './apple-challenge.repository';

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
}

// 요청 body를 문자열 필드 조회가 가능한 객체로 변환합니다.
function bodyRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }
  return body as Record<string, unknown>;
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
