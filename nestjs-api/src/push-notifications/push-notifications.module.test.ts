import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { PushNotificationsModule } from './push-notifications.module';
import { PushNotificationsRepository } from './push-notifications.repository';
import { PushNotificationsService } from './push-notifications.service';

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
}));

describe(PushNotificationsModule.name, () => {
  it('FirebaseModule과 PushNotification provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      PushNotificationsModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      PushNotificationsModule,
    ) as Provider[];

    expect(imports).toContain(FirebaseModule);
    expect(providers).toEqual(
      expect.arrayContaining([
        PushNotificationsRepository,
        PushNotificationsService,
      ]),
    );
  });
});
