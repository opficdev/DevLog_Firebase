import { Injectable } from '@nestjs/common';

import { createOAuthVerifier } from '../oauth/oauth-proof';
import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';
import { type GitHubOAuthSessionResponse } from './github-authentication.types';

const authorizationEndpoint = 'https://github.com/login/oauth/authorize';

// GitHub 인증과 OAuth session 처리를 조정합니다.
@Injectable()
export class GitHubAuthenticationService {
  // GitHub 인증 처리에 필요한 의존성을 주입받습니다.
  constructor(
    private readonly configurationProvider: GitHubAuthenticationConfigurationProvider,
    private readonly sessionRepository: OAuthSessionRepository,
  ) {}

  // 로그인 목적 GitHub OAuth session과 authorization 주소를 생성합니다.
  async createSignInSession(
    appChallenge: string,
  ): Promise<GitHubOAuthSessionResponse> {
    const configuration = this.configurationProvider.configuration();
    const providerPKCEVerifier = createOAuthVerifier();
    const session = await this.sessionRepository.create({
      provider: 'github',
      purpose: 'signIn',
      appChallenge,
      providerPKCEVerifier,
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
