import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { ApiException } from '../common/api.exception';
import { createOAuthVerifier } from '../oauth/oauth-proof';
import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import {
  type ClaimedOAuthSession,
  type OAuthPurpose,
} from '../oauth/oauth.types';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';
import {
  type GitHubAuthenticationConfiguration,
  type GitHubOAuthSessionResponse,
} from './github-authentication.types';

const authorizationEndpoint = 'https://github.com/login/oauth/authorize';
const appCallbackURL = 'DevLog://oauth-callback';

// GitHub 인증과 OAuth session 처리를 조정합니다.
@Injectable()
export class GitHubAuthenticationService {
  // callback 보상 처리 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GitHubAuthenticationService.name);

  // GitHub 인증 처리에 필요한 의존성을 주입받습니다.
  constructor(
    private readonly configurationProvider: GitHubAuthenticationConfigurationProvider,
    private readonly client: GitHubAuthenticationClient,
    private readonly sessionRepository: OAuthSessionRepository,
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

// GitHub callback 필수 query 누락 오류입니다.
const missingCallbackParametersException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'invalid-argument',
  'GitHub callback state와 code가 필요합니다.',
);
