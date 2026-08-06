import { type FactoryProvider } from '@nestjs/common';

import { type AppleAuthenticationConfiguration } from './apple-authentication.types';

// Apple OAuth client 설정을 주입하기 위한 token입니다.
export const APPLE_AUTHENTICATION_CONFIGURATION_TOKEN = Symbol(
  'APPLE_AUTHENTICATION_CONFIGURATION_TOKEN',
);

// Cloud Run 환경에 주입된 Apple OAuth client 설정을 반환합니다.
export function appleAuthenticationConfiguration(): AppleAuthenticationConfiguration {
  const value = process.env.APPLE_AUTH_CONFIG;
  if (!value) {
    throw new Error('APPLE_AUTH_CONFIG 값이 필요합니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('APPLE_AUTH_CONFIG JSON 형식이 올바르지 않습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Apple 인증 설정 형식이 올바르지 않습니다.');
  }

  return {
    teamId: requiredConfigurationValue(parsed, 'teamId'),
    clientId: requiredConfigurationValue(parsed, 'clientId'),
    keyId: requiredConfigurationValue(parsed, 'keyId'),
    privateKey: requiredConfigurationValue(parsed, 'privateKey').replace(
      /\\n/g,
      '\n',
    ),
  };
}

// Apple OAuth client 설정의 필수 문자열을 반환합니다.
function requiredConfigurationValue(
  configuration: object,
  fieldName: string,
): string {
  const value = (configuration as Record<string, unknown>)[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Apple 인증 설정에 유효한 ${fieldName} 값이 필요합니다.`);
  }
  return value.trim();
}

// Apple OAuth client 설정을 NestJS 의존성 컨테이너에 제공합니다.
export const appleAuthenticationConfigurationProvider: FactoryProvider<AppleAuthenticationConfiguration> =
  {
    provide: APPLE_AUTHENTICATION_CONFIGURATION_TOKEN,
    useFactory: appleAuthenticationConfiguration,
  };
