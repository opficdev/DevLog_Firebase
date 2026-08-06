import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { AppleAuthenticationClient } from './apple-authentication.client';
import { appleAuthenticationConfigurationProvider } from './apple-authentication.configuration';
import { AppleAuthenticationController } from './apple-authentication.controller';
import { AppleAuthenticationService } from './apple-authentication.service';
import { AppleChallengeRepository } from './apple-challenge.repository';
import { AppleCredentialRepository } from './apple-credential.repository';
import { AppleProfileRepository } from './apple-profile.repository';
import { AppleProviderRepository } from './apple-provider.repository';

// Apple 로그인 요청과 외부·저장소 의존성 경계를 구성합니다.
@Module({
  imports: [FirebaseModule],
  controllers: [AppleAuthenticationController],
  providers: [
    appleAuthenticationConfigurationProvider,
    AppleAuthenticationClient,
    AppleAuthenticationService,
    AppleChallengeRepository,
    AppleCredentialRepository,
    AppleProfileRepository,
    AppleProviderRepository,
  ],
})
export class AppleAuthenticationModule {}
