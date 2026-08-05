import { HttpStatus, Logger } from '@nestjs/common';

import { PushNotificationsRepository } from './push-notifications.repository';
import { PushNotificationsService } from './push-notifications.service';

describe(PushNotificationsService.name, () => {
  const uid = 'user-1';
  const notificationId = 'notification-1';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('활성 PushNotification에 삭제 요청 상태를 기록한다', async () => {
    const sequence: string[] = [];
    const getPushNotificationDeletionState = jest
      .fn()
      .mockImplementation(() => {
        sequence.push('PushNotification 상태 조회');
        return Promise.resolve('active');
      });
    const markPushNotificationDeletionRequested = jest
      .fn()
      .mockImplementation(() => {
        sequence.push('PushNotification 삭제 요청');
        return Promise.resolve();
      });
    const repository = {
      getPushNotificationDeletionState,
      markPushNotificationDeletionRequested,
    } as unknown as PushNotificationsRepository;
    const service = new PushNotificationsService(repository);

    await expect(
      service.requestDeletion(uid, notificationId),
    ).resolves.toBeUndefined();

    expect(sequence).toEqual([
      'PushNotification 상태 조회',
      'PushNotification 삭제 요청',
    ]);
  });

  it.each(['missing', 'deleted'])(
    '%s PushNotification 삭제 요청을 거부한다',
    async (state) => {
      const getPushNotificationDeletionState = jest
        .fn()
        .mockResolvedValue(state);
      const markPushNotificationDeletionRequested = jest.fn();
      const repository = {
        getPushNotificationDeletionState,
        markPushNotificationDeletionRequested,
      } as unknown as PushNotificationsRepository;
      const service = new PushNotificationsService(repository);

      await expect(
        service.requestDeletion(uid, notificationId),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: {
          code: 'not-found',
          message: 'Notification을 찾을 수 없습니다.',
        },
      });
      expect(markPushNotificationDeletionRequested).not.toHaveBeenCalled();
    },
  );

  it('삭제 요청 실패 시 PushNotification을 재조회하고 복구한다', async () => {
    const sequence: string[] = [];
    const error = new Error('PushNotification 쓰기 실패');
    const getPushNotificationDeletionState = jest
      .fn()
      .mockImplementationOnce(() => {
        sequence.push('PushNotification 상태 조회');
        return Promise.resolve('active');
      })
      .mockImplementationOnce(() => {
        sequence.push('PushNotification 상태 재조회');
        return Promise.resolve('deleted');
      });
    const markPushNotificationDeletionRequested = jest
      .fn()
      .mockImplementation(() => {
        sequence.push('PushNotification 삭제 요청');
        return Promise.reject(error);
      });
    const restorePushNotificationDeletion = jest.fn().mockImplementation(() => {
      sequence.push('PushNotification 복구');
      return Promise.resolve();
    });
    const repository = {
      getPushNotificationDeletionState,
      markPushNotificationDeletionRequested,
      restorePushNotificationDeletion,
    } as unknown as PushNotificationsRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new PushNotificationsService(repository);

    await expect(
      service.requestDeletion(uid, notificationId),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: {
        code: 'internal',
        message: '푸시 알림 삭제 요청에 실패했습니다.',
      },
    });
    expect(sequence).toEqual([
      'PushNotification 상태 조회',
      'PushNotification 삭제 요청',
      'PushNotification 상태 재조회',
      'PushNotification 복구',
    ]);
    expect(loggerError).toHaveBeenCalledWith(
      '푸시 알림 삭제 요청 실패',
      error,
      { uid, notificationId },
    );
  });

  it('cleanup 실패를 기록하고 원래 삭제 요청 오류를 반환한다', async () => {
    const deletionError = new Error('PushNotification 쓰기 실패');
    const cleanupError = new Error('PushNotification 복구 실패');
    const getPushNotificationDeletionState = jest
      .fn()
      .mockResolvedValueOnce('active')
      .mockResolvedValueOnce('deleted');
    const repository = {
      getPushNotificationDeletionState,
      markPushNotificationDeletionRequested: jest
        .fn()
        .mockRejectedValue(deletionError),
      restorePushNotificationDeletion: jest
        .fn()
        .mockRejectedValue(cleanupError),
    } as unknown as PushNotificationsRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new PushNotificationsService(repository);

    await expect(
      service.requestDeletion(uid, notificationId),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: {
        code: 'internal',
        message: '푸시 알림 삭제 요청에 실패했습니다.',
      },
    });
    expect(loggerError).toHaveBeenNthCalledWith(
      1,
      '푸시 알림 삭제 요청 cleanup 실패',
      cleanupError,
      { uid, notificationId },
    );
    expect(loggerError).toHaveBeenNthCalledWith(
      2,
      '푸시 알림 삭제 요청 실패',
      deletionError,
      { uid, notificationId },
    );
  });

  it('삭제 상태인 PushNotification을 복구한다', async () => {
    const getPushNotificationDeletionState = jest
      .fn()
      .mockResolvedValue('deleted');
    const restorePushNotificationDeletion = jest
      .fn()
      .mockResolvedValue(undefined);
    const repository = {
      getPushNotificationDeletionState,
      restorePushNotificationDeletion,
    } as unknown as PushNotificationsRepository;
    const service = new PushNotificationsService(repository);

    await expect(
      service.undoDeletion(uid, notificationId),
    ).resolves.toBeUndefined();

    expect(restorePushNotificationDeletion).toHaveBeenCalledWith(
      uid,
      notificationId,
    );
  });

  it.each(['missing', 'active'])(
    '%s PushNotification 삭제 취소를 성공으로 처리한다',
    async (state) => {
      const getPushNotificationDeletionState = jest
        .fn()
        .mockResolvedValue(state);
      const restorePushNotificationDeletion = jest.fn();
      const repository = {
        getPushNotificationDeletionState,
        restorePushNotificationDeletion,
      } as unknown as PushNotificationsRepository;
      const service = new PushNotificationsService(repository);

      await expect(
        service.undoDeletion(uid, notificationId),
      ).resolves.toBeUndefined();

      expect(restorePushNotificationDeletion).not.toHaveBeenCalled();
    },
  );

  it('삭제 취소 실패를 internal 오류로 변환한다', async () => {
    const error = new Error('PushNotification 복구 실패');
    const repository = {
      getPushNotificationDeletionState: jest.fn().mockResolvedValue('deleted'),
      restorePushNotificationDeletion: jest.fn().mockRejectedValue(error),
    } as unknown as PushNotificationsRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new PushNotificationsService(repository);

    await expect(
      service.undoDeletion(uid, notificationId),
    ).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: {
        code: 'internal',
        message: '푸시 알림 삭제 취소에 실패했습니다.',
      },
    });
    expect(loggerError).toHaveBeenCalledWith(
      '푸시 알림 삭제 취소 실패',
      error,
      { uid, notificationId },
    );
  });
});
