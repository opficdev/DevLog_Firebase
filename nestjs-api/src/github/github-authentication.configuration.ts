import { Injectable } from '@nestjs/common';

import { type GitHubAuthenticationConfiguration } from './github-authentication.types';

// Cloud Run 환경에 주입된 GitHub OAuth App 설정을 요청 시점에 제공합니다.
@Injectable()
export class GitHubAuthenticationConfigurationProvider {
  // GitHub OAuth App 설정을 환경 변수에서 검증해 반환합니다.
  configuration(): GitHubAuthenticationConfiguration {
    const value = process.env.GITHUB_OAUTH_CONFIG;
    if (!value) {
      throw new Error('GITHUB_OAUTH_CONFIG 값이 필요합니다.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new Error('GITHUB_OAUTH_CONFIG JSON 형식이 올바르지 않습니다.');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('GitHub OAuth App 설정 형식이 올바르지 않습니다.');
    }

    return {
      clientId: requiredConfigurationValue(parsed, 'clientId'),
      clientSecret: requiredConfigurationValue(parsed, 'clientSecret'),
      callbackURL: requiredConfigurationValue(parsed, 'callbackURL'),
    };
  }
}

// GitHub OAuth App 설정의 필수 문자열을 반환합니다.
function requiredConfigurationValue(
  configuration: object,
  fieldName: string,
): string {
  const value = (configuration as Record<string, unknown>)[fieldName];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(
      `GitHub OAuth App 설정에 유효한 ${fieldName} 값이 필요합니다.`,
    );
  }
  return value.trim();
}
