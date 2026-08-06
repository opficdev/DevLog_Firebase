import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import {
  type OAuthSessionCreation,
  type OAuthSessionInput,
} from '../oauth/oauth.types';
import { GitHubAuthenticationService } from './github-authentication.service';
import { type GitHubAuthenticationConfiguration } from './github-authentication.types';

describe(GitHubAuthenticationService.name, () => {
  const configuration = jest.fn<GitHubAuthenticationConfiguration, []>();
  const create = jest.fn<Promise<OAuthSessionCreation>, [OAuthSessionInput]>();
  const service = new GitHubAuthenticationService({ configuration }, {
    create,
  } as unknown as OAuthSessionRepository);

  beforeEach(() => {
    jest.resetAllMocks();
    configuration.mockReturnValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      callbackURL: 'https://example.com/api/auth/github/callback',
    });
    create.mockResolvedValue({
      state: 'state-1',
      providerPKCEChallenge: 'provider-challenge',
      expiresAt: new Date(),
    });
  });

  it('PKCE GitHub 로그인 session과 authorization 주소를 생성한다', async () => {
    const response = await service.createSignInSession('app-challenge');
    const input = create.mock.calls[0]?.[0];
    const authorizationURL = new URL(response.authorizationURL);

    expect(input).toMatchObject({
      provider: 'github',
      purpose: 'signIn',
      appChallenge: 'app-challenge',
    });
    expect(input?.providerPKCEVerifier).toEqual(expect.any(String));
    expect(
      Buffer.from(input?.providerPKCEVerifier ?? '', 'base64url'),
    ).toHaveLength(48);
    expect(authorizationURL.origin + authorizationURL.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(Object.fromEntries(authorizationURL.searchParams)).toEqual({
      client_id: 'client-id',
      redirect_uri: 'https://example.com/api/auth/github/callback',
      scope: 'read:user user:email',
      prompt: 'select_account',
      state: 'state-1',
      code_challenge: 'provider-challenge',
      code_challenge_method: 'S256',
    });
    expect(response).not.toHaveProperty('providerPKCEVerifier');
  });
});
