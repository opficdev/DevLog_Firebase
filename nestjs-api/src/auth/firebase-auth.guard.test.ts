import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { FirebaseAuthenticatedRequest } from './firebase-authenticated-request';
import { FirebaseAuthGuard } from './firebase-auth.guard';

describe(FirebaseAuthGuard.name, () => {
  it.each([undefined, '', 'Basic token', 'Bearer   ', ['Bearer token']])(
    '유효한 Bearer token이 없는 %p 요청을 거부한다',
    async (authorization) => {
      const verifyIdToken = jest.fn();
      const auth = { verifyIdToken } as unknown as Auth;
      const request = {
        headers: { authorization },
      } as FirebaseAuthenticatedRequest;
      const context = {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext;
      const guard = new FirebaseAuthGuard(auth);

      await expect(guard.canActivate(context)).rejects.toMatchObject({
        status: HttpStatus.UNAUTHORIZED,
        response: {
          code: 'unauthenticated',
          message: '인증 토큰이 필요합니다.',
        },
      });
      expect(verifyIdToken).not.toHaveBeenCalled();
    },
  );

  it('검증된 token의 UID만 요청에 저장한다', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      uid: 'verified-uid',
      email: 'user@example.com',
    });
    const auth = { verifyIdToken } as unknown as Auth;
    const request = {
      headers: { authorization: 'Bearer firebase-id-token' },
    } as FirebaseAuthenticatedRequest;
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = new FirebaseAuthGuard(auth);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(verifyIdToken).toHaveBeenCalledWith('firebase-id-token');
    expect(request).toEqual({
      headers: { authorization: 'Bearer firebase-id-token' },
      uid: 'verified-uid',
    });
  });

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
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    const guard = new FirebaseAuthGuard(auth);

    await expect(guard.canActivate(context)).rejects.toBe(error);
    expect(request.uid).toBeUndefined();
  });
});
