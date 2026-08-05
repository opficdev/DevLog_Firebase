import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { GoogleAuthenticationClient } from './google-authentication.client';
import { googleOAuthConfigurationProvider } from './google-authentication.configuration';
import { GoogleAuthenticationController } from './google-authentication.controller';
import { GoogleAuthenticationModule } from './google-authentication.module';
import { GoogleAuthenticationService } from './google-authentication.service';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

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

describe(GoogleAuthenticationModule.name, () => {
  it('FirebaseModule과 Google 인증 provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      GoogleAuthenticationModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      GoogleAuthenticationModule,
    ) as Provider[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      GoogleAuthenticationModule,
    ) as unknown[];

    expect(imports).toContain(FirebaseModule);
    expect(controllers).toContain(GoogleAuthenticationController);
    expect(providers).toEqual(
      expect.arrayContaining([
        googleOAuthConfigurationProvider,
        GoogleAuthenticationClient,
        GoogleAuthenticationService,
        GoogleCredentialRepository,
        GoogleProviderRepository,
      ]),
    );
  });
});
