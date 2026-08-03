import { INestApplication } from '@nestjs/common';

import { configureApplication } from './app.config';

describe(configureApplication.name, () => {
  it('전역 API prefix와 CORS를 설정한다', () => {
    const setGlobalPrefix = jest.fn();
    const enableCors = jest.fn();
    const app = {
      setGlobalPrefix,
      enableCors,
    } as unknown as INestApplication;

    configureApplication(app);

    expect(setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(enableCors).toHaveBeenCalledTimes(1);
  });
});
