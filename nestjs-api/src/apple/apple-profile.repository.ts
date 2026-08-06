// prettier-ignore
import {
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';
import { type Firestore } from 'firebase-admin/firestore';

import { ApiException } from '../common/api.exception';
import {
  FIREBASE_AUTH_TOKEN,
  FIREBASE_FIRESTORE_TOKEN,
} from '../firebase/firebase.tokens';

// Apple 프로필 이름을 찾을 수 없는 오류입니다.
const profileIncompleteException = new ApiException(
  HttpStatus.PRECONDITION_FAILED,
  'apple-profile-incomplete',
  'Apple 프로필 이름을 찾을 수 없습니다.',
);

// Apple 인증 사용자의 Firebase Auth 프로필 완성을 담당합니다.
@Injectable()
export class AppleProfileRepository {
  // Firestore와 Firebase Auth 의존성을 주입받습니다.
  // prettier-ignore
  constructor(
    @Inject(FIREBASE_FIRESTORE_TOKEN) private readonly firestore: Firestore,
    @Inject(FIREBASE_AUTH_TOKEN) private readonly auth: Auth,
  ) {}

  // 요청, Firestore, Firebase Auth 순서로 이름을 선택해 프로필에 반영합니다.
  // prettier-ignore
  async update(
    uid: string,
    displayName?: string,
  ): Promise<void> {
    let selectedDisplayName = normalizedDisplayName(displayName);
    if (!selectedDisplayName) {
      const snapshot = await this.firestore
        .doc(`users/${uid}/userData/info`)
        .get();
      selectedDisplayName = normalizedDisplayName(snapshot.data()?.appleName);
    }

    if (!selectedDisplayName) {
      const user = await this.auth.getUser(uid);
      selectedDisplayName = normalizedDisplayName(user.displayName);
      if (
        selectedDisplayName &&
        user.displayName === selectedDisplayName &&
        !user.photoURL
      ) {
        return;
      }
    }

    if (!selectedDisplayName) {
      throw profileIncompleteException;
    }

    await this.auth.updateUser(uid, {
      displayName: selectedDisplayName,
      photoURL: null,
    });
  }
}

// 공백이 아닌 문자열을 앞뒤 공백을 제거해 반환합니다.
function normalizedDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const displayName = value.trim();
  return displayName || undefined;
}
