import { FactoryProvider } from '@nestjs/common';
import {
  applicationDefault,
  type App,
  getApps,
  initializeApp,
} from 'firebase-admin/app';

import { FIREBASE_APP_TOKEN } from './firebase.tokens';

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
