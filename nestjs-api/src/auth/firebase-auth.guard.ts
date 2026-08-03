import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { FirebaseAuthenticatedRequest } from './firebase-authenticated-request';

const bearerPrefix = 'Bearer ';

/** 모든 HTTP 요청의 Firebase ID Token을 검증하는 전역 인증 경계입니다. */
@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  /** Firebase Auth 검증 의존성을 주입받습니다. */
  constructor(@Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth) {}

  /** Bearer token을 검증하고 확인된 UID만 요청에 저장합니다. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<FirebaseAuthenticatedRequest>();
    const token = authenticationTokenFrom(request);
    const decodedToken = await this.auth.verifyIdToken(token);

    request.uid = decodedToken.uid;
    return true;
  }
}

/** Authorization header에서 비어 있지 않은 Bearer token을 반환합니다. */
function authenticationTokenFrom(
  request: FirebaseAuthenticatedRequest,
): string {
  const authorization = request.headers.authorization;
  if (
    typeof authorization !== 'string' ||
    !authorization.startsWith(bearerPrefix)
  ) {
    throw missingAuthenticationTokenException();
  }

  const token = authorization.slice(bearerPrefix.length).trim();
  if (!token) {
    throw missingAuthenticationTokenException();
  }

  return token;
}

/** 인증 token이 없는 요청에 사용할 공통 예외를 생성합니다. */
function missingAuthenticationTokenException(): ApiException {
  return new ApiException(
    HttpStatus.UNAUTHORIZED,
    'unauthenticated',
    '인증 토큰이 필요합니다.',
  );
}
