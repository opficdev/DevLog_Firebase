import { HttpStatus } from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { GitHubAuthenticationController } from './github-authentication.controller';
import { GitHubAuthenticationService } from './github-authentication.service';

describe(GitHubAuthenticationController.name, () => {
  const createSignInSession = jest.fn();
  const createAccountLinkSession = jest.fn();
  const callback = jest.fn();
  const customToken = jest.fn();
  const link = jest.fn();
  const revoke = jest.fn();
  const controller = new GitHubAuthenticationController({
    createSignInSession,
    createAccountLinkSession,
    callback,
    customToken,
    link,
    revoke,
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

  it('공백을 제거한 callback query로 앱 redirect 정보를 반환한다', async () => {
    callback.mockResolvedValue('devlog://oauth-callback?ticket=ticket-1');

    await expect(controller.callback(' state-1 ', ' code-1 ')).resolves.toEqual(
      {
        url: 'devlog://oauth-callback?ticket=ticket-1',
        statusCode: HttpStatus.FOUND,
      },
    );
    expect(callback).toHaveBeenCalledWith('state-1', 'code-1');
  });

  it('문자열이 아닌 callback query를 전달하지 않는다', async () => {
    callback.mockResolvedValue('devlog://oauth-callback?error=oauth-failed');

    await controller.callback(['state'], undefined);

    expect(callback).toHaveBeenCalledWith(undefined, undefined);
  });

  it('공백을 제거한 ticket과 appVerifier로 custom token을 요청한다', async () => {
    customToken.mockResolvedValue('custom-token');

    await expect(
      controller.customToken({
        ticket: ' ticket-1 ',
        appVerifier: ' app-verifier ',
      }),
    ).resolves.toEqual({ customToken: 'custom-token' });
    expect(customToken).toHaveBeenCalledWith('ticket-1', 'app-verifier');
  });

  it.each([
    [{ appVerifier: 'app-verifier' }, 'ticket'],
    [{ ticket: 'ticket-1' }, 'appVerifier'],
    [{ ticket: ' ', appVerifier: 'app-verifier' }, 'ticket'],
    [{ ticket: 'ticket-1', appVerifier: 1 }, 'appVerifier'],
  ])('필수 %s 값이 없는 custom token 요청을 거부한다', async (body, key) => {
    await expect(controller.customToken(body)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: `${key}가 필요합니다.`,
      },
    });
    expect(customToken).not.toHaveBeenCalled();
  });

  it('검증된 UID와 ticket으로 GitHub 계정을 연결한다', async () => {
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(
      controller.link(request, {
        ticket: ' ticket-1 ',
        appVerifier: ' app-verifier ',
      }),
    ).resolves.toBeUndefined();
    expect(link).toHaveBeenCalledWith('user-1', 'ticket-1', 'app-verifier');
  });

  it('검증된 UID의 GitHub grant와 credential을 폐기한다', async () => {
    const request = { uid: 'user-1' } as FirebaseAuthenticatedRequest;

    await expect(controller.revoke(request)).resolves.toBeUndefined();
    expect(revoke).toHaveBeenCalledWith('user-1');
  });
});
