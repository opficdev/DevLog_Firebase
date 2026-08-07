import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { createOAuthVerifier } from '../oauth/oauth-proof';
import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import { OAuthTicketRepository } from '../oauth/oauth-ticket.repository';
import {
  type ClaimedOAuthSession,
  type ClaimedOAuthTicket,
  type OAuthPurpose,
} from '../oauth/oauth.types';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';
import {
  type GitHubAuthenticationConfiguration,
  type GitHubCredential,
  type GitHubOAuthSessionResponse,
} from './github-authentication.types';
import { GitHubCredentialRepository } from './github-credential.repository';
import { GitHubProviderRepository } from './github-provider.repository';

const authorizationEndpoint = 'https://github.com/login/oauth/authorize';
const appCallbackURL = 'DevLog://oauth-callback';
const githubProviderId = 'github.com';

// 마지막 로그인 provider 해제 오류입니다.
const lastProviderException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'last-provider',
  '마지막 로그인 provider는 해제할 수 없습니다.',
);

// GitHub 인증과 OAuth session 처리를 조정합니다.
@Injectable()
export class GitHubAuthenticationService {
  // callback 보상 처리 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GitHubAuthenticationService.name);

  // GitHub 인증 처리에 필요한 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth,
    private readonly configurationProvider: GitHubAuthenticationConfigurationProvider,
    private readonly client: GitHubAuthenticationClient,
    private readonly credentialRepository: GitHubCredentialRepository,
    private readonly providerRepository: GitHubProviderRepository,
    private readonly sessionRepository: OAuthSessionRepository,
    private readonly ticketRepository: OAuthTicketRepository,
  ) {}

  // 로그인 목적 GitHub OAuth session과 authorization 주소를 생성합니다.
  async createSignInSession(
    appChallenge: string,
  ): Promise<GitHubOAuthSessionResponse> {
    return this.createSession('signIn', appChallenge);
  }

  // 계정 연결 목적 GitHub OAuth session과 authorization 주소를 생성합니다.
  async createAccountLinkSession(
    uid: string,
    appChallenge: string,
  ): Promise<GitHubOAuthSessionResponse> {
    return this.createSession('link', appChallenge, uid);
  }

  // GitHub callback code를 교환하고 앱에 ticket만 포함한 주소를 반환합니다.
  async callback(state?: string, code?: string): Promise<string> {
    let configuration: GitHubAuthenticationConfiguration | undefined;
    let session: ClaimedOAuthSession | undefined;
    let accessToken: string | undefined;
    try {
      configuration = this.configurationProvider.configuration();
      if (!state || !code) {
        throw missingCallbackParametersException;
      }
      session = await this.sessionRepository.claim(state, 'github');
      accessToken = await this.client.exchangeAuthorizationCode(
        code,
        configuration,
        session.providerPKCEVerifier,
      );
      const ticket = await this.sessionRepository.complete({
        session,
        payload: { accessToken, clientId: configuration.clientId },
      });
      return callbackURL({ ticket });
    } catch (error) {
      if (accessToken && configuration) {
        try {
          await this.client.revokeOAuthToken(
            session?.uid ?? 'oauth-session',
            accessToken,
            configuration,
          );
        } catch (revokeError) {
          this.logger.error({
            message: 'GitHub OAuth callback 보상 폐기 실패',
            ...callbackErrorMetadata(revokeError),
          });
          if (session) {
            try {
              await this.sessionRepository.storeCleanupPayload(session, {
                accessToken,
                clientId: configuration.clientId,
              });
            } catch (storageError) {
              this.logger.error({
                message: 'GitHub OAuth callback 보상 정보 저장 실패',
                ...callbackErrorMetadata(storageError),
              });
            }
          }
        }
      }
      if (session) {
        try {
          await this.sessionRepository.release(session);
        } catch (releaseError) {
          this.logger.error({
            message: 'GitHub OAuth callback session 해제 실패',
            ...callbackErrorMetadata(releaseError),
          });
        }
      }
      this.logger.error({
        message: 'GitHub OAuth callback 처리 실패',
        ...callbackErrorMetadata(error),
      });
      return callbackURL({ error: 'oauth-failed' });
    }
  }

  // 로그인 ticket을 검증하고 Firebase custom token을 반환합니다.
  async customToken(ticket: string, appVerifier: string): Promise<string> {
    const claimed = await this.ticketRepository.claim(
      ticket,
      appVerifier,
      'github',
      'signIn',
    );
    try {
      const credential = credentialFrom(claimed);
      const uid = await this.providerRepository.resolveUid(
        credential.accessToken,
      );
      await this.credentialRepository.save(uid, credential);
      await this.revokePendingCredentials(uid);
      const customToken = await this.auth.createCustomToken(uid);
      await this.ticketRepository.consume(claimed);
      return customToken;
    } catch (error) {
      await this.ticketRepository.release(claimed);
      throw error;
    }
  }

  // 현재 UID에 결합된 ticket으로 GitHub provider와 credential을 연결합니다.
  // prettier-ignore
  async link(
    uid: string,
    ticket: string,
    appVerifier: string,
  ): Promise<void> {
    const claimed = await this.ticketRepository.claim(
      ticket,
      appVerifier,
      'github',
      'link',
      uid,
    );
    try {
      const credential = credentialFrom(claimed);
      await this.providerRepository.link(uid, credential.accessToken);
      await this.credentialRepository.save(uid, credential);
      await this.revokePendingCredentials(uid);
      await this.ticketRepository.consume(claimed);
    } catch (error) {
      await this.ticketRepository.release(claimed);
      throw error;
    }
  }

  // 저장된 GitHub OAuth grant와 credential을 폐기합니다.
  async revoke(uid: string): Promise<void> {
    const credential = await this.credentialRepository.find(uid);
    await this.revokePendingCredentials(uid);
    const configuration = this.revocationConfiguration(credential?.clientId);
    await this.revokeCredential(uid, configuration, credential);
  }

  // GitHub grant와 credential을 정리한 뒤 provider 연결을 해제합니다.
  async unlink(uid: string): Promise<void> {
    const user = await this.auth.getUser(uid);
    const providers = user.providerData ?? [];
    const hasGitHubProvider = providers.some(
      (provider) => provider.providerId === githubProviderId,
    );
    if (hasGitHubProvider && providers.length <= 1) {
      throw lastProviderException;
    }

    await this.revoke(uid);
    if (hasGitHubProvider) {
      await this.auth.updateUser(uid, {
        providersToUnlink: [githubProviderId],
      });
    }
  }

  // 목적과 UID에 결합된 GitHub OAuth session과 authorization 주소를 생성합니다.
  private async createSession(
    purpose: OAuthPurpose,
    appChallenge: string,
    uid?: string,
  ): Promise<GitHubOAuthSessionResponse> {
    const configuration = this.configurationProvider.configuration();
    const providerPKCEVerifier = createOAuthVerifier();
    const session = await this.sessionRepository.create({
      provider: 'github',
      purpose,
      appChallenge,
      providerPKCEVerifier,
      uid,
    });
    const authorizationURL = new URL(authorizationEndpoint);
    authorizationURL.searchParams.set('client_id', configuration.clientId);
    authorizationURL.searchParams.set(
      'redirect_uri',
      configuration.callbackURL,
    );
    authorizationURL.searchParams.set('scope', 'read:user user:email');
    authorizationURL.searchParams.set('prompt', 'select_account');
    authorizationURL.searchParams.set('state', session.state);
    authorizationURL.searchParams.set(
      'code_challenge',
      session.providerPKCEChallenge,
    );
    authorizationURL.searchParams.set('code_challenge_method', 'S256');
    return { authorizationURL: authorizationURL.toString() };
  }

  // 같은 OAuth App에서 교체된 이전 access token을 차례로 폐기합니다.
  private async revokePendingCredentials(uid: string): Promise<void> {
    const pending = await this.credentialRepository.pendingRevocations(uid);
    for (const credential of pending) {
      const configuration = this.revocationConfiguration(credential.clientId);
      await this.client.revokeOAuthToken(
        uid,
        credential.accessToken,
        configuration,
      );
      await this.credentialRepository.removePending(uid, credential);
    }
  }

  // credential을 발급한 OAuth App과 현재 설정이 일치하는지 확인합니다.
  private revocationConfiguration(
    credentialClientId?: string,
  ): GitHubAuthenticationConfiguration {
    const configuration = this.configurationProvider.configuration();
    if (credentialClientId && credentialClientId !== configuration.clientId) {
      throw credentialConfigurationException;
    }
    return configuration;
  }

  // 현재 GitHub credential을 claim한 뒤 grant 폐기 결과를 반영합니다.
  private async revokeCredential(
    uid: string,
    configuration: GitHubAuthenticationConfiguration,
    requestedCredential?: GitHubCredential,
  ): Promise<void> {
    const credential =
      requestedCredential ?? (await this.credentialRepository.find(uid));
    if (!credential) {
      await this.credentialRepository.deleteEmpty(uid);
      return;
    }

    const claim = await this.credentialRepository.claimRevocation(
      uid,
      credential,
    );
    try {
      await this.client.revokeOAuthGrant(
        uid,
        credential.accessToken,
        configuration,
      );
      await this.credentialRepository.deleteRevoked(uid, credential, claim);
    } catch (error) {
      await this.credentialRepository.releaseRevocation(uid, claim);
      throw error;
    }
  }
}

