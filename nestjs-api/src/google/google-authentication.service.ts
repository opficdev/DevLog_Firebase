import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { GoogleAuthenticationClient } from './google-authentication.client';
import { GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN } from './google-authentication.configuration';
import { type GoogleAuthenticationConfiguration } from './google-authentication.types';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

// Google 인증과 Firebase token 발급·사용자 연결 순서를 조정합니다.
@Injectable()
export class GoogleAuthenticationService {
  // 계정 연결 정리 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GoogleAuthenticationService.name);

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

  // serverAuthCode를 검증해 현재 Firebase 사용자에게 Google 계정을 연결합니다.
  async link(uid: string, serverAuthCode: string): Promise<void> {
    const claim = await this.credentialRepository.claimAccountLink(uid);
    let didLink = false;
    try {
      const token = await this.client.exchangeAuthorizationCode(serverAuthCode);
      const payload = await this.client.verifyIdToken(token.idToken);
      didLink = await this.providerRepository.link(uid, payload);
      await this.credentialRepository.save(
        uid,
        {
          accessToken: token.accessToken,
          clientId: this.configuration.clientId,
          refreshToken: token.refreshToken,
        },
        claim,
      );
    } catch (error) {
      if (didLink) {
        let canCompensate = false;
        try {
          canCompensate = await this.credentialRepository.renewAccountLink(
            uid,
            claim,
          );
        } catch (renewError) {
          this.logger.error('Google 계정 연결 lease 갱신 실패', renewError, {
            uid,
          });
        }
        if (canCompensate) {
          try {
            await this.auth.updateUser(uid, {
              providersToUnlink: ['google.com'],
            });
          } catch (compensationError) {
            this.logger.error(
              'Google provider 연결 보상 실패',
              compensationError,
              { uid },
            );
          }
        }
      }
      try {
        await this.credentialRepository.releaseAccountLink(uid, claim);
      } catch (releaseError) {
        this.logger.error('Google 계정 연결 lease 해제 실패', releaseError, {
          uid,
        });
      }
      throw error;
    }
  }
}
