// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Auth, type UserProvider } from 'firebase-admin/auth';

import { ApiException } from '../common/api.exception';
import { FIREBASE_AUTH_TOKEN } from '../firebase/firebase.tokens';
import { isAppleEmailVerified } from './apple-authentication.client';
import { type AppleTokenPayload } from './apple-authentication.types';

const providerId = 'apple.com';

// 다른 Firebase 사용자에게 연결된 Apple provider 오류입니다.
const linkConflictException = new ApiException(
  HttpStatus.CONFLICT,
  'apple-provider-link-conflict',
  'Apple provider가 다른 계정에 연결되어 있습니다.',
);
const emailNotFoundException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'email-not-found',
  '이메일을 찾을 수 없습니다.',
);
const emailMismatchException = new ApiException(
  HttpStatus.BAD_REQUEST,
  'email-mismatch',
  '이메일이 일치하지 않습니다.',
);

// Firebase Auth의 Apple provider 사용자 처리를 담당합니다.
@Injectable()
export class AppleProviderRepository {
  // Firebase Auth 저장 기능을 주입받습니다.
  constructor(@Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth) {}

  // Apple provider 또는 검증된 이메일로 Firebase uid를 결정합니다.
  async resolveUid(payload: AppleTokenPayload): Promise<string> {
    const ownerUid = await this.providerOwnerUid(payload.sub);
    if (ownerUid) {
      return ownerUid;
    }

    const email = verifiedAppleEmail(payload);
    if (!email) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'email-not-found',
        '이메일을 찾을 수 없습니다.',
      );
    }

    try {
      return (await this.auth.getUserByEmail(email)).uid;
    } catch (error) {
      if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') {
        throw error;
      }
    }

    try {
      return (
        await this.auth.createUser({
          email,
          emailVerified: true,
        })
      ).uid;
    } catch (error) {
      if (firebaseAuthErrorCode(error) === 'auth/email-already-exists') {
        return (await this.auth.getUserByEmail(email)).uid;
      }
      throw error;
    }
  }

  // 현재 사용자와 Apple 이메일 및 provider 소유권을 확인한 뒤 연결합니다.
  // prettier-ignore
  async link(
    uid: string,
    payload: AppleTokenPayload,
    credentialEmail?: string,
  ): Promise<void> {
    const user = await this.auth.getUser(uid);
    const ownerUid = await this.providerOwnerUid(payload.sub);
    const appleEmail = verifiedAppleEmail(payload) ?? credentialEmail;
    if (!user.email || !appleEmail) {
      throw emailNotFoundException;
    }
    if (user.email.toLowerCase() !== appleEmail.toLowerCase()) {
      throw emailMismatchException;
    }

    const currentProvider = user.providerData.find(
      (provider) => provider.providerId === providerId,
    );
    if (currentProvider && currentProvider.uid !== payload.sub) {
      throw linkConflictException;
    }

    if (ownerUid && ownerUid !== uid) {
      throw linkConflictException;
    }
    await this.ensureProvider(uid, payload);
  }

  // 선택된 Firebase 사용자에게 Apple provider가 없을 때 연결합니다.
  // prettier-ignore
  async ensureProvider(
    uid: string,
    payload: AppleTokenPayload,
  ): Promise<void> {
    const ownerUid = await this.providerOwnerUid(payload.sub);
    if (ownerUid === uid) {
      return;
    }
    if (ownerUid) {
      throw linkConflictException;
    }

    try {
      await this.auth.updateUser(uid, {
        providerToLink: appleProviderFrom(payload),
      });
    } catch (error) {
      const ownerUidAfterFailure = await this.providerOwnerUid(payload.sub);
      if (ownerUidAfterFailure === uid) {
        return;
      }
      if (ownerUidAfterFailure) {
        throw linkConflictException;
      }
      throw error;
    }
  }

  // Apple subject를 소유한 Firebase uid를 반환합니다.
  private async providerOwnerUid(subject: string): Promise<string | undefined> {
    try {
      return (await this.auth.getUserByProviderUid(providerId, subject)).uid;
    } catch (error) {
      if (firebaseAuthErrorCode(error) !== 'auth/user-not-found') {
        throw error;
      }
      return undefined;
    }
  }
}

// Apple ID token payload를 Firebase Auth provider 연결 형식으로 변환합니다.
function appleProviderFrom(payload: AppleTokenPayload): UserProvider {
  return {
    providerId,
    uid: payload.sub,
    email: payload.email,
  };
}

// 검증된 Apple 이메일 claim이 있을 때만 이메일을 반환합니다.
function verifiedAppleEmail(payload: AppleTokenPayload): string | undefined {
  return isAppleEmailVerified(payload) ? payload.email : undefined;
}

// Firebase Auth 예외에서 오류 code를 추출합니다.
function firebaseAuthErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' ? code : undefined;
}
