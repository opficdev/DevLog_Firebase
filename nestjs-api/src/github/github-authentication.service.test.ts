import { Logger } from '@nestjs/common';

import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import {
  type ClaimedOAuthSession,
  type OAuthSessionCreation,
  type OAuthSessionInput,
} from '../oauth/oauth.types';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationService } from './github-authentication.service';
import { type GitHubAuthenticationConfiguration } from './github-authentication.types';

describe(GitHubAuthenticationService.name, () => {
  const configuration = jest.fn<GitHubAuthenticationConfiguration, []>();
  const exchangeAuthorizationCode = jest.fn();
  const revokeOAuthToken = jest.fn();
  const create = jest.fn<Promise<OAuthSessionCreation>, [OAuthSessionInput]>();
  const claim = jest.fn();
  const complete = jest.fn();
  const release = jest.fn();
  const storeCleanupPayload = jest.fn();
  const service = new GitHubAuthenticationService(
    { configuration },
    {
      exchangeAuthorizationCode,
      revokeOAuthToken,
    } as unknown as GitHubAuthenticationClient,
    {
      create,
      claim,
      complete,
      release,
      storeCleanupPayload,
    } as unknown as OAuthSessionRepository,
  );
  let loggerError: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
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
    claim.mockResolvedValue(claimedSession());
    exchangeAuthorizationCode.mockResolvedValue('access-token');
    complete.mockResolvedValue('ticket-1');
  });

  afterEach(() => {
    loggerError.mockRestore();
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

  it('현재 UID에 결합된 GitHub 계정 연결 session을 생성한다', async () => {
    await service.createAccountLinkSession('user-1', 'app-challenge');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        purpose: 'link',
        appChallenge: 'app-challenge',
        uid: 'user-1',
      }),
    );
  });

  it('callback code를 교환해 ticket만 포함한 앱 주소를 반환한다', async () => {
    const result = await service.callback('state-1', 'authorization-code');
    const url = new URL(result);

    expect(claim).toHaveBeenCalledWith('state-1', 'github');
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'authorization-code',
      expect.objectContaining({ clientId: 'client-id' }),
      'provider-verifier',
    );
    expect(complete).toHaveBeenCalledWith({
      session: claimedSession(),
      payload: { accessToken: 'access-token', clientId: 'client-id' },
    });
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ticket: 'ticket-1',
    });
    expect(result).not.toContain('access-token');
    expect(result).not.toContain('authorization-code');
  });

  it('callback 필수 query가 없으면 안전한 오류 주소를 반환한다', async () => {
    const result = await service.callback(undefined, 'authorization-code');

    expect(new URL(result).searchParams.get('error')).toBe('oauth-failed');
    expect(claim).not.toHaveBeenCalled();
  });

  it('ticket 저장 실패 시 교환 token을 폐기하고 session을 해제한다', async () => {
    complete.mockRejectedValue(new Error('ticket 저장 실패'));

    await expect(
      service.callback('state-1', 'authorization-code'),
    ).resolves.toContain('error=oauth-failed');
    expect(revokeOAuthToken).toHaveBeenCalledWith(
      'oauth-session',
      'access-token',
      expect.objectContaining({ clientId: 'client-id' }),
    );
    expect(release).toHaveBeenCalledWith(claimedSession());
  });

  it('보상 폐기 실패 시 session에 정리 payload를 남긴다', async () => {
    complete.mockRejectedValue(new Error('ticket 저장 실패'));
    revokeOAuthToken.mockRejectedValue(new Error('token 폐기 실패'));

    await service.callback('state-1', 'authorization-code');

    expect(storeCleanupPayload).toHaveBeenCalledWith(claimedSession(), {
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    expect(release).toHaveBeenCalledWith(claimedSession());
  });

  it('계정 연결 callback 보상 폐기에 현재 UID를 사용한다', async () => {
    claim.mockResolvedValue(claimedSession({ uid: 'user-1' }));
    complete.mockRejectedValue(new Error('ticket 저장 실패'));

    await service.callback('state-1', 'authorization-code');

    expect(revokeOAuthToken).toHaveBeenCalledWith(
      'user-1',
      'access-token',
      expect.any(Object),
    );
  });
});

// callback 처리용 OAuth session 대역을 구성합니다.
function claimedSession(
  overrides: Partial<ClaimedOAuthSession> = {},
): ClaimedOAuthSession {
  return {
    claim: 'claim-1',
    state: 'state-1',
    provider: 'github',
    purpose: 'signIn',
    appChallenge: 'app-challenge',
    providerPKCEVerifier: 'provider-verifier',
    ...overrides,
  };
}
