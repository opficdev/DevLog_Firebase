import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { AppleAuthenticationClient } from './apple-authentication.client';
import { appleAuthenticationConfigurationProvider } from './apple-authentication.configuration';
import { AppleAuthenticationController } from './apple-authentication.controller';
import { AppleAuthenticationModule } from './apple-authentication.module';
import { AppleAuthenticationService } from './apple-authentication.service';
import { AppleChallengeRepository } from './apple-challenge.repository';
import { AppleCredentialRepository } from './apple-credential.repository';
import { AppleProfileRepository } from './apple-profile.repository';
import { AppleProviderRepository } from './apple-provider.repository';

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

describe(AppleAuthenticationModule.name, () => {
  it('FirebaseModule과 Apple 인증 provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AppleAuthenticationModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AppleAuthenticationModule,
    ) as Provider[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      AppleAuthenticationModule,
    ) as unknown[];

    expect(imports).toContain(FirebaseModule);
    expect(controllers).toContain(AppleAuthenticationController);
    expect(providers).toEqual(
      expect.arrayContaining([
        appleAuthenticationConfigurationProvider,
        AppleAuthenticationClient,
        AppleAuthenticationService,
        AppleChallengeRepository,
        AppleCredentialRepository,
        AppleProfileRepository,
        AppleProviderRepository,
      ]),
    );
  });
});
