import { Logger } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import { OAuthTicketRepository } from '../oauth/oauth-ticket.repository';
import {
  type ClaimedOAuthSession,
  type ClaimedOAuthTicket,
  type OAuthSessionCreation,
  type OAuthSessionInput,
} from '../oauth/oauth.types';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationService } from './github-authentication.service';
import { type GitHubAuthenticationConfiguration } from './github-authentication.types';
import { GitHubCredentialRepository } from './github-credential.repository';
import { GitHubProviderRepository } from './github-provider.repository';

describe(GitHubAuthenticationService.name, () => {
  const configuration = jest.fn<GitHubAuthenticationConfiguration, []>();
  const exchangeAuthorizationCode = jest.fn();
  const revokeOAuthToken = jest.fn();
  const revokeOAuthGrant = jest.fn();
  const createCustomToken = jest.fn();
  const getUser = jest.fn();
  const updateUser = jest.fn();
  const saveCredential = jest.fn();
  const pendingRevocations = jest.fn();
  const removePending = jest.fn();
  const findCredential = jest.fn();
  const claimRevocation = jest.fn();
  const deleteRevoked = jest.fn();
  const releaseRevocation = jest.fn();
  const deleteEmpty = jest.fn();
  const resolveUid = jest.fn();
  const linkProvider = jest.fn();
  const create = jest.fn<Promise<OAuthSessionCreation>, [OAuthSessionInput]>();
  const claimSession = jest.fn();
  const complete = jest.fn();
  const releaseSession = jest.fn();
  const storeCleanupPayload = jest.fn();
  const claimTicket = jest.fn();
  const consumeTicket = jest.fn();
  const releaseTicket = jest.fn();
  const service = new GitHubAuthenticationService(
    { createCustomToken, getUser, updateUser } as unknown as Auth,
    { configuration },
    {
      exchangeAuthorizationCode,
      revokeOAuthToken,
      revokeOAuthGrant,
    } as unknown as GitHubAuthenticationClient,
    {
      save: saveCredential,
      pendingRevocations,
      removePending,
      find: findCredential,
      claimRevocation,
      deleteRevoked,
      releaseRevocation,
      deleteEmpty,
    } as unknown as GitHubCredentialRepository,
    { resolveUid, link: linkProvider } as unknown as GitHubProviderRepository,
    {
      create,
      claim: claimSession,
      complete,
      release: releaseSession,
      storeCleanupPayload,
    } as unknown as OAuthSessionRepository,
    {
      claim: claimTicket,
      consume: consumeTicket,
      release: releaseTicket,
    } as unknown as OAuthTicketRepository,
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
    claimSession.mockResolvedValue(claimedSession());
    exchangeAuthorizationCode.mockResolvedValue('access-token');
    complete.mockResolvedValue('ticket-1');
    claimTicket.mockResolvedValue(claimedTicket());
    resolveUid.mockResolvedValue('github-uid');
    pendingRevocations.mockResolvedValue([]);
    findCredential.mockResolvedValue({
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    claimRevocation.mockResolvedValue('revocation-claim');
    createCustomToken.mockResolvedValue('custom-token');
    getUser.mockResolvedValue({
      providerData: [
        { providerId: 'github.com' },
        { providerId: 'google.com' },
      ],
    });
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

    expect(claimSession).toHaveBeenCalledWith('state-1', 'github');
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
    expect(claimSession).not.toHaveBeenCalled();
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
    expect(releaseSession).toHaveBeenCalledWith(claimedSession());
  });

  it('보상 폐기 실패 시 session에 정리 payload를 남긴다', async () => {
    complete.mockRejectedValue(new Error('ticket 저장 실패'));
    revokeOAuthToken.mockRejectedValue(new Error('token 폐기 실패'));

    await service.callback('state-1', 'authorization-code');

    expect(storeCleanupPayload).toHaveBeenCalledWith(claimedSession(), {
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    expect(releaseSession).toHaveBeenCalledWith(claimedSession());
  });

  it('계정 연결 callback 보상 폐기에 현재 UID를 사용한다', async () => {
    claimSession.mockResolvedValue(claimedSession({ uid: 'user-1' }));
    complete.mockRejectedValue(new Error('ticket 저장 실패'));

    await service.callback('state-1', 'authorization-code');

    expect(revokeOAuthToken).toHaveBeenCalledWith(
      'user-1',
      'access-token',
      expect.any(Object),
    );
  });

  it('로그인 ticket 처리 순서를 지켜 Firebase custom token을 반환한다', async () => {
    const sequence: string[] = [];
    claimTicket.mockImplementation(() => {
      sequence.push('ticket claim');
      return Promise.resolve(claimedTicket());
    });
    resolveUid.mockImplementation(() => {
      sequence.push('provider uid 결정');
      return Promise.resolve('github-uid');
    });
    saveCredential.mockImplementation(() => {
      sequence.push('credential 저장');
      return Promise.resolve();
    });
    pendingRevocations.mockImplementation(() => {
      sequence.push('이전 token 조회');
      return Promise.resolve([]);
    });
    createCustomToken.mockImplementation(() => {
      sequence.push('custom token 생성');
      return Promise.resolve('custom-token');
    });
    consumeTicket.mockImplementation(() => {
      sequence.push('ticket 소비');
      return Promise.resolve();
    });

    await expect(service.customToken('ticket-1', 'app-verifier')).resolves.toBe(
      'custom-token',
    );
    expect(claimTicket).toHaveBeenCalledWith(
      'ticket-1',
      'app-verifier',
      'github',
      'signIn',
    );
    expect(resolveUid).toHaveBeenCalledWith('access-token');
    expect(saveCredential).toHaveBeenCalledWith('github-uid', {
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    expect(sequence).toEqual([
      'ticket claim',
      'provider uid 결정',
      'credential 저장',
      '이전 token 조회',
      'custom token 생성',
      'ticket 소비',
    ]);
    expect(releaseTicket).not.toHaveBeenCalled();
  });

  it('같은 App의 이전 token을 폐기한 뒤 custom token을 생성한다', async () => {
    pendingRevocations.mockResolvedValue([
      { accessToken: 'old-token', clientId: 'client-id' },
    ]);

    await service.customToken('ticket-1', 'app-verifier');

    expect(revokeOAuthToken).toHaveBeenCalledWith(
      'github-uid',
      'old-token',
      expect.objectContaining({ clientId: 'client-id' }),
    );
    expect(removePending).toHaveBeenCalledWith('github-uid', {
      accessToken: 'old-token',
      clientId: 'client-id',
    });
    expect(revokeOAuthToken.mock.invocationCallOrder[0]).toBeLessThan(
      createCustomToken.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('현재 설정과 다른 App의 이전 credential을 거부하고 ticket을 해제한다', async () => {
    pendingRevocations.mockResolvedValue([
      { accessToken: 'old-token', clientId: 'other-client-id' },
    ]);

    await expect(
      service.customToken('ticket-1', 'app-verifier'),
    ).rejects.toMatchObject({
      status: 500,
      response: {
        code: 'internal',
        message:
          'GitHub credential을 발급한 OAuth App 설정을 찾을 수 없습니다.',
      },
    });
    expect(revokeOAuthToken).not.toHaveBeenCalled();
    expect(releaseTicket).toHaveBeenCalledWith(claimedTicket());
  });

  it('필수 credential이 없는 ticket을 해제하고 거부한다', async () => {
    claimTicket.mockResolvedValue(claimedTicket({ payload: {} }));

    await expect(
      service.customToken('ticket-1', 'app-verifier'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'invalid-oauth-ticket' },
    });
    expect(releaseTicket).toHaveBeenCalledWith(claimedTicket({ payload: {} }));
    expect(resolveUid).not.toHaveBeenCalled();
  });

  it('provider 사용자 처리 실패 시 ticket을 해제한다', async () => {
    const error = new Error('provider 처리 실패');
    resolveUid.mockRejectedValue(error);

    await expect(service.customToken('ticket-1', 'app-verifier')).rejects.toBe(
      error,
    );
    expect(releaseTicket).toHaveBeenCalledWith(claimedTicket());
    expect(consumeTicket).not.toHaveBeenCalled();
  });

  it('custom token 생성 실패 시 ticket을 해제하고 credential을 유지한다', async () => {
    const error = new Error('custom token 생성 실패');
    createCustomToken.mockRejectedValue(error);

    await expect(service.customToken('ticket-1', 'app-verifier')).rejects.toBe(
      error,
    );
    expect(saveCredential).toHaveBeenCalled();
    expect(releaseTicket).toHaveBeenCalledWith(claimedTicket());
    expect(consumeTicket).not.toHaveBeenCalled();
  });

  it('현재 UID에 결합된 ticket 처리 순서를 지켜 GitHub 계정을 연결한다', async () => {
    const linkedTicket = claimedTicket({ purpose: 'link', uid: 'user-1' });
    const sequence: string[] = [];
    claimTicket.mockImplementation(() => {
      sequence.push('ticket claim');
      return Promise.resolve(linkedTicket);
    });
    linkProvider.mockImplementation(() => {
      sequence.push('provider 연결');
      return Promise.resolve();
    });
    saveCredential.mockImplementation(() => {
      sequence.push('credential 저장');
      return Promise.resolve();
    });
    pendingRevocations.mockImplementation(() => {
      sequence.push('이전 token 조회');
      return Promise.resolve([]);
    });
    consumeTicket.mockImplementation(() => {
      sequence.push('ticket 소비');
      return Promise.resolve();
    });

    await service.link('user-1', 'ticket-1', 'app-verifier');

    expect(claimTicket).toHaveBeenCalledWith(
      'ticket-1',
      'app-verifier',
      'github',
      'link',
      'user-1',
    );
    expect(linkProvider).toHaveBeenCalledWith('user-1', 'access-token');
    expect(saveCredential).toHaveBeenCalledWith('user-1', {
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    expect(sequence).toEqual([
      'ticket claim',
      'provider 연결',
      'credential 저장',
      '이전 token 조회',
      'ticket 소비',
    ]);
    expect(releaseTicket).not.toHaveBeenCalled();
  });

  it('GitHub 계정 연결 실패 뒤 ticket을 다시 사용할 수 있도록 해제한다', async () => {
    const linkedTicket = claimedTicket({ purpose: 'link', uid: 'user-1' });
    const error = new Error('provider 연결 실패');
    claimTicket.mockResolvedValue(linkedTicket);
    linkProvider.mockRejectedValue(error);

    await expect(
      service.link('user-1', 'ticket-1', 'app-verifier'),
    ).rejects.toBe(error);
    expect(releaseTicket).toHaveBeenCalledWith(linkedTicket);
    expect(saveCredential).not.toHaveBeenCalled();
    expect(consumeTicket).not.toHaveBeenCalled();
  });

  it('이전 token 뒤 현재 GitHub grant와 credential을 폐기한다', async () => {
    const sequence: string[] = [];
    pendingRevocations.mockImplementation(() => {
      sequence.push('이전 token 조회');
      return Promise.resolve([]);
    });
    claimRevocation.mockImplementation(() => {
      sequence.push('폐기 claim');
      return Promise.resolve('revocation-claim');
    });
    revokeOAuthGrant.mockImplementation(() => {
      sequence.push('grant 폐기');
      return Promise.resolve();
    });
    deleteRevoked.mockImplementation(() => {
      sequence.push('credential 삭제');
      return Promise.resolve();
    });

    await service.revoke('user-1');

    expect(findCredential).toHaveBeenCalledWith('user-1');
    expect(claimRevocation).toHaveBeenCalledWith('user-1', {
      accessToken: 'access-token',
      clientId: 'client-id',
    });
    expect(revokeOAuthGrant).toHaveBeenCalledWith(
      'user-1',
      'access-token',
      expect.objectContaining({ clientId: 'client-id' }),
    );
    expect(deleteRevoked).toHaveBeenCalledWith(
      'user-1',
      { accessToken: 'access-token', clientId: 'client-id' },
      'revocation-claim',
    );
    expect(sequence).toEqual([
      '이전 token 조회',
      '폐기 claim',
      'grant 폐기',
      'credential 삭제',
    ]);
  });

  it('GitHub credential이 없으면 빈 문서를 정리한다', async () => {
    findCredential.mockResolvedValue(undefined);

    await service.revoke('user-1');

    expect(pendingRevocations).toHaveBeenCalledWith('user-1');
    expect(deleteEmpty).toHaveBeenCalledWith('user-1');
    expect(claimRevocation).not.toHaveBeenCalled();
    expect(revokeOAuthGrant).not.toHaveBeenCalled();
  });

  it('GitHub grant 폐기 실패 뒤 claim을 해제한다', async () => {
    const error = new Error('grant 폐기 실패');
    revokeOAuthGrant.mockRejectedValue(error);

    await expect(service.revoke('user-1')).rejects.toBe(error);
    expect(releaseRevocation).toHaveBeenCalledWith(
      'user-1',
      'revocation-claim',
    );
    expect(deleteRevoked).not.toHaveBeenCalled();
  });

  it('GitHub grant와 credential을 정리한 뒤 provider 연결을 해제한다', async () => {
    const sequence: string[] = [];
    getUser.mockImplementation(() => {
      sequence.push('provider 조회');
      return Promise.resolve({
        providerData: [
          { providerId: 'github.com' },
          { providerId: 'google.com' },
        ],
      });
    });
    findCredential.mockImplementation(() => {
      sequence.push('credential 조회');
      return Promise.resolve({
        accessToken: 'access-token',
        clientId: 'client-id',
      });
    });
    claimRevocation.mockImplementation(() => {
      sequence.push('폐기 claim');
      return Promise.resolve('revocation-claim');
    });
    revokeOAuthGrant.mockImplementation(() => {
      sequence.push('grant 폐기');
      return Promise.resolve();
    });
    deleteRevoked.mockImplementation(() => {
      sequence.push('credential 삭제');
      return Promise.resolve();
    });
    updateUser.mockImplementation(() => {
      sequence.push('provider 해제');
      return Promise.resolve();
    });

    await expect(service.unlink('user-1')).resolves.toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith('user-1', {
      providersToUnlink: ['github.com'],
    });
    expect(sequence).toEqual([
      'provider 조회',
      'credential 조회',
      '폐기 claim',
      'grant 폐기',
      'credential 삭제',
      'provider 해제',
    ]);
  });

  it('마지막 GitHub provider는 grant 폐기 전에 해제를 거부한다', async () => {
    getUser.mockResolvedValue({
      providerData: [{ providerId: 'github.com' }],
    });

    await expect(service.unlink('user-1')).rejects.toMatchObject({
      status: 412,
      response: {
        code: 'last-provider',
        message: '마지막 로그인 provider는 해제할 수 없습니다.',
      },
    });
    expect(findCredential).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('GitHub provider가 없어도 남은 credential을 정리한다', async () => {
    getUser.mockResolvedValue({
      providerData: [{ providerId: 'google.com' }],
    });
    findCredential.mockResolvedValue(undefined);

    await expect(service.unlink('user-1')).resolves.toBeUndefined();
    expect(deleteEmpty).toHaveBeenCalledWith('user-1');
    expect(updateUser).not.toHaveBeenCalled();
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

// custom token 처리용 OAuth ticket 대역을 구성합니다.
function claimedTicket(
  overrides: Partial<ClaimedOAuthTicket> = {},
): ClaimedOAuthTicket {
  return {
    claim: 'ticket-claim',
    ticket: 'ticket-1',
    sessionId: 'state-1',
    provider: 'github',
    purpose: 'signIn',
    payload: { accessToken: 'access-token', clientId: 'client-id' },
    ...overrides,
  };
}
