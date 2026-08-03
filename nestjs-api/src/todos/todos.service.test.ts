import { HttpStatus, Logger } from '@nestjs/common';

import { TodosRepository } from './todos.repository';
import { TodosService } from './todos.service';

describe(TodosService.name, () => {
  const uid = 'user-1';
  const todoId = 'todo-1';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('Todo와 연결 알림에 삭제 요청 상태를 순서대로 기록한다', async () => {
    const sequence: string[] = [];
    const getTodoDeletionState = jest.fn().mockImplementation(() => {
      sequence.push('Todo 상태 조회');
      return Promise.resolve('active');
    });
    const markTodoDeletionRequested = jest.fn().mockImplementation(() => {
      sequence.push('Todo 삭제 요청');
      return Promise.resolve();
    });
    const markNotificationsDeleted = jest.fn().mockImplementation(() => {
      sequence.push('알림 삭제 요청');
      return Promise.resolve();
    });
    const repository = {
      getTodoDeletionState,
      markTodoDeletionRequested,
      markNotificationsDeleted,
    } as unknown as TodosRepository;
    const service = new TodosService(repository);

    await expect(service.requestDeletion(uid, todoId)).resolves.toBeUndefined();

    expect(sequence).toEqual([
      'Todo 상태 조회',
      'Todo 삭제 요청',
      '알림 삭제 요청',
    ]);
  });

  it.each(['missing', 'deleted'])(
    '%s Todo 삭제 요청을 거부한다',
    async (state) => {
      const getTodoDeletionState = jest.fn().mockResolvedValue(state);
      const markTodoDeletionRequested = jest.fn();
      const markNotificationsDeleted = jest.fn();
      const repository = {
        getTodoDeletionState,
        markTodoDeletionRequested,
        markNotificationsDeleted,
      } as unknown as TodosRepository;
      const service = new TodosService(repository);

      await expect(service.requestDeletion(uid, todoId)).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: {
          code: 'not-found',
          message: 'Todo를 찾을 수 없습니다.',
        },
      });
      expect(markTodoDeletionRequested).not.toHaveBeenCalled();
      expect(markNotificationsDeleted).not.toHaveBeenCalled();
    },
  );

  it('삭제 요청 실패 시 Todo 재조회 후 Todo와 알림을 복구한다', async () => {
    const sequence: string[] = [];
    const error = new Error('알림 삭제 실패');
    const getTodoDeletionState = jest
      .fn()
      .mockImplementationOnce(() => {
        sequence.push('Todo 상태 조회');
        return Promise.resolve('active');
      })
      .mockImplementationOnce(() => {
        sequence.push('Todo 상태 재조회');
        return Promise.resolve('deleted');
      });
    const markTodoDeletionRequested = jest.fn().mockImplementation(() => {
      sequence.push('Todo 삭제 요청');
      return Promise.resolve();
    });
    const markNotificationsDeleted = jest.fn().mockImplementation(() => {
      sequence.push('알림 삭제 요청');
      return Promise.reject(error);
    });
    const restoreTodoDeletion = jest.fn().mockImplementation(() => {
      sequence.push('Todo 복구');
      return Promise.resolve();
    });
    const restoreNotifications = jest.fn().mockImplementation(() => {
      sequence.push('알림 복구');
      return Promise.resolve();
    });
    const repository = {
      getTodoDeletionState,
      markTodoDeletionRequested,
      markNotificationsDeleted,
      restoreTodoDeletion,
      restoreNotifications,
    } as unknown as TodosRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new TodosService(repository);

    await expect(service.requestDeletion(uid, todoId)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: {
        code: 'internal',
        message: 'Todo 삭제 요청에 실패했습니다.',
      },
    });
    expect(sequence).toEqual([
      'Todo 상태 조회',
      'Todo 삭제 요청',
      '알림 삭제 요청',
      'Todo 상태 재조회',
      'Todo 복구',
      '알림 복구',
    ]);
    expect(loggerError).toHaveBeenCalledWith('Todo 삭제 요청 실패', error, {
      uid,
      todoId,
    });
  });

  it('복구 실패를 중첩 오류 처리 없이 그대로 전달한다', async () => {
    const deletionError = new Error('알림 삭제 실패');
    const recoveryError = new Error('알림 복구 실패');
    const getTodoDeletionState = jest
      .fn()
      .mockResolvedValueOnce('active')
      .mockResolvedValueOnce('deleted');
    const repository = {
      getTodoDeletionState,
      markTodoDeletionRequested: jest.fn().mockResolvedValue(undefined),
      markNotificationsDeleted: jest.fn().mockRejectedValue(deletionError),
      restoreTodoDeletion: jest.fn().mockResolvedValue(undefined),
      restoreNotifications: jest.fn().mockRejectedValue(recoveryError),
    } as unknown as TodosRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new TodosService(repository);

    await expect(service.requestDeletion(uid, todoId)).rejects.toBe(
      recoveryError,
    );
    expect(loggerError).not.toHaveBeenCalled();
  });
});
