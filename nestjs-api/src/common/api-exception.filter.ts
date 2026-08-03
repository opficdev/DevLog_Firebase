import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

import { ApiException } from './api.exception';

const firebaseAuthErrorCodes = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);
const apiCodeByHttpStatus = new Map<number, string>([
  [HttpStatus.BAD_REQUEST, 'invalid-argument'],
  [HttpStatus.UNAUTHORIZED, 'unauthenticated'],
  [HttpStatus.FORBIDDEN, 'permission-denied'],
  [HttpStatus.NOT_FOUND, 'not-found'],
  [HttpStatus.REQUEST_TIMEOUT, 'deadline-exceeded'],
  [HttpStatus.CONFLICT, 'aborted'],
  [HttpStatus.PRECONDITION_FAILED, 'failed-precondition'],
  [HttpStatus.PAYLOAD_TOO_LARGE, 'resource-exhausted'],
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'invalid-argument'],
  [HttpStatus.UNPROCESSABLE_ENTITY, 'invalid-argument'],
  [HttpStatus.TOO_MANY_REQUESTS, 'resource-exhausted'],
  [HttpStatus.INTERNAL_SERVER_ERROR, 'internal'],
]);

/** 공통 오류 응답을 전송하는 HTTP 응답 기능입니다. */
interface ApiExceptionResponse {
  /** HTTP 상태를 설정하고 같은 응답 기능을 반환합니다. */
  status(statusCode: number): ApiExceptionResponse;

  /** JSON 오류 본문을 클라이언트에 전송합니다. */
  json(body: unknown): void;
}

/** 모든 예외를 공통 API 오류 응답으로 변환하는 전역 경계입니다. */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  /** 서버 내부 오류 원인을 기록하는 로그 기능입니다. */
  private readonly logger = new Logger(ApiExceptionFilter.name);

  /** 발생한 예외를 HTTP 상태와 공통 오류 본문으로 응답합니다. */
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<ApiExceptionResponse>();
    const error = apiExceptionFrom(exception);

    if (
      Number(HttpStatus.INTERNAL_SERVER_ERROR) === error.getStatus() &&
      !(exception instanceof HttpException)
    ) {
      this.logger.error(exception);
    }

    response.status(error.getStatus()).json(error.getResponse());
  }
}

/** 알려진 예외는 보존하고 나머지는 서버 내부 오류로 변환합니다. */
function apiExceptionFrom(exception: unknown): ApiException {
  if (exception instanceof ApiException) {
    return exception;
  }

  const code = firebaseAuthErrorCodeFrom(exception);
  if (code) {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      code,
      errorMessageFrom(exception, '인증 토큰이 유효하지 않습니다.'),
    );
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return new ApiException(
      status,
      apiCodeByHttpStatus.get(status) ?? 'unknown',
      httpExceptionMessageFrom(exception),
    );
  }

  return new ApiException(
    HttpStatus.INTERNAL_SERVER_ERROR,
    'internal',
    '서버 오류가 발생했습니다.',
  );
}

/** 서버 오류의 내부 정보를 숨기고 나머지 HTTP message를 반환합니다. */
function httpExceptionMessageFrom(exception: HttpException): string {
  if (Number(HttpStatus.INTERNAL_SERVER_ERROR) <= exception.getStatus()) {
    return '서버 오류가 발생했습니다.';
  }

  const response = exception.getResponse();
  if (typeof response === 'string' && response) {
    return response;
  }

  if (response && typeof response === 'object') {
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string' && message) {
      return message;
    }
    if (Array.isArray(message)) {
      const messages = message.filter(
        (item): item is string => typeof item === 'string' && item.length !== 0,
      );
      if (messages.length !== 0) {
        return messages.join(', ');
      }
    }
  }

  return exception.message || '요청을 처리할 수 없습니다.';
}

/** 보존할 수 있는 Firebase Auth 오류 code를 반환합니다. */
function firebaseAuthErrorCodeFrom(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }

  const code = (error as Record<string, unknown>).code;
  return typeof code === 'string' && firebaseAuthErrorCodes.has(code)
    ? code
    : undefined;
}

/** Error 형태에 포함된 message가 없으면 기본 문구를 반환합니다. */
function errorMessageFrom(error: unknown, fallback: string): string {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' && message ? message : fallback;
}
