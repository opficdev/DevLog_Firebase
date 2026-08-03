// prettier-ignore
import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import { ApiException } from '../common/api.exception';
import { TodosRepository } from './todos.repository';

/** Todo 삭제 요청과 취소 업무 규칙을 조정합니다. */
@Injectable()
export class TodosService {
  /** Todo 삭제 처리 실패 원인을 기록하는 로그 기능입니다. */
  private readonly logger = new Logger(TodosService.name);

  /** Todo 저장 동작을 제공하는 의존성을 주입받습니다. */
  constructor(private readonly repository: TodosRepository) {}

  /** 유효한 Todo와 연결 알림에 삭제 요청 상태를 기록합니다. */
  // prettier-ignore
  async requestDeletion(
    uid: string,
    todoId: string,
  ): Promise<void> {
    const state = await this.repository.getTodoDeletionState(uid, todoId);
    if (state !== 'active') {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'not-found',
        'Todo를 찾을 수 없습니다.',
      );
    }

    try {
      await this.repository.markTodoDeletionRequested(uid, todoId);
      await this.repository.markNotificationsDeleted(uid, todoId);
    } catch (error) {
      const currentState = await this.repository.getTodoDeletionState(
        uid,
        todoId,
      );
      if (currentState === 'deleted') {
        await this.repository.restoreTodoDeletion(uid, todoId);
      }

      await this.repository.restoreNotifications(uid, todoId);

      this.logger.error('Todo 삭제 요청 실패', error, { uid, todoId });
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        'Todo 삭제 요청에 실패했습니다.',
      );
    }
  }
}
