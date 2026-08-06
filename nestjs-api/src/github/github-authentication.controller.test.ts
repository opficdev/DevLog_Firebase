import { HttpStatus } from '@nestjs/common';

import { GitHubAuthenticationController } from './github-authentication.controller';
import { GitHubAuthenticationService } from './github-authentication.service';

describe(GitHubAuthenticationController.name, () => {
  const createSignInSession = jest.fn();
  const controller = new GitHubAuthenticationController({
    createSignInSession,
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
});
