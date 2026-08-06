import { HttpStatus } from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { GitHubAuthenticationController } from './github-authentication.controller';
import { GitHubAuthenticationService } from './github-authentication.service';

describe(GitHubAuthenticationController.name, () => {
  const createSignInSession = jest.fn();
  const createAccountLinkSession = jest.fn();
  const controller = new GitHubAuthenticationController({
    createSignInSession,
    createAccountLinkSession,
  } as unknown as GitHubAuthenticationService);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('공백을 제거한 appChallenge로 로그인 session을 생성한다', async () => {
    createSignInSession.mockResolvedValue({ authorizationURL: 'https://url' });

    await expect(
      controller.createSignInSession({ appChallenge: ' challenge ' }),
    ).resolves.toEqual({ authorizationURL: 'https://url' });
    expect(createSignInSession).toHaveBeenCalledWith('challenge');
  });

  it.each([
    undefined,
    null,
    1,
    'challenge',
    [],
    {},
    { appChallenge: 1 },
    { appChallenge: ' ' },
  ])('유효하지 않은 body %p를 거부한다', async (body) => {
    await expect(controller.createSignInSession(body)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'appChallenge가 필요합니다.',
      },
    });
    expect(createSignInSession).not.toHaveBeenCalled();
  });

  it('검증된 UID와 appChallenge로 계정 연결 session을 생성한다', async () => {
    createAccountLinkSession.mockResolvedValue({
      authorizationURL: 'https://url',
    });
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(
      controller.createAccountLinkSession(request, {
        appChallenge: ' challenge ',
      }),
    ).resolves.toEqual({ authorizationURL: 'https://url' });
    expect(createAccountLinkSession).toHaveBeenCalledWith(
      'user-1',
      'challenge',
    );
  });

  it('계정 연결 session 요청에 검증된 UID가 없으면 거부한다', async () => {
    await expect(
      controller.createAccountLinkSession({} as FirebaseAuthenticatedRequest, {
        appChallenge: 'challenge',
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'unauthenticated',
        message: '인증된 사용자가 아닙니다.',
      },
    });
    expect(createAccountLinkSession).not.toHaveBeenCalled();
  });

  it('계정 연결 session 요청에 appChallenge가 없으면 거부한다', async () => {
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(
      controller.createAccountLinkSession(request, { appChallenge: ' ' }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'invalid-argument' },
    });
    expect(createAccountLinkSession).not.toHaveBeenCalled();
  });
});
