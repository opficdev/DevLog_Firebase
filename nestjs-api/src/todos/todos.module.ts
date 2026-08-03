import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { TodosRepository } from './todos.repository';
import { TodosService } from './todos.service';

/** Todo 업무 규칙과 Firestore 저장 동작의 의존성 경계입니다. */
@Module({
  imports: [FirebaseModule],
  providers: [TodosRepository, TodosService],
})
export class TodosModule {}
