import { INestApplication } from '@nestjs/common';

/** 모든 실행 환경에 공통으로 적용할 애플리케이션 설정을 구성합니다. */
export function configureApplication(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableCors();
}
