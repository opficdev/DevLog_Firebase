// prettier-ignore
import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import { ApiException } from '../common/api.exception';
import { PushNotificationsRepository } from './push-notifications.repository';

// PushNotification 삭제 요청과 취소 업무 규칙을 조정합니다.
@Injectable()
export class PushNotificationsService {
  // PushNotification 삭제 처리 실패 원인을 기록하는 로그 기능입니다.
  private readonly logger = new Logger(PushNotificationsService.name);

  // PushNotification 저장 동작을 제공하는 의존성을 주입받습니다.
  constructor(private readonly repository: PushNotificationsRepository) {}

  // 유효한 PushNotification에 삭제 요청 상태를 기록합니다.
  // prettier-ignore
  async requestDeletion(
    uid: string,
    notificationId: string,
  ): Promise<void> {
    const state = await this.repository.getPushNotificationDeletionState(
      uid,
      notificationId,
    );
    if (state !== 'active') {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'not-found',
        'Notification을 찾을 수 없습니다.',
      );
    }

    try {
      await this.repository.markPushNotificationDeletionRequested(
        uid,
        notificationId,
      );
    } catch (error) {
      await this.cleanupDeletionRequest(uid, notificationId);

      this.logger.error({
        message: '푸시 알림 삭제 요청 실패',
        errorMessage: error instanceof Error ? error.message : '알 수 없는 오류',
        errorStack: error instanceof Error ? error.stack : undefined,
        uid,
        notificationId,
      });
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '푸시 알림 삭제 요청에 실패했습니다.',
      );
    }
  }

  // PushNotification이 없거나 활성 상태여도 삭제 취소를 성공으로 처리합니다.
  // prettier-ignore
  async undoDeletion(
    uid: string,
    notificationId: string,
  ): Promise<void> {
    try {
      const state = await this.repository.getPushNotificationDeletionState(
        uid,
        notificationId,
      );
      if (state === 'deleted') {
        await this.repository.restorePushNotificationDeletion(
          uid,
          notificationId,
        );
      }
    } catch (error) {
      this.logger.error({
        message: '푸시 알림 삭제 취소 실패',
        errorMessage: error instanceof Error ? error.message : '알 수 없는 오류',
        errorStack: error instanceof Error ? error.stack : undefined,
        uid,
        notificationId,
      });
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '푸시 알림 삭제 취소에 실패했습니다.',
      );
    }
  }

  // 삭제 요청 실패 후 현재 문서가 삭제 상태이면 복구합니다.
  private async cleanupDeletionRequest(
    uid: string,
    notificationId: string,
  ): Promise<void> {
    try {
      const state = await this.repository.getPushNotificationDeletionState(
        uid,
        notificationId,
      );
      if (state === 'deleted') {
        await this.repository.restorePushNotificationDeletion(
          uid,
          notificationId,
        );
      }
    } catch (error) {
      this.logger.error({
        message: '푸시 알림 삭제 요청 cleanup 실패',
        errorMessage:
          error instanceof Error ? error.message : '알 수 없는 오류',
        errorStack: error instanceof Error ? error.stack : undefined,
        uid,
        notificationId,
      });
    }
  }
}
