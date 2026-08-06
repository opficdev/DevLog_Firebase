import { HttpStatus, Logger } from '@nestjs/common';

import { WebPagesRepository } from './web-pages.repository';
import { WebPagesService } from './web-pages.service';

describe(WebPagesService.name, () => {
  const uid = 'user-1';
  const webPageId = 'web-page-1';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('활성 WebPage에 삭제 요청 상태를 기록한다', async () => {
    const sequence: string[] = [];
    const getWebPageDeletionState = jest.fn().mockImplementation(() => {
      sequence.push('WebPage 상태 조회');
      return Promise.resolve('active');
    });
    const markWebPageDeletionRequested = jest.fn().mockImplementation(() => {
      sequence.push('WebPage 삭제 요청');
      return Promise.resolve();
    });
    const repository = {
      getWebPageDeletionState,
      markWebPageDeletionRequested,
    } as unknown as WebPagesRepository;
    const service = new WebPagesService(repository);

    await expect(
      service.requestDeletion(uid, webPageId),
    ).resolves.toBeUndefined();

    expect(sequence).toEqual(['WebPage 상태 조회', 'WebPage 삭제 요청']);
  });

  it.each(['missing', 'deleted'])(
    '%s WebPage 삭제 요청을 거부한다',
    async (state) => {
      const getWebPageDeletionState = jest.fn().mockResolvedValue(state);
      const markWebPageDeletionRequested = jest.fn();
      const repository = {
        getWebPageDeletionState,
        markWebPageDeletionRequested,
      } as unknown as WebPagesRepository;
      const service = new WebPagesService(repository);

      await expect(
        service.requestDeletion(uid, webPageId),
      ).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        response: {
          code: 'not-found',
          message: 'WebPage를 찾을 수 없습니다.',
        },
      });
      expect(markWebPageDeletionRequested).not.toHaveBeenCalled();
    },
  );

  it('삭제 요청 실패 시 WebPage를 재조회하고 복구한다', async () => {
    const sequence: string[] = [];
    const error = new Error('WebPage 쓰기 실패');
    const getWebPageDeletionState = jest
      .fn()
      .mockImplementationOnce(() => {
        sequence.push('WebPage 상태 조회');
        return Promise.resolve('active');
      })
      .mockImplementationOnce(() => {
        sequence.push('WebPage 상태 재조회');
        return Promise.resolve('deleted');
      });
    const markWebPageDeletionRequested = jest.fn().mockImplementation(() => {
      sequence.push('WebPage 삭제 요청');
      return Promise.reject(error);
    });
    const restoreWebPageDeletion = jest.fn().mockImplementation(() => {
      sequence.push('WebPage 복구');
      return Promise.resolve();
    });
    const repository = {
      getWebPageDeletionState,
      markWebPageDeletionRequested,
      restoreWebPageDeletion,
    } as unknown as WebPagesRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new WebPagesService(repository);

    await expect(service.requestDeletion(uid, webPageId)).rejects.toMatchObject(
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        response: {
          code: 'internal',
          message: '웹페이지 삭제 요청에 실패했습니다.',
        },
      },
    );
    expect(sequence).toEqual([
      'WebPage 상태 조회',
      'WebPage 삭제 요청',
      'WebPage 상태 재조회',
      'WebPage 복구',
    ]);
    expect(loggerError).toHaveBeenCalledWith({
      message: '웹페이지 삭제 요청 실패',
      errorMessage: error.message,
      errorStack: error.stack,
      uid,
      webPageId,
    });
  });

  it('cleanup 실패를 기록하고 원래 삭제 요청 오류를 반환한다', async () => {
    const deletionError = new Error('WebPage 쓰기 실패');
    const cleanupError = new Error('WebPage 복구 실패');
    const getWebPageDeletionState = jest
      .fn()
      .mockResolvedValueOnce('active')
      .mockResolvedValueOnce('deleted');
    const repository = {
      getWebPageDeletionState,
      markWebPageDeletionRequested: jest.fn().mockRejectedValue(deletionError),
      restoreWebPageDeletion: jest.fn().mockRejectedValue(cleanupError),
    } as unknown as WebPagesRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new WebPagesService(repository);

    await expect(service.requestDeletion(uid, webPageId)).rejects.toMatchObject(
      {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        response: {
          code: 'internal',
          message: '웹페이지 삭제 요청에 실패했습니다.',
        },
      },
    );
    expect(loggerError).toHaveBeenNthCalledWith(1, {
      message: '웹페이지 삭제 요청 cleanup 실패',
      errorMessage: cleanupError.message,
      errorStack: cleanupError.stack,
      uid,
      webPageId,
    });
    expect(loggerError).toHaveBeenNthCalledWith(2, {
      message: '웹페이지 삭제 요청 실패',
      errorMessage: deletionError.message,
      errorStack: deletionError.stack,
      uid,
      webPageId,
    });
  });

  it('삭제 상태인 WebPage를 복구한다', async () => {
    const getWebPageDeletionState = jest.fn().mockResolvedValue('deleted');
    const restoreWebPageDeletion = jest.fn().mockResolvedValue(undefined);
    const repository = {
      getWebPageDeletionState,
      restoreWebPageDeletion,
    } as unknown as WebPagesRepository;
    const service = new WebPagesService(repository);

    await expect(service.undoDeletion(uid, webPageId)).resolves.toBeUndefined();

    expect(restoreWebPageDeletion).toHaveBeenCalledWith(uid, webPageId);
  });

  it.each(['missing', 'active'])(
    '%s WebPage 삭제 취소를 성공으로 처리한다',
    async (state) => {
      const getWebPageDeletionState = jest.fn().mockResolvedValue(state);
      const restoreWebPageDeletion = jest.fn();
      const repository = {
        getWebPageDeletionState,
        restoreWebPageDeletion,
      } as unknown as WebPagesRepository;
      const service = new WebPagesService(repository);

      await expect(
        service.undoDeletion(uid, webPageId),
      ).resolves.toBeUndefined();

      expect(restoreWebPageDeletion).not.toHaveBeenCalled();
    },
  );

  it('삭제 취소 실패를 internal 오류로 변환한다', async () => {
    const error = new Error('WebPage 복구 실패');
    const repository = {
      getWebPageDeletionState: jest.fn().mockResolvedValue('deleted'),
      restoreWebPageDeletion: jest.fn().mockRejectedValue(error),
    } as unknown as WebPagesRepository;
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const service = new WebPagesService(repository);

    await expect(service.undoDeletion(uid, webPageId)).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      response: {
        code: 'internal',
        message: '웹페이지 삭제 취소에 실패했습니다.',
      },
    });
    expect(loggerError).toHaveBeenCalledWith({
      message: '웹페이지 삭제 취소 실패',
      errorMessage: error.message,
      errorStack: error.stack,
      uid,
      webPageId,
    });
  });
});
