import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';

describe(GitHubAuthenticationConfigurationProvider.name, () => {
  const provider = new GitHubAuthenticationConfigurationProvider();
  const originalValue = process.env.GITHUB_OAUTH_CONFIG;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.GITHUB_OAUTH_CONFIG;
    } else {
      process.env.GITHUB_OAUTH_CONFIG = originalValue;
    }
  });

  it.each([
    [undefined, 'GITHUB_OAUTH_CONFIG 값이 필요합니다.'],
    ['{', 'GITHUB_OAUTH_CONFIG JSON 형식이 올바르지 않습니다.'],
    ['[]', 'GitHub OAuth App 설정 형식이 올바르지 않습니다.'],
    [
      '{"clientId":" ","clientSecret":"secret","callbackURL":"url"}',
      '유효한 clientId 값이 필요합니다.',
    ],
    [
      '{"clientId":"client","clientSecret":1,"callbackURL":"url"}',
      '유효한 clientSecret 값이 필요합니다.',
    ],
    [
      '{"clientId":"client","clientSecret":"secret"}',
      '유효한 callbackURL 값이 필요합니다.',
    ],
  ])('%p 구성을 거부한다', (value, message) => {
    if (value === undefined) {
      delete process.env.GITHUB_OAUTH_CONFIG;
    } else {
      process.env.GITHUB_OAUTH_CONFIG = value;
    }
    expect(() => provider.configuration()).toThrow(message);
  });

  it('공백을 제거한 필수 설정만 반환한다', () => {
    process.env.GITHUB_OAUTH_CONFIG = JSON.stringify({
      clientId: ' client-id ',
      clientSecret: ' client-secret ',
      callbackURL: ' https://example.com/api/auth/github/callback ',
      ignored: 'value',
    });

    expect(provider.configuration()).toEqual({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      callbackURL: 'https://example.com/api/auth/github/callback',
    });
  });
});
