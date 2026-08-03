import {
  FieldPath,
  FieldValue,
  type Firestore,
} from 'firebase-admin/firestore';

import { TodosRepository } from './todos.repository';

describe(TodosRepository.name, () => {
  const uid = 'user-1';
  const todoId = 'todo-1';

  it.each([
    { snapshot: { exists: false }, expected: 'missing' },
    {
      snapshot: { exists: true, data: () => ({ title: 'Todo' }) },
      expected: 'active',
    },
    {
      snapshot: { exists: true, data: () => ({ deletedAt: 'timestamp' }) },
      expected: 'deleted',
    },
  ])('Todo 삭제 상태 $expected를 반환한다', async ({ snapshot, expected }) => {
    const get = jest.fn().mockResolvedValue(snapshot);
    const doc = jest.fn().mockReturnValue({ get });
    const repository = new TodosRepository({ doc } as unknown as Firestore);

    await expect(repository.getTodoDeletionState(uid, todoId)).resolves.toBe(
      expected,
    );
    expect(doc).toHaveBeenCalledWith('users/user-1/todoLists/todo-1');
  });

  it('Todo에 삭제 요청 상태를 기록한다', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ set });
    const repository = new TodosRepository({ doc } as unknown as Firestore);

    await repository.markTodoDeletionRequested(uid, todoId);

    expect(doc).toHaveBeenCalledWith('users/user-1/todoLists/todo-1');
    expect(set).toHaveBeenCalledWith(
      {
        deletedAt: FieldValue.serverTimestamp(),
        isDeleting: FieldValue.delete(),
        isDeleted: FieldValue.delete(),
      },
      { merge: true },
    );
  });

  it('Todo 삭제 상태를 복구한다', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ update });
    const repository = new TodosRepository({ doc } as unknown as Firestore);

    await repository.restoreTodoDeletion(uid, todoId);

    expect(doc).toHaveBeenCalledWith('users/user-1/todoLists/todo-1');
    expect(update).toHaveBeenCalledWith({
      deletedAt: null,
      isDeleting: FieldValue.delete(),
      isDeleted: FieldValue.delete(),
    });
  });

  it('연결 알림에 삭제 상태를 기록한다', async () => {
    const document = { ref: { path: 'notifications/notification-1' } };
    const get = jest.fn().mockResolvedValue({
      empty: false,
      size: 1,
      docs: [document],
    });
    const where = jest.fn();
    const orderBy = jest.fn();
    const limit = jest.fn();
    const startAfter = jest.fn();
    const query = { where, orderBy, limit, startAfter, get };
    where.mockReturnValue(query);
    orderBy.mockReturnValue(query);
    limit.mockReturnValue(query);
    startAfter.mockReturnValue(query);
    const update = jest.fn();
    const commit = jest.fn().mockResolvedValue(undefined);
    const collection = jest.fn().mockReturnValue(query);
    const batch = jest.fn().mockReturnValue({ update, commit });
    const repository = new TodosRepository({
      collection,
      batch,
    } as unknown as Firestore);

    await repository.markNotificationsDeleted(uid, todoId);

    expect(collection).toHaveBeenCalledWith('users/user-1/notifications');
    expect(where).toHaveBeenCalledWith('todoId', '==', todoId);
    expect(orderBy).toHaveBeenCalledWith(FieldPath.documentId());
    expect(limit).toHaveBeenCalledWith(200);
    expect(update).toHaveBeenCalledWith(document.ref, {
      deletingAt: FieldValue.delete(),
      isDeleted: true,
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('연결 알림의 삭제 상태를 복구한다', async () => {
    const document = { ref: { path: 'notifications/notification-1' } };
    const get = jest.fn().mockResolvedValue({
      empty: false,
      size: 1,
      docs: [document],
    });
    const where = jest.fn();
    const orderBy = jest.fn();
    const limit = jest.fn();
    const startAfter = jest.fn();
    const query = { where, orderBy, limit, startAfter, get };
    where.mockReturnValue(query);
    orderBy.mockReturnValue(query);
    limit.mockReturnValue(query);
    startAfter.mockReturnValue(query);
    const update = jest.fn();
    const commit = jest.fn().mockResolvedValue(undefined);
    const collection = jest.fn().mockReturnValue(query);
    const batch = jest.fn().mockReturnValue({ update, commit });
    const repository = new TodosRepository({
      collection,
      batch,
    } as unknown as Firestore);

    await repository.restoreNotifications(uid, todoId);

    expect(update).toHaveBeenCalledWith(document.ref, {
      deletingAt: FieldValue.delete(),
      isDeleted: false,
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('연결 알림을 200개씩 나누어 갱신한다', async () => {
    const firstDocuments = Array.from({ length: 200 }, (_, index) => ({
      ref: { path: `notifications/notification-${index}` },
    }));
    const lastDocument = {
      ref: { path: 'notifications/notification-200' },
    };
    const get = jest
      .fn()
      .mockResolvedValueOnce({
        empty: false,
        size: 200,
        docs: firstDocuments,
      })
      .mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [lastDocument],
      });
    const where = jest.fn();
    const orderBy = jest.fn();
    const limit = jest.fn();
    const startAfter = jest.fn();
    const query = { where, orderBy, limit, startAfter, get };
    where.mockReturnValue(query);
    orderBy.mockReturnValue(query);
    limit.mockReturnValue(query);
    startAfter.mockReturnValue(query);
    const firstUpdate = jest.fn();
    const firstCommit = jest.fn().mockResolvedValue(undefined);
    const secondUpdate = jest.fn();
    const secondCommit = jest.fn().mockResolvedValue(undefined);
    const collection = jest.fn().mockReturnValue(query);
    const batch = jest
      .fn()
      .mockReturnValueOnce({ update: firstUpdate, commit: firstCommit })
      .mockReturnValueOnce({ update: secondUpdate, commit: secondCommit });
    const repository = new TodosRepository({
      collection,
      batch,
    } as unknown as Firestore);

    await repository.markNotificationsDeleted(uid, todoId);

    expect(firstUpdate).toHaveBeenCalledTimes(200);
    expect(firstCommit).toHaveBeenCalledTimes(1);
    expect(startAfter).toHaveBeenCalledWith(firstDocuments[199]);
    expect(secondUpdate).toHaveBeenCalledWith(lastDocument.ref, {
      deletingAt: FieldValue.delete(),
      isDeleted: true,
    });
    expect(secondCommit).toHaveBeenCalledTimes(1);
  });
});
