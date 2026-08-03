import { HttpException } from '@nestjs/common';

/** API 클라이언트에 전달하는 공통 오류 응답입니다. */
export interface ApiErrorResponse {
  /** 클라이언트가 오류를 구분하는 code를 저장합니다. */
  code: string;

  /** 오류 내용을 설명하는 message를 저장합니다. */
  message: string;
}

/** HTTP 상태와 공통 오류 응답을 함께 전달하는 예외입니다. */
export class ApiException extends HttpException {
  /** HTTP 상태와 클라이언트 오류 정보를 구성합니다. */
  constructor(status: number, code: string, message: string) {
    super({ code, message } satisfies ApiErrorResponse, status);
  }
}
