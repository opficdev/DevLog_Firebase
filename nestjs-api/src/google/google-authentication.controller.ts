import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

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
    const serverAuthCode =
      body && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>).serverAuthCode
        : undefined;
    if (typeof serverAuthCode !== 'string' || !serverAuthCode.trim()) {
      throw missingServerAuthCodeException;
    }

    return {
      customToken: await this.service.customToken(serverAuthCode.trim()),
    };
  }
}
