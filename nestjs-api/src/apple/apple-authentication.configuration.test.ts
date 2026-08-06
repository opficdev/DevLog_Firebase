import {
  appleAuthenticationConfiguration,
  appleAuthenticationConfigurationProvider,
  APPLE_AUTHENTICATION_CONFIGURATION_TOKEN,
} from './apple-authentication.configuration';

describe(appleAuthenticationConfiguration.name, () => {
  const originalValue = process.env.APPLE_AUTH_CONFIG;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.APPLE_AUTH_CONFIG;
    } else {
      process.env.APPLE_AUTH_CONFIG = originalValue;
    }
  });

  it.each([
    [undefined, 'APPLE_AUTH_CONFIG 값이 필요합니다.'],
    ['{', 'APPLE_AUTH_CONFIG JSON 형식이 올바르지 않습니다.'],
    ['[]', 'Apple 인증 설정 형식이 올바르지 않습니다.'],
    [
      '{"teamId":" ","clientId":"client","keyId":"key","privateKey":"private"}',
      '유효한 teamId 값이 필요합니다.',
    ],
    [
      '{"teamId":"team","clientId":1,"keyId":"key","privateKey":"private"}',
      '유효한 clientId 값이 필요합니다.',
    ],
    [
      '{"teamId":"team","clientId":"client","privateKey":"private"}',
      '유효한 keyId 값이 필요합니다.',
    ],
    [
      '{"teamId":"team","clientId":"client","keyId":"key","privateKey":" "}',
      '유효한 privateKey 값이 필요합니다.',
    ],
  ])('%p 구성을 거부한다', (value, message) => {
    if (value === undefined) {
      delete process.env.APPLE_AUTH_CONFIG;
    } else {
      process.env.APPLE_AUTH_CONFIG = value;
    }
    expect(appleAuthenticationConfiguration).toThrow(message);
  });

  it('공백을 제거하고 private key 줄바꿈을 복원한다', () => {
    process.env.APPLE_AUTH_CONFIG = JSON.stringify({
      teamId: ' team-id ',
      clientId: ' client-id ',
      keyId: ' key-id ',
      privateKey: ' first-line\\nsecond-line ',
      ignored: 'value',
    });

    expect(appleAuthenticationConfiguration()).toEqual({
      teamId: 'team-id',
      clientId: 'client-id',
      keyId: 'key-id',
      privateKey: 'first-line\nsecond-line',
    });
  });

  it('설정 provider가 환경 구성 함수를 연결한다', () => {
    expect(appleAuthenticationConfigurationProvider).toEqual({
      provide: APPLE_AUTHENTICATION_CONFIGURATION_TOKEN,
      useFactory: appleAuthenticationConfiguration,
    });
  });
});
