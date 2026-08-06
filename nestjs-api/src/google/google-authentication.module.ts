import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { GoogleAuthenticationClient } from './google-authentication.client';
import { googleOAuthConfigurationProvider } from './google-authentication.configuration';
import { GoogleAuthenticationController } from './google-authentication.controller';
import { GoogleAuthenticationService } from './google-authentication.service';
import { GoogleCredentialRepository } from './google-credential.repository';
import { GoogleProviderRepository } from './google-provider.repository';

// Google 인증 요청과 외부·저장소 의존성 경계를 구성합니다.
@Module({
  imports: [FirebaseModule],
  controllers: [GoogleAuthenticationController],
  providers: [
    googleOAuthConfigurationProvider,
    GoogleAuthenticationClient,
    GoogleAuthenticationService,
    GoogleCredentialRepository,
    GoogleProviderRepository,
  ],
})
export class GoogleAuthenticationModule {}
