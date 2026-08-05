import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { WebPagesController } from './web-pages.controller';
import { WebPagesModule } from './web-pages.module';
import { WebPagesRepository } from './web-pages.repository';
import { WebPagesService } from './web-pages.service';

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

describe(WebPagesModule.name, () => {
  it('FirebaseModule과 WebPage provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      WebPagesModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      WebPagesModule,
    ) as Provider[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      WebPagesModule,
    ) as unknown[];

    expect(imports).toContain(FirebaseModule);
    expect(controllers).toContain(WebPagesController);
    expect(providers).toEqual(
      expect.arrayContaining([WebPagesRepository, WebPagesService]),
    );
  });
});
