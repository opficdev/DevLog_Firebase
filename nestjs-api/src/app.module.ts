import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { FirebaseAuthGuard } from './auth/firebase-auth.guard';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { FirebaseModule } from './firebase/firebase.module';

/** 애플리케이션의 최상위 의존성 경계를 구성하는 모듈입니다. */
@Module({
  imports: [FirebaseModule],
  providers: [
    { provide: APP_GUARD, useClass: FirebaseAuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
