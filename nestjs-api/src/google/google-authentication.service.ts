import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { GoogleAuthenticationClient } from './google-authentication.client';
import { GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN } from './google-authentication.configuration';
import { type GoogleAuthenticationConfiguration } from './google-authentication.types';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

// 마지막 로그인 provider 해제 오류입니다.
const lastProviderException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'last-provider',
  '마지막 로그인 provider는 해제할 수 없습니다.',
);

// Google 인증과 Firebase 사용자 연결, credential 처리를 조정합니다.
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
          let errorMessage = '알 수 없는 오류';
          let errorStack: string | undefined;
          if (renewError instanceof Error) {
            errorMessage = renewError.message;
            errorStack = renewError.stack;
          }
          this.logger.error({
            message: 'Google 계정 연결 lease 갱신 실패',
            errorMessage,
            errorStack,
            uid,
          });
        }
        if (canCompensate) {
          try {
            await this.auth.updateUser(uid, {
              providersToUnlink: ['google.com'],
            });
          } catch (compensationError) {
            let errorMessage = '알 수 없는 오류';
            let errorStack: string | undefined;
            if (compensationError instanceof Error) {
              errorMessage = compensationError.message;
              errorStack = compensationError.stack;
            }
            this.logger.error({
              message: 'Google provider 연결 보상 실패',
              errorMessage,
              errorStack,
              uid,
            });
          }
        }
      }
      try {
        await this.credentialRepository.releaseAccountLink(uid, claim);
      } catch (releaseError) {
        let errorMessage = '알 수 없는 오류';
        let errorStack: string | undefined;
        if (releaseError instanceof Error) {
          errorMessage = releaseError.message;
          errorStack = releaseError.stack;
        }
        this.logger.error({
          message: 'Google 계정 연결 lease 해제 실패',
          errorMessage,
          errorStack,
          uid,
        });
      }
      throw error;
    }
  }

  // Google grant를 폐기한 뒤 같은 credential 문서를 삭제합니다.
  async revoke(uid: string): Promise<void> {
    const credential = await this.credentialRepository.find(uid);
    if (!credential) {
      await this.credentialRepository.deleteEmpty(uid);
      return;
    }

    const claim = await this.credentialRepository.claimRevocation(
      uid,
      credential,
    );
    try {
      await this.client.revokeOAuthToken(
        uid,
        credential.refreshToken ?? credential.accessToken,
      );
      await this.credentialRepository.deleteRevoked(uid, credential, claim);
    } catch (error) {
      await this.credentialRepository.releaseRevocation(uid, claim);
      throw error;
    }
  }

  // Google grant와 credential을 정리한 뒤 provider 연결을 해제합니다.
  async unlink(uid: string): Promise<void> {
    const user = await this.auth.getUser(uid);
    const providers = user.providerData ?? [];
    const hasGoogleProvider = providers.some(
      (provider) => provider.providerId === 'google.com',
    );
    if (hasGoogleProvider && providers.length <= 1) {
      throw lastProviderException;
    }

    await this.revoke(uid);
    if (hasGoogleProvider) {
      await this.auth.updateUser(uid, {
        providersToUnlink: ['google.com'],
      });
    }
  }
}
