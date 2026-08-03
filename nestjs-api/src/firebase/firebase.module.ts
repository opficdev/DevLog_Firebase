import { Module } from '@nestjs/common';

import {
  firebaseAppProvider,
  firebaseAuthProvider,
} from './firebase.providers';
import { FIREBASE_APP_TOKEN, FIREBASE_AUTH_TOKEN } from './firebase.tokens';

/** Firebase Admin 의존성을 사용하는 모듈에 제공하는 경계입니다. */
@Module({
  providers: [firebaseAppProvider, firebaseAuthProvider],
  exports: [FIREBASE_APP_TOKEN, FIREBASE_AUTH_TOKEN],
})
export class FirebaseModule {}
