import { ConsoleLogger } from '@nestjs/common';

// Cloud Run이 한 행의 구조화 로그로 수집할 출력 기능입니다.
export const cloudRunLogger = new ConsoleLogger({
  colors: false,
  json: true,
});
