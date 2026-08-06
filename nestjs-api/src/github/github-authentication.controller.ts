import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Public } from '../auth/public.decorator';
import { ApiException } from '../common/api.exception';
import { GitHubAuthenticationService } from './github-authentication.service';
import { type GitHubOAuthSessionResponse } from './github-authentication.types';

// GitHub 인증 HTTP 요청과 응답 경계를 제공합니다.
@Controller('auth/github')
export class GitHubAuthenticationController {
  // GitHub 인증 업무 규칙을 제공하는 의존성을 주입받습니다.
  constructor(private readonly service: GitHubAuthenticationService) {}

  // 로그인 목적 GitHub OAuth session을 생성합니다.
  @Public()
  @Post('sign-in-sessions')
  @HttpCode(HttpStatus.OK)
  async createSignInSession(
    @Body() body: unknown,
  ): Promise<GitHubOAuthSessionResponse> {
    return this.service.createSignInSession(
      requiredBodyString(body, 'appChallenge'),
    );
  }
}

// 요청 body의 필수 문자열을 공백을 제거해 반환합니다.
function requiredBodyString(body: unknown, key: string): string {
  let value: unknown;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    value = (body as Record<string, unknown>)[key];
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-argument',
      `${key}가 필요합니다.`,
    );
  }
  return value.trim();
}
