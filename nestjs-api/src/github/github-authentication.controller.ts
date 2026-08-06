import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
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

  // 현재 사용자에 결합된 계정 연결 목적 GitHub OAuth session을 생성합니다.
  @Post('account-link-sessions')
  @HttpCode(HttpStatus.OK)
  async createAccountLinkSession(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<GitHubOAuthSessionResponse> {
    return this.service.createAccountLinkSession(
      requiredAuthenticatedUid(request),
      requiredBodyString(body, 'appChallenge'),
    );
  }

  // ticket으로 증명한 GitHub provider를 인증된 사용자에게 연결합니다.
  @Put('account-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async link(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<void> {
    await this.service.link(
      requiredAuthenticatedUid(request),
      requiredBodyString(body, 'ticket'),
      requiredBodyString(body, 'appVerifier'),
    );
  }

  // 인증된 사용자의 GitHub OAuth grant와 credential을 폐기합니다.
  @Delete('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() request: FirebaseAuthenticatedRequest): Promise<void> {
    await this.service.revoke(requiredAuthenticatedUid(request));
  }

  // GitHub callback 결과를 앱 callback 주소로 전달합니다.
  @Public()
  @Get('callback')
  @Redirect(undefined, HttpStatus.FOUND)
  async callback(
    @Query('state') state: unknown,
    @Query('code') code: unknown,
  ): Promise<{ url: string; statusCode: number }> {
    return {
      url: await this.service.callback(
        optionalQueryString(state),
        optionalQueryString(code),
      ),
      statusCode: HttpStatus.FOUND,
    };
  }

  // 로그인 ticket을 검증해 Firebase custom token을 반환합니다.
  @Public()
  @Post('custom-token')
  @HttpCode(HttpStatus.OK)
  async customToken(@Body() body: unknown): Promise<{ customToken: string }> {
    return {
      customToken: await this.service.customToken(
        requiredBodyString(body, 'ticket'),
        requiredBodyString(body, 'appVerifier'),
      ),
    };
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

// query parameter에서 하나의 선택 문자열을 공백을 제거해 반환합니다.
function optionalQueryString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
