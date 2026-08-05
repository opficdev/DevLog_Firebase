import { HttpStatus } from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { GoogleAuthenticationController } from './google-authentication.controller';
import { GoogleAuthenticationService } from './google-authentication.service';

describe(GoogleAuthenticationController.name, () => {
  const customToken = jest.fn();
  const link = jest.fn();
  const revoke = jest.fn();
  const controller = new GoogleAuthenticationController({
    customToken,
    link,
    revoke,
  } as unknown as GoogleAuthenticationService);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('공백을 제거한 serverAuthCode로 custom token을 요청한다', async () => {
    customToken.mockResolvedValue('custom-token');

    await expect(
      controller.customToken({ serverAuthCode: ' server-auth-code ' }),
    ).resolves.toEqual({ customToken: 'custom-token' });
    expect(customToken).toHaveBeenCalledWith('server-auth-code');
  });

  it.each([
    undefined,
    null,
    1,
    'server-auth-code',
    {},
    { serverAuthCode: 1 },
    { serverAuthCode: ' ' },
  ])('유효하지 않은 body %p를 거부한다', async (body) => {
    await expect(controller.customToken(body)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'serverAuthCode가 필요합니다.',
      },
    });
    expect(customToken).not.toHaveBeenCalled();
  });

  it('검증된 UID와 공백을 제거한 serverAuthCode로 계정을 연결한다', async () => {
    link.mockResolvedValue(undefined);
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(
      controller.link(request, { serverAuthCode: ' server-auth-code ' }),
    ).resolves.toBeUndefined();
    expect(link).toHaveBeenCalledWith('user-1', 'server-auth-code');
  });

  it('검증된 UID가 없으면 unauthenticated로 거부한다', async () => {
    await expect(
      controller.link({} as FirebaseAuthenticatedRequest, {
        serverAuthCode: 'server-auth-code',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'unauthenticated',
        message: '인증된 사용자가 아닙니다.',
      },
    });
    expect(link).not.toHaveBeenCalled();
  });

  it('계정 연결에 유효한 serverAuthCode가 없으면 거부한다', async () => {
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(
      controller.link(request, { serverAuthCode: ' ' }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'serverAuthCode가 필요합니다.',
      },
    });
    expect(link).not.toHaveBeenCalled();
  });

  it('검증된 UID의 Google grant와 credential을 폐기한다', async () => {
    revoke.mockResolvedValue(undefined);
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(controller.revoke(request)).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('user-1');
  });

  it('폐기 요청에 검증된 UID가 없으면 unauthenticated로 거부한다', async () => {
    await expect(
      controller.revoke({} as FirebaseAuthenticatedRequest),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'unauthenticated',
        message: '인증된 사용자가 아닙니다.',
      },
    });
    expect(revoke).not.toHaveBeenCalled();
  });
});
