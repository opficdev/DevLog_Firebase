import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { WebPagesRepository } from './web-pages.repository';
import { WebPagesService } from './web-pages.service';

/** WebPage 업무 규칙과 Firestore 저장 동작의 의존성 경계입니다. */
@Module({
  imports: [FirebaseModule],
  providers: [WebPagesRepository, WebPagesService],
})
export class WebPagesModule {}
