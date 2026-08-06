// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { AppleAuthenticationClient } from './apple-authentication.client';
import { type AppleTokenPayload } from './apple-authentication.types';
import { AppleChallengeRepository } from './apple-challenge.repository';
import { AppleCredentialRepository } from './apple-credential.repository';
import { AppleProfileRepository } from './apple-profile.repository';
import { AppleProviderRepository } from './apple-provider.repository';

// Apple 교환 응답에 ID token이 없는 오류입니다.
const missingIdTokenException = new ApiException(
  HttpStatus.UNAUTHORIZED,
  'invalid-apple-proof',
  'Apple 교환 응답에 ID token이 없습니다.',
);

// Apple 인증과 Firebase 사용자 연결, credential 처리를 조정합니다.
@Injectable()
export class AppleAuthenticationService {
  // Apple challenge 인증 처리에 필요한 의존성을 주입받습니다.
  // prettier-ignore
  constructor(
    @Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth,
    private readonly client: AppleAuthenticationClient,
    private readonly challengeRepository: AppleChallengeRepository,
    private readonly providerRepository: AppleProviderRepository,
    private readonly profileRepository: AppleProfileRepository,
    private readonly credentialRepository: AppleCredentialRepository,
  ) {}

  // challenge 기반 Apple 인증 증명으로 Firebase custom token을 생성합니다.
  // prettier-ignore
  async requestCustomTokenWithChallenge(
    challengeId: string,
    authorizationCode: string,
    displayName?: string,
  ): Promise<string> {
    const expectedHashedNonce = await this.challengeRepository.consume(
      challengeId,
    );
    const tokens = await this.client.exchangeAuthorizationCode(
      authorizationCode,
    );
    if (!tokens.idToken) {
      await this.client.revokeExchangedTokens(tokens);
      throw missingIdTokenException;
    }

    let payload: AppleTokenPayload;
    try {
      payload = await this.client.verifyIdToken(
        tokens.idToken,
        expectedHashedNonce,
      );
    } catch (error) {
      await this.client.revokeExchangedTokens(tokens);
      throw error;
    }

    const refreshToken = await this.client.requiredRefreshToken(tokens);
    let uid: string;
    try {
      uid = await this.providerRepository.resolveUid(payload);
    } catch (error) {
      await this.client.revokeExchangedTokens(tokens);
      throw error;
    }

    try {
      await this.providerRepository.ensureProvider(uid, payload);
      await this.profileRepository.update(uid, displayName);
      await this.credentialRepository.save(uid, refreshToken);
    } catch (error) {
      await this.client.revokeExchangedTokens(tokens);
      throw error;
    }

    return this.auth.createCustomToken(uid);
  }

  // 기존 ID token 요청 형식으로 Firebase custom token을 생성합니다.
  // prettier-ignore
  async requestCustomTokenWithIdToken(
    idToken: string,
    authorizationCode: string,
  ): Promise<string> {
    const payload = await this.client.verifyIdToken(idToken);
    const uid = await this.providerRepository.resolveUid(payload);
    await this.providerRepository.ensureProvider(uid, payload);
    const tokens = await this.client.exchangeAuthorizationCode(
      authorizationCode,
    );
    const refreshToken = await this.client.requiredRefreshToken(tokens);
    try {
      await this.credentialRepository.save(uid, refreshToken);
    } catch (error) {
      await this.client.revokeExchangedTokens(tokens);
      throw error;
    }

    return this.auth.createCustomToken(uid);
  }
}
