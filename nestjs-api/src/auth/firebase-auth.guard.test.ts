import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Auth } from 'firebase-admin/auth';

import { FirebaseAuthenticatedRequest } from './firebase-authenticated-request';
import { FirebaseAuthGuard } from './firebase-auth.guard';
import { Public } from './public.decorator';

// Guard 공개 인증 경계 시험용 Controller입니다.
class AuthenticationTestController {
  // 공개 인증 경계 시험 method입니다.
  @Public()
  publicEndpoint(this: void): void {}

  // 인증 필수 경계 시험 method입니다.
  authenticatedEndpoint(this: void): void {}
}

describe(FirebaseAuthGuard.name, () => {
  it.each([
    undefined,
    '',
    'Basic token',
    'Bearer   ',
    'bearer   ',
    ['Bearer token'],
  ])('유효한 Bearer token이 없는 %p 요청을 거부한다', async (authorization) => {
    const verifyIdToken = jest.fn();
    const auth = { verifyIdToken } as unknown as Auth;
    const request = {
      headers: { authorization },
    } as FirebaseAuthenticatedRequest;
    const context = {
      getHandler: () =>
        AuthenticationTestController.prototype.authenticatedEndpoint,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = new FirebaseAuthGuard(auth, new Reflector());

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      },
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it.each(['Bearer', 'bearer', 'BEARER', 'bEaReR'])(
    '%s scheme의 token을 검증하고 UID만 요청에 저장한다',
    async (scheme) => {
      const verifyIdToken = jest.fn().mockResolvedValue({
        uid: 'verified-uid',
        email: 'user@example.com',
      });
      const auth = { verifyIdToken } as unknown as Auth;
      const request = {
        headers: { authorization: `${scheme} Firebase-ID-Token` },
      } as FirebaseAuthenticatedRequest;
      const context = {
        getHandler: () =>
          AuthenticationTestController.prototype.authenticatedEndpoint,
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;
      const guard = new FirebaseAuthGuard(auth, new Reflector());

      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
      expect(request).toEqual({
        headers: { authorization: `${scheme} Firebase-ID-Token` },
        uid: 'verified-uid',
      });
    },
  );

  it('Firebase Auth 검증 오류를 공통 오류 처리로 전달한다', async () => {
    const error = {
      code: 'auth/id-token-expired',
      message: 'Firebase ID token has expired.',
    };
    const verifyIdToken = jest.fn().mockRejectedValue(error);
    const auth = { verifyIdToken } as unknown as Auth;
    const request = {
      headers: { authorization: 'Bearer expired-token' },
    } as FirebaseAuthenticatedRequest;
    const context = {
      getHandler: () =>
        AuthenticationTestController.prototype.authenticatedEndpoint,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = new FirebaseAuthGuard(auth, new Reflector());

    await expect(guard.canActivate(context)).rejects.toBe(error);
    expect(request.uid).toBeUndefined();
  });

  it('공개 method는 Firebase ID token 검증을 생략한다', async () => {
    const verifyIdToken = jest.fn();
    const auth = { verifyIdToken } as unknown as Auth;
    const request = { headers: {} } as FirebaseAuthenticatedRequest;
    const context = {
      getHandler: () => AuthenticationTestController.prototype.publicEndpoint,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = new FirebaseAuthGuard(auth, new Reflector());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(request.uid).toBeUndefined();
  });
});
