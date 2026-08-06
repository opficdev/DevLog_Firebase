import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';
import { GitHubAuthenticationController } from './github-authentication.controller';
import { GitHubAuthenticationModule } from './github-authentication.module';
import { GitHubAuthenticationService } from './github-authentication.service';

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

describe(GitHubAuthenticationModule.name, () => {
  it('FirebaseModule과 GitHub 인증 provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      GitHubAuthenticationModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      GitHubAuthenticationModule,
    ) as Provider[];
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      GitHubAuthenticationModule,
    ) as unknown[];

    expect(imports).toContain(FirebaseModule);
    expect(controllers).toContain(GitHubAuthenticationController);
    expect(providers).toEqual(
      expect.arrayContaining([
        GitHubAuthenticationClient,
        GitHubAuthenticationConfigurationProvider,
        GitHubAuthenticationService,
        OAuthSessionRepository,
      ]),
    );
  });
});
