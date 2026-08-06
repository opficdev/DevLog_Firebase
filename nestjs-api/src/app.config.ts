import { INestApplication } from '@nestjs/common';
import { type NestExpressApplication } from '@nestjs/platform-express';
import { type IncomingMessage } from 'node:http';

/** 모든 실행 환경에 공통으로 적용할 애플리케이션 설정을 구성합니다. */
export function configureApplication(app: INestApplication): void {
  const expressApp = app as NestExpressApplication;
  expressApp.useBodyParser('text', {
    type: (request) => isAppleCustomTokenBody(request, 'text/plain'),
  });
  expressApp.useBodyParser('raw', {
    type: (request) =>
      isAppleCustomTokenBody(request, 'application/octet-stream'),
  });
  app.setGlobalPrefix('api');
  app.enableCors();
}

/** 지정한 Apple custom token 경로와 content type의 요청인지 확인합니다. */
function isAppleCustomTokenBody(
  request: IncomingMessage,
  expectedContentType: string,
): boolean {
  const contentType = request.headers['content-type'];
  return (
    request.url?.split('?')[0] === '/api/auth/apple/custom-token' &&
    typeof contentType === 'string' &&
    contentType.split(';')[0].trim().toLowerCase() === expectedContentType
  );
}
