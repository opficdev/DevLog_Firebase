import { INestApplication } from '@nestjs/common';

import { configureApplication } from './app.config';

describe(configureApplication.name, () => {
  it('Apple custom token body parser와 전역 API 설정을 구성한다', () => {
    const useBodyParser = jest.fn();
    const setGlobalPrefix = jest.fn();
    const enableCors = jest.fn();
    const app = {
      useBodyParser,
      setGlobalPrefix,
      enableCors,
    } as unknown as INestApplication;

    configureApplication(app);

    expect(useBodyParser).toHaveBeenCalledTimes(2);
    expect(setGlobalPrefix).toHaveBeenCalledWith('api');
    expect(enableCors).toHaveBeenCalledTimes(1);
  });
});
