import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { ApiException } from '../common/api.exception';
import { PushNotificationsService } from './push-notifications.service';

// PushNotification 삭제 요청과 취소 HTTP 경계를 제공합니다.
@Controller('push-notifications')
export class PushNotificationsController {
  // PushNotification 삭제 업무 규칙을 제공하는 의존성을 주입받습니다.
  constructor(private readonly service: PushNotificationsService) {}

  // 인증된 사용자의 PushNotification 삭제 요청을 처리합니다.
  @Post(':id/deletion-request')
  @HttpCode(HttpStatus.OK)
  async requestDeletion(
    @Req() request: FirebaseAuthenticatedRequest,
    @Param('id') notificationId: string,
  ): Promise<{ success: true }> {
    await this.service.requestDeletion(
      requiredUid(request),
      requiredNotificationId(notificationId),
    );

    return { success: true };
  }

  // 인증된 사용자의 PushNotification 삭제 취소 요청을 처리합니다.
  @Delete(':id/deletion-request')
  async undoDeletion(
    @Req() request: FirebaseAuthenticatedRequest,
    @Param('id') notificationId: string,
  ): Promise<{ success: true }> {
    await this.service.undoDeletion(
      requiredUid(request),
      requiredNotificationId(notificationId),
    );

    return { success: true };
  }
}

// 인증 Guard가 확인한 사용자 식별자를 반환합니다.
function requiredUid(request: FirebaseAuthenticatedRequest): string {
  if (!request.uid) {
    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      'unauthenticated',
      '인증된 사용자가 아닙니다.',
    );
  }

  return request.uid;
}

// 앞뒤 공백을 제거한 PushNotification 식별자를 반환합니다.
function requiredNotificationId(notificationId: string): string {
  const trimmedNotificationId = notificationId.trim();
  if (!trimmedNotificationId) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'invalid-argument',
      'id가 필요합니다.',
    );
  }

  return trimmedNotificationId;
}
