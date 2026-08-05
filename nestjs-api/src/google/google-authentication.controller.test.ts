import { HttpStatus } from '@nestjs/common';

import { GoogleAuthenticationController } from './google-authentication.controller';
import { GoogleAuthenticationService } from './google-authentication.service';

describe(GoogleAuthenticationController.name, () => {
  const customToken = jest.fn();
  const controller = new GoogleAuthenticationController({
    customToken,
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
});
