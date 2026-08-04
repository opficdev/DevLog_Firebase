import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { PushNotificationsController } from './push-notifications.controller';
import { PushNotificationsRepository } from './push-notifications.repository';
import { PushNotificationsService } from './push-notifications.service';

/** PushNotification 업무 규칙과 Firestore 저장 동작의 의존성 경계입니다. */
@Module({
  imports: [FirebaseModule],
  controllers: [PushNotificationsController],
  providers: [PushNotificationsRepository, PushNotificationsService],
})
export class PushNotificationsModule {}
