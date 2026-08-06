import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  PreconditionFailedException,
  UnauthorizedException,
} from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';
import { ApiException } from './api.exception';

describe(ApiExceptionFilter.name, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('ApiException의 상태와 공통 오류 응답을 반환한다', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();

    filter.catch(
      new ApiException(
        HttpStatus.UNAUTHORIZED,
        'unauthenticated',
        '인증 토큰이 필요합니다.',
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith({
      code: 'unauthenticated',
      message: '인증 토큰이 필요합니다.',
    });
  });

  it.each([
    'auth/argument-error',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/invalid-id-token',
    'auth/user-disabled',
    'auth/user-not-found',
  ])('%s 오류의 code와 message를 보존한다', (code) => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();

    filter.catch({ code, message: 'Firebase Auth 오류' }, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
    expect(json).toHaveBeenCalledWith({
      code,
      message: 'Firebase Auth 오류',
    });
  });

  it.each([
    {
      exception: new BadRequestException('요청 형식이 올바르지 않습니다.'),
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'invalid-argument',
      message: '요청 형식이 올바르지 않습니다.',
    },
    {
      exception: new UnauthorizedException('인증이 필요합니다.'),
      statusCode: HttpStatus.UNAUTHORIZED,
      code: 'unauthenticated',
      message: '인증이 필요합니다.',
    },
    {
      exception: new ForbiddenException('접근 권한이 없습니다.'),
      statusCode: HttpStatus.FORBIDDEN,
      code: 'permission-denied',
      message: '접근 권한이 없습니다.',
    },
    {
      exception: new NotFoundException('API 경로를 찾을 수 없습니다.'),
      statusCode: HttpStatus.NOT_FOUND,
      code: 'not-found',
      message: 'API 경로를 찾을 수 없습니다.',
    },
    {
      exception: new ConflictException('요청이 충돌했습니다.'),
      statusCode: HttpStatus.CONFLICT,
      code: 'aborted',
      message: '요청이 충돌했습니다.',
    },
    {
      exception: new PreconditionFailedException('처리 조건이 맞지 않습니다.'),
      statusCode: HttpStatus.PRECONDITION_FAILED,
      code: 'failed-precondition',
      message: '처리 조건이 맞지 않습니다.',
    },
    {
      exception: new HttpException(
        '요청 시간이 초과되었습니다.',
        HttpStatus.REQUEST_TIMEOUT,
      ),
      statusCode: HttpStatus.REQUEST_TIMEOUT,
      code: 'deadline-exceeded',
      message: '요청 시간이 초과되었습니다.',
    },
    {
      exception: new HttpException(
        '요청 본문이 너무 큽니다.',
        HttpStatus.PAYLOAD_TOO_LARGE,
      ),
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'resource-exhausted',
      message: '요청 본문이 너무 큽니다.',
    },
    {
      exception: new HttpException(
        '지원하지 않는 형식입니다.',
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      ),
      statusCode: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      code: 'invalid-argument',
      message: '지원하지 않는 형식입니다.',
    },
    {
      exception: new HttpException(
        '요청 내용을 처리할 수 없습니다.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'invalid-argument',
      message: '요청 내용을 처리할 수 없습니다.',
    },
    {
      exception: new HttpException(
        '요청이 너무 많습니다.',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: 'resource-exhausted',
      message: '요청이 너무 많습니다.',
    },
    {
      exception: new HttpException(
        '알 수 없는 HTTP 오류입니다.',
        HttpStatus.I_AM_A_TEAPOT,
      ),
      statusCode: HttpStatus.I_AM_A_TEAPOT,
      code: 'unknown',
      message: '알 수 없는 HTTP 오류입니다.',
    },
    {
      exception: new HttpException(
        '외부에 노출하면 안 되는 내부 오류입니다.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal',
      message: '서버 오류가 발생했습니다.',
    },
  ])(
    '예상 가능한 HTTP $statusCode 오류의 상태와 의미를 보존한다',
    ({ exception, statusCode, code, message }) => {
      const status = jest.fn().mockReturnThis();
      const json = jest.fn();
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status, json }),
        }),
      } as unknown as ArgumentsHost;
      const filter = new ApiExceptionFilter();

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(statusCode);
      expect(json).toHaveBeenCalledWith({ code, message });
    },
  );

  it('여러 요청 검증 message를 하나의 공통 오류 문구로 보존한다', () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();

    filter.catch(
      new BadRequestException(['title이 필요합니다.', 'body가 필요합니다.']),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      code: 'invalid-argument',
      message: 'title이 필요합니다., body가 필요합니다.',
    });
  });

  it.each([
    new Error('내부 오류 상세'),
    { code: 'auth/internal-error', message: 'Firebase 내부 오류 상세' },
  ])(
    '내부 또는 미분류 오류를 internal 응답으로 변환하고 원본을 기록한다',
    (error) => {
      const loggerError = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation();
      const status = jest.fn().mockReturnThis();
      const json = jest.fn();
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ status, json }),
        }),
      } as unknown as ArgumentsHost;
      const filter = new ApiExceptionFilter();

      filter.catch(error, host);

      const record = error as { code?: string; message: string };
      expect(loggerError).toHaveBeenCalledWith({
        message: '처리되지 않은 API 오류',
        errorCode: record.code,
        errorMessage: record.message,
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(json).toHaveBeenCalledWith({
        code: 'internal',
        message: '서버 오류가 발생했습니다.',
      });
    },
  );

  it('클라이언트 요청 오류를 응답으로 변환하고 오류 로그에는 기록하지 않는다', () => {
    const loggerError = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, json }),
      }),
    } as unknown as ArgumentsHost;
    const filter = new ApiExceptionFilter();

    filter.catch(
      new BadRequestException('요청 형식이 올바르지 않습니다.'),
      host,
    );

    expect(loggerError).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      code: 'invalid-argument',
      message: '요청 형식이 올바르지 않습니다.',
    });
  });
});
