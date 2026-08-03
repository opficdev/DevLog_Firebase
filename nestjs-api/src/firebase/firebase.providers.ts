import { FactoryProvider } from '@nestjs/common';
import {
  applicationDefault,
  type App,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';

import { FIREBASE_APP_TOKEN, FIREBASE_AUTH_TOKEN } from './firebase.tokens';

/** 기존 기본 인스턴스를 재사용하거나 ADC로 새 인스턴스를 초기화합니다. */
function createFirebaseApp(): App {
  const app = getApps().find(({ name }) => name === '[DEFAULT]');

  return app ?? initializeApp({ credential: applicationDefault() });
}

/** NestJS 의존성 컨테이너에 Firebase App 인스턴스를 제공합니다. */
export const firebaseAppProvider: FactoryProvider<App> = {
  provide: FIREBASE_APP_TOKEN,
  useFactory: createFirebaseApp,
};

/** 주입받은 Firebase App에 연결된 Auth 인스턴스를 생성합니다. */
function createFirebaseAuth(app: App): Auth {
  return getAuth(app);
}

/** NestJS 의존성 컨테이너에 Firebase Auth 인스턴스를 제공합니다. */
export const firebaseAuthProvider: FactoryProvider<Auth> = {
  provide: FIREBASE_AUTH_TOKEN,
  inject: [FIREBASE_APP_TOKEN],
  useFactory: createFirebaseAuth,
};
