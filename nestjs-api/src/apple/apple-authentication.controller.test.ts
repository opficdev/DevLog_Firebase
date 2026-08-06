import { HttpStatus } from '@nestjs/common';

import { AppleAuthenticationController } from './apple-authentication.controller';
import { AppleAuthenticationService } from './apple-authentication.service';

describe(AppleAuthenticationController.name, () => {
  const createChallenge = jest.fn();
  const requestCustomTokenWithChallenge = jest.fn();
  const requestCustomTokenWithIdToken = jest.fn();
  const controller = new AppleAuthenticationController({
    createChallenge,
    requestCustomTokenWithChallenge,
    requestCustomTokenWithIdToken,
  } as unknown as AppleAuthenticationService);

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('새 Apple 인증 challenge를 반환한다', async () => {
    const challenge = {
      challengeId: 'challenge-1',
      hashedNonce: 'hashed-nonce',
      expiresAt: '2026-08-06T00:05:00.000Z',
    };
    createChallenge.mockResolvedValue(challenge);

    await expect(controller.createChallenge()).resolves.toEqual(challenge);
    expect(createChallenge).toHaveBeenCalledWith();
  });

  it('공백을 제거한 challenge 요청으로 custom token을 반환한다', async () => {
    requestCustomTokenWithChallenge.mockResolvedValue('custom-token');

    await expect(
      controller.customToken({
        challengeId: ' challenge-1 ',
        authorizationCode: ' authorization-code ',
        displayName: ' Apple User ',
      }),
    ).resolves.toEqual({ customToken: 'custom-token' });
    expect(requestCustomTokenWithChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'authorization-code',
      'Apple User',
    );
    expect(requestCustomTokenWithIdToken).not.toHaveBeenCalled();
  });

  it('빈 displayName을 생략해 challenge 요청을 처리한다', async () => {
    requestCustomTokenWithChallenge.mockResolvedValue('custom-token');

    await controller.customToken({
      challengeId: 'challenge-1',
      authorizationCode: 'authorization-code',
      displayName: ' ',
    });

    expect(requestCustomTokenWithChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'authorization-code',
      undefined,
    );
  });

  it('공백을 제거한 기존 요청으로 custom token을 반환한다', async () => {
    requestCustomTokenWithIdToken.mockResolvedValue('custom-token');

    await expect(
      controller.customToken({
        idToken: ' legacy-id-token ',
        authorizationCode: ' authorization-code ',
      }),
    ).resolves.toEqual({ customToken: 'custom-token' });
    expect(requestCustomTokenWithIdToken).toHaveBeenCalledWith(
      'legacy-id-token',
      'authorization-code',
    );
    expect(requestCustomTokenWithChallenge).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, 'idToken가 필요합니다.'],
    [{}, 'idToken가 필요합니다.'],
    [{ idToken: ' ', authorizationCode: 'code' }, 'idToken가 필요합니다.'],
    [{ idToken: 'token' }, 'authorizationCode가 필요합니다.'],
    [
      { challengeId: ' ', idToken: 'token', authorizationCode: 'code' },
      'challengeId가 필요합니다.',
    ],
    [{ challengeId: 'challenge-1' }, 'authorizationCode가 필요합니다.'],
  ])('유효하지 않은 custom token 요청을 거부한다', async (body, message) => {
    await expect(controller.customToken(body)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'invalid-argument', message },
    });
    expect(requestCustomTokenWithChallenge).not.toHaveBeenCalled();
    expect(requestCustomTokenWithIdToken).not.toHaveBeenCalled();
  });

  it('문자열이 아닌 displayName을 거부한다', async () => {
    await expect(
      controller.customToken({
        challengeId: 'challenge-1',
        authorizationCode: 'authorization-code',
        displayName: 1,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'displayName 형식이 올바르지 않습니다.',
      },
    });
    expect(requestCustomTokenWithChallenge).not.toHaveBeenCalled();
  });
});
