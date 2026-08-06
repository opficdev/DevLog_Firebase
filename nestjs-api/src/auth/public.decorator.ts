import { SetMetadata } from '@nestjs/common';

// 명시된 Controller method의 인증 생략 여부를 저장하는 metadata key입니다.
export const PUBLIC_ENDPOINT_KEY = Symbol('PUBLIC_ENDPOINT_KEY');

// 지정한 Controller method를 공개 인증 경계로 표시합니다.
export function Public(): MethodDecorator {
  return SetMetadata(PUBLIC_ENDPOINT_KEY, true);
}
