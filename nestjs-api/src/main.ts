import { NestFactory } from '@nestjs/core';

import { configureApplication } from './app.config';
import { AppModule } from './app.module';
import { cloudRunLogger } from './common/cloud-run.logger';
import { resolvePort } from './port';

/** 애플리케이션을 구성하고 외부 요청을 받을 서버를 시작합니다. */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: cloudRunLogger,
  });

  configureApplication(app);
  await app.listen(resolvePort(process.env.PORT), '0.0.0.0');
}

void bootstrap();
