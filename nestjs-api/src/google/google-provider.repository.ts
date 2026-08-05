import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Auth, type UpdateRequest } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { type GoogleTokenPayload } from './google-authentication.types';

const providerId = 'google.com';

// 다른 Firebase 사용자에게 연결된 Google provider 오류입니다.
const linkConflictException = new ApiException(
  HttpStatus.CONFLICT,
  'google-provider-link-conflict',
  'Google provider가 다른 계정에 연결되어 있습니다.',
);

// Firebase Auth의 Google provider 사용자 처리를 담당합니다.
@Injectable()
export class GoogleProviderRepository {
  // 사용자 생성 보상 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GoogleProviderRepository.name);

  // Firebase Auth 저장 기능을 주입받습니다.
  constructor(@Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth) {}

  // Google provider 또는 검증된 이메일로 Firebase uid를 결정합니다.
  async resolveUid(payload: GoogleTokenPayload): Promise<string> {
    try {
      const user = await this.auth.getUserByProviderUid(
        providerId,
        payload.sub,
      );
      const update: UpdateRequest = {
        displayName: payload.name ?? null,
        photoURL: payload.picture ?? null,
      };
      const googleOnly = user.providerData.every(
        (provider) => provider.providerId === providerId,
      );
      const email =
        payload.email_verified === true && payload.email
          ? payload.email
          : undefined;
      if (googleOnly && email) {
        try {
          const emailUser = await this.auth.getUserByEmail(email);
          if (emailUser.uid === user.uid) {
            update.email = email;
          }
        } catch (error) {
          const code =
            error && typeof error === 'object'
              ? (error as Record<string, unknown>).code
              : undefined;
          if (code !== 'auth/user-not-found') {
            throw error;
          }
          update.email = email;
        }
      }
      await this.auth.updateUser(user.uid, update);
      return user.uid;
    } catch (error) {
      const code =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).code
          : undefined;
      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }

    const email =
      payload.email_verified === true && payload.email
        ? payload.email
        : undefined;
    if (!email) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'email-not-found',
        'Google 사용자 이메일을 확인할 수 없습니다.',
      );
    }
    const providerToLink = {
      providerId,
      uid: payload.sub,
      displayName: payload.name,
      email,
      photoURL: payload.picture,
    };
    try {
      const user = await this.auth.getUserByEmail(email);
      await this.auth.updateUser(user.uid, {
        displayName: payload.name ?? null,
        photoURL: payload.picture ?? null,
        providerToLink,
      });
      return user.uid;
    } catch (error) {
      const code =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).code
          : undefined;
      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }

    const user = await this.auth.createUser({
      displayName: payload.name,
      email,
      photoURL: payload.picture,
    });
    try {
      await this.auth.updateUser(user.uid, { providerToLink });
    } catch (error) {
      try {
        await this.auth.deleteUser(user.uid);
      } catch (deleteError) {
        this.logger.error(
          'Google provider 연결 실패 사용자 정리 실패',
          deleteError,
        );
      }
      throw error;
    }
    return user.uid;
  }

  // 현재 Firebase 사용자에게 Google provider를 연결합니다.
  async link(uid: string, payload: GoogleTokenPayload): Promise<boolean> {
    const currentUser = await this.auth.getUser(uid);
    const currentProvider = currentUser.providerData.find(
      (provider) => provider.providerId === providerId,
    );
    if (currentProvider && currentProvider.uid !== payload.sub) {
      throw linkConflictException;
    }

    let didLink = !currentProvider;
    try {
      const user = await this.auth.getUserByProviderUid(
        providerId,
        payload.sub,
      );
      if (user.uid !== uid) {
        throw linkConflictException;
      }
      didLink = false;
    } catch (error) {
      const code =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).code
          : undefined;
      if (code !== 'auth/user-not-found') {
        throw error;
      }
    }

    const email =
      payload.email_verified === true && payload.email
        ? payload.email
        : undefined;
    if (!email) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'email-not-found',
        'Google 사용자 이메일을 확인할 수 없습니다.',
      );
    }
    if (currentUser.email !== email) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'email-mismatch',
        '이메일이 일치하지 않습니다.',
      );
    }
    await this.auth.updateUser(uid, {
      providerToLink: {
        providerId,
        uid: payload.sub,
        displayName: payload.name,
        email,
        photoURL: payload.picture,
      },
    });
    return didLink;
  }
}
