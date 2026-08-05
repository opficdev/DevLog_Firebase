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
import { GoogleAuthenticationService } from './google-authentication.service';

// 필수 serverAuthCode가 없는 요청 오류입니다.
const missingServerAuthCodeException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-argument',
  'serverAuthCode가 필요합니다.',
);

// Google 인증 HTTP 요청과 응답 경계를 제공합니다.
@Controller('auth/google')
export class GoogleAuthenticationController {
  // Google 인증 업무 규칙을 제공하는 의존성을 주입받습니다.
  constructor(private readonly service: GoogleAuthenticationService) {}

  // serverAuthCode를 검증해 Firebase custom token을 반환합니다.
  @Public()
  @Post('authorization-code/custom-token')
  @HttpCode(HttpStatus.OK)
  async customToken(@Body() body: unknown): Promise<{ customToken: string }> {
    let serverAuthCode: unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      serverAuthCode = (body as Record<string, unknown>).serverAuthCode;
    }
    if (typeof serverAuthCode !== 'string' || !serverAuthCode.trim()) {
      throw missingServerAuthCodeException;
    }

    return {
      customToken: await this.service.customToken(serverAuthCode.trim()),
    };
  }

  // serverAuthCode를 검증해 인증된 사용자의 Google 계정을 연결합니다.
  @Put('authorization-code/account-link')
  @HttpCode(HttpStatus.NO_CONTENT)
  async link(
    @Req() request: FirebaseAuthenticatedRequest,
    @Body() body: unknown,
  ): Promise<void> {
    const uid = request.uid;
    if (!uid) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'unauthenticated',
        '인증된 사용자가 아닙니다.',
      );
    }

    let serverAuthCode: unknown;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      serverAuthCode = (body as Record<string, unknown>).serverAuthCode;
    }
    if (typeof serverAuthCode !== 'string' || !serverAuthCode.trim()) {
      throw missingServerAuthCodeException;
    }

    await this.service.link(uid, serverAuthCode.trim());
  }

  // 인증된 사용자의 Google grant와 credential을 폐기합니다.
  @Delete('access-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Req() request: FirebaseAuthenticatedRequest): Promise<void> {
    const uid = request.uid;
    if (!uid) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'unauthenticated',
        '인증된 사용자가 아닙니다.',
      );
    }

    await this.service.revoke(uid);
  }
}
