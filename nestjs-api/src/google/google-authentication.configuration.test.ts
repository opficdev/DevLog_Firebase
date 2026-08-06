import {
  googleOAuthConfiguration,
  googleOAuthConfigurationProvider,
  GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN,
} from './google-authentication.configuration';

describe(googleOAuthConfiguration.name, () => {
  const originalValue = process.env.GOOGLE_OAUTH_CONFIG;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.GOOGLE_OAUTH_CONFIG;
    } else {
      process.env.GOOGLE_OAUTH_CONFIG = originalValue;
    }
  });

  it.each([
    [undefined, 'GOOGLE_OAUTH_CONFIG 값이 필요합니다.'],
    ['{', 'GOOGLE_OAUTH_CONFIG JSON 형식이 올바르지 않습니다.'],
    ['[]', 'Google OAuth client 설정 형식이 올바르지 않습니다.'],
    [
      '{"clientId":" ","clientSecret":"secret"}',
      '유효한 clientId 값이 필요합니다.',
    ],
    [
      '{"clientId":"client","clientSecret":1}',
      '유효한 clientSecret 값이 필요합니다.',
    ],
  ])('%p 구성을 거부한다', (value, message) => {
    if (value === undefined) {
      delete process.env.GOOGLE_OAUTH_CONFIG;
    } else {
      process.env.GOOGLE_OAUTH_CONFIG = value;
    }
    expect(googleOAuthConfiguration).toThrow(message);
  });

  it('공백을 제거한 필수 설정만 반환한다', () => {
    process.env.GOOGLE_OAUTH_CONFIG = JSON.stringify({
      clientId: ' client-id ',
      clientSecret: ' client-secret ',
      ignored: 'value',
    });

    expect(googleOAuthConfiguration()).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    });
  });

  it('설정 provider가 환경 구성 함수를 연결한다', () => {
    expect(googleOAuthConfigurationProvider).toEqual({
      provide: GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN,
      useFactory: googleOAuthConfiguration,
    });
  });
});
