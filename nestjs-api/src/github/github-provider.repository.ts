import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type Auth,
  type UpdateRequest,
  type UserProvider,
} from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { type GitHubUser } from './github-authentication.types';

const providerId = 'github.com';

// Firebase Auth의 GitHub provider 사용자 처리를 담당합니다.
@Injectable()
export class GitHubProviderRepository {
  // 신규 사용자 연결 보상 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GitHubProviderRepository.name);

  // Firebase Auth 저장 기능과 GitHub 사용자 조회 기능을 주입받습니다.
  constructor(
    @Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth,
    private readonly client: GitHubAuthenticationClient,
  ) {}

  // GitHub provider 또는 검증된 이메일로 Firebase uid를 결정합니다.
  async resolveUid(accessToken: string): Promise<string> {
    const user = await this.client.user(accessToken);
    const providerUid = githubProviderUid(user);
    try {
      const providerUser = await this.auth.getUserByProviderUid(
        providerId,
        providerUid,
      );
      const email = await this.client.verifiedEmail(accessToken);
      const update: UpdateRequest = {
        displayName: user.name || user.login,
        photoURL: user.avatar_url ?? null,
      };
      const githubOnly = providerUser.providerData.every(
        (provider) => provider.providerId === providerId,
      );
      if (githubOnly && email) {
        try {
          const emailUser = await this.auth.getUserByEmail(email);
          if (emailUser.uid === providerUser.uid) {
            update.email = email;
          }
        } catch (error) {
          if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') {
            throw error;
          }
          update.email = email;
        }
      }
      await this.auth.updateUser(providerUser.uid, update);
      return providerUser.uid;
    } catch (error) {
      if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') {
        throw error;
      }
    }

    const email = await this.client.verifiedEmail(accessToken);
    if (!email) {
      throw emailNotFoundException;
    }
    const providerToLink = githubProvider(providerUid, email, user);
    try {
      const emailUser = await this.auth.getUserByEmail(email);
      await this.auth.updateUser(emailUser.uid, {
        displayName: user.name || user.login,
        photoURL: user.avatar_url ?? null,
        providerToLink,
      });
      return emailUser.uid;
    } catch (error) {
      if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') {
        throw error;
      }
    }

    const createdUser = await this.auth.createUser({
      displayName: user.name || user.login,
      email,
      photoURL: user.avatar_url,
    });
    try {
      await this.auth.updateUser(createdUser.uid, { providerToLink });
      return createdUser.uid;
    } catch (error) {
      try {
        await this.auth.deleteUser(createdUser.uid);
      } catch (cleanupError) {
        this.logger.error({
          message: 'GitHub provider 연결 실패 사용자 정리 실패',
          errorMessage:
            cleanupError instanceof Error
              ? cleanupError.message
              : '알 수 없는 오류',
          errorStack:
            cleanupError instanceof Error ? cleanupError.stack : undefined,
          uid: createdUser.uid,
        });
      }
      throw error;
    }
  }
}

// GitHub user id를 Firebase provider uid 문자열로 변환합니다.
function githubProviderUid(user: GitHubUser): string {
  if (!user.id) {
    throw emailNotFoundException;
  }
  return String(user.id);
}

// GitHub 사용자 정보를 Firebase Auth provider 형식으로 구성합니다.
function githubProvider(
  uid: string,
  email: string,
  user: GitHubUser,
): UserProvider {
  return {
    providerId,
    uid,
    displayName: user.name || user.login,
    email,
    photoURL: user.avatar_url,
  };
}

// Firebase Auth 예외에서 오류 코드를 반환합니다.
function firebaseAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}

const emailNotFoundException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'email-not-found',
  'GitHub 사용자 데이터를 가져오지 못했습니다.',
);
