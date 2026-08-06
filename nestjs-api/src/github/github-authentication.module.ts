import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { OAuthSessionRepository } from '../oauth/oauth-session.repository';
import { GitHubAuthenticationClient } from './github-authentication.client';
import { GitHubAuthenticationConfigurationProvider } from './github-authentication.configuration';
import { GitHubAuthenticationController } from './github-authentication.controller';
import { GitHubAuthenticationService } from './github-authentication.service';

// GitHub 인증 요청과 외부·저장소 의존성 경계를 구성합니다.
@Module({
  imports: [FirebaseModule],
  controllers: [GitHubAuthenticationController],
  providers: [
    GitHubAuthenticationClient,
    GitHubAuthenticationConfigurationProvider,
    GitHubAuthenticationService,
    OAuthSessionRepository,
  ],
})
export class GitHubAuthenticationModule {}