// 앱 callback 주소에 ticket 또는 안전한 오류 값만 추가합니다.
function callbackURL(query: { ticket?: string; error?: string }): string {
  const url = new URL(appCallbackURL);
  if (query.ticket) {
    url.searchParams.set('ticket', query.ticket);
  } else if (query.error) {
    url.searchParams.set('error', query.error);
  }
  return url.toString();
}

// 비밀값 없이 callback 오류의 종류와 문구를 로그 데이터로 구성합니다.
function callbackErrorMetadata(error: unknown): {
  name: string;
  errorMessage: string;
} {
  if (error instanceof Error) {
    return { name: error.name, errorMessage: error.message };
  }
  return {
    name: 'UnknownError',
    errorMessage: '알 수 없는 GitHub OAuth callback 오류',
  };
}

// ticket의 서버 전용 payload에서 GitHub credential을 반환합니다.
function credentialFrom(ticket: ClaimedOAuthTicket): GitHubCredential {
  const accessToken = ticket.payload.accessToken;
  if (typeof accessToken !== 'string' || !accessToken) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-oauth-ticket',
      'OAuth ticket에 GitHub access token이 없습니다.',
    );
  }
  const clientId = ticket.payload.clientId;
  if (typeof clientId !== 'string' || !clientId) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-oauth-ticket',
      'OAuth ticket에 GitHub OAuth App 정보가 없습니다.',
    );
  }
  return { accessToken, clientId };
}

// GitHub callback 필수 query 누락 오류입니다.
const missingCallbackParametersException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-argument',
  'GitHub callback state와 code가 필요합니다.',
);

// credential 발급 App과 현재 환경 설정 불일치 오류입니다.
const credentialConfigurationException = new ApiException(
  HttpStatus.INTERNAL_SERVER_ERROR,
  'internal',
  'GitHub credential을 발급한 OAuth App 설정을 찾을 수 없습니다.',
);
