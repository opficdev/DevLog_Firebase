import { FieldValue, type Firestore } from 'firebase-admin/firestore';

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
});
