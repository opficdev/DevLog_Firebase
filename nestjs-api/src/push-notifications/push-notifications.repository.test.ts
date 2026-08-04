import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { PushNotificationsRepository } from './push-notifications.repository';

describe(PushNotificationsRepository.name, () => {
  const uid = 'user-1';
  const notificationId = 'notification-1';

  it.each([
    { snapshot: { exists: false }, expected: 'missing' },
    {
      snapshot: { exists: true, data: () => ({ title: 'Notification' }) },
      expected: 'active',
    },
    {
      snapshot: { exists: true, data: () => ({ isDeleted: true }) },
      expected: 'deleted',
    },
  ])(
    'PushNotification 삭제 상태 $expected를 반환한다',
    async ({ snapshot, expected }) => {
      const get = jest.fn().mockResolvedValue(snapshot);
      const doc = jest.fn().mockReturnValue({ get });
      const repository = new PushNotificationsRepository({
        doc,
      } as unknown as Firestore);

      await expect(
        repository.getPushNotificationDeletionState(uid, notificationId),
      ).resolves.toBe(expected);
      expect(doc).toHaveBeenCalledWith(
        'users/user-1/notifications/notification-1',
      );
    },
  );

  it('PushNotification에 삭제 요청 상태를 기록한다', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ set });
    const repository = new PushNotificationsRepository({
      doc,
    } as unknown as Firestore);

    await repository.markPushNotificationDeletionRequested(uid, notificationId);

    expect(doc).toHaveBeenCalledWith(
      'users/user-1/notifications/notification-1',
    );
    expect(set).toHaveBeenCalledWith(
      {
        deletingAt: FieldValue.delete(),
        isDeleted: true,
      },
      { merge: true },
    );
  });

  it('PushNotification 삭제 상태를 복구한다', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ update });
    const repository = new PushNotificationsRepository({
      doc,
    } as unknown as Firestore);

    await repository.restorePushNotificationDeletion(uid, notificationId);

    expect(doc).toHaveBeenCalledWith(
      'users/user-1/notifications/notification-1',
    );
    expect(update).toHaveBeenCalledWith({
      deletingAt: FieldValue.delete(),
      isDeleted: false,
    });
  });
});
