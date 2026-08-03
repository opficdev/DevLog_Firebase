import { Module } from '@nestjs/common';

import { FirebaseModule } from './firebase/firebase.module';

/** 애플리케이션의 최상위 의존성 경계를 구성하는 모듈입니다. */
@Module({
  imports: [FirebaseModule],
})
export class AppModule {}
