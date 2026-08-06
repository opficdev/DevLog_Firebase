import { type FactoryProvider } from '@nestjs/common';

import { type GoogleAuthenticationConfiguration } from './google-authentication.types';

// Google OAuth client 설정을 주입하기 위한 token입니다.
export const GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN = Symbol(
  'GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN',
);

// Cloud Run 환경에 주입된 Google OAuth client 설정을 반환합니다.
export function googleOAuthConfiguration(): GoogleAuthenticationConfiguration {
  const value = process.env.GOOGLE_OAUTH_CONFIG;
  if (!value) {
    throw new Error('GOOGLE_OAUTH_CONFIG 값이 필요합니다.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new Error('GOOGLE_OAUTH_CONFIG JSON 형식이 올바르지 않습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Google OAuth client 설정 형식이 올바르지 않습니다.');
  }

  return {
    clientId: requiredConfigurationValue(parsed, 'clientId'),
    clientSecret: requiredConfigurationValue(parsed, 'clientSecret'),
  };
}

// Google OAuth client 설정의 필수 문자열을 반환합니다.
function requiredConfigurationValue(
  configuration: object,
  fieldName: string,
): string {
  const value = (configuration as Record<string, unknown>)[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `Google OAuth client 설정에 유효한 ${fieldName} 값이 필요합니다.`,
    );
  }
  return value.trim();
}

// Google OAuth client 설정을 NestJS 의존성 컨테이너에 제공합니다.
export const googleOAuthConfigurationProvider: FactoryProvider<GoogleAuthenticationConfiguration> =
  {
    provide: GOOGLE_AUTHENTICATION_CONFIGURATION_TOKEN,
    useFactory: googleOAuthConfiguration,
  };
