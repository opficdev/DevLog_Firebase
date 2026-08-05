import { Inject, Injectable } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { GoogleAuthenticationClient } from './google-authentication.client';
import { GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN } from './google-authentication.configuration';
import { type GoogleAuthenticationConfiguration } from './google-authentication.types';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

// Google 인증과 Firebase custom token 발급 순서를 조정합니다.
@Injectable()
export class GoogleAuthenticationService {
  // Google 인증 처리에 필요한 의존성을 주입받습니다.
  constructor(
    @Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth,
    @Inject(GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN)
    private readonly configuration: GoogleAuthenticationConfiguration,
    private readonly client: GoogleAuthenticationClient,
    private readonly credentialRepository: GoogleCredentialRepository,
    private readonly providerRepository: GoogleProviderRepository,
  ) {}

  // serverAuthCode를 검증하고 Firebase custom token을 반환합니다.
  async customToken(serverAuthCode: string): Promise<string> {
    const token = await this.client.exchangeAuthorizationCode(serverAuthCode);
    const payload = await this.client.verifyIdToken(token.idToken);
    const uid = await this.providerRepository.resolveUid(payload);
    await this.credentialRepository.save(uid, {
      accessToken: token.accessToken,
      clientId: this.configuration.clientId,
      refreshToken: token.refreshToken,
    });
    return this.auth.createCustomToken(uid);
  }
}
