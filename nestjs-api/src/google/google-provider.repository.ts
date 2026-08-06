import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type Auth,
  type UpdateRequest,
  type UserRecord,
} from 'firebase-admin/auth';

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
  // Firebase Auth 저장 기능을 주입받습니다.
  constructor(@Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth) {}

  // Google provider 또는 검증된 이메일로 Firebase uid를 결정합니다.
  async resolveUid(payload: GoogleTokenPayload): Promise<string> {
    // 연결된 Google provider 사용자를 우선 조회합니다.
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
        // 검증된 이메일을 현재 사용자에게 갱신할 수 있는지 확인합니다.
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
    let user: UserRecord;
    // 검증된 이메일을 사용하는 기존 Firebase 사용자를 조회합니다.
    try {
      user = await this.auth.getUserByEmail(email);
    } catch (error) {
      const code =
        error && typeof error === 'object'
          ? (error as Record<string, unknown>).code
          : undefined;
      if (code !== 'auth/user-not-found') {
        throw error;
      }
      // 기존 사용자가 없으면 새 Firebase 사용자를 생성합니다.
      try {
        user = await this.auth.createUser({
          displayName: payload.name,
          email,
          photoURL: payload.picture,
        });
      } catch (createError) {
        const createCode =
          createError && typeof createError === 'object'
            ? (createError as Record<string, unknown>).code
            : undefined;
        if (createCode !== 'auth/email-already-exists') {
          throw createError;
        }
        user = await this.auth.getUserByEmail(email);
      }
    }
    // 결정한 Firebase 사용자에게 Google provider를 연결합니다.
    try {
      await this.auth.updateUser(user.uid, {
        displayName: payload.name ?? null,
        photoURL: payload.picture ?? null,
        providerToLink,
      });
      return user.uid;
    } catch (error) {
      // 연결 실패 후 Google provider의 현재 소유자를 다시 조회합니다.
      try {
        const providerUser = await this.auth.getUserByProviderUid(
          providerId,
          payload.sub,
        );
        return providerUser.uid;
      } catch (providerError) {
        const providerCode =
          providerError && typeof providerError === 'object'
            ? (providerError as Record<string, unknown>).code
            : undefined;
        if (providerCode !== 'auth/user-not-found') {
          throw providerError;
        }
      }
      throw error;
    }
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
