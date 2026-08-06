import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

import { ApiException } from '../common/api.exception';
import {
  type GitHubAuthenticationConfiguration,
  type GitHubUser,
} from './github-authentication.types';

// GitHub authorization code 교환 응답입니다.
interface GitHubOAuthResponse {
  // 발급된 사용자 access token을 저장합니다.
  access_token?: string;
  // 발급 token 종류를 저장합니다.
  token_type?: string;
  // 승인된 OAuth scope를 저장합니다.
  scope?: string;
  // GitHub token 교환 오류 코드를 저장합니다.
  error?: string;
}

// GitHub email API가 반환한 이메일 검증 상태입니다.
interface GitHubEmail {
  // GitHub 계정 이메일을 저장합니다.
  email: string;
  // 대표 이메일 여부를 저장합니다.
  primary: boolean;
  // GitHub 검증 완료 여부를 저장합니다.
  verified: boolean;
}

const accept = 'application/vnd.github+json';
const userAgent = 'DevLog-Firebase';
const notFoundStatus = 404;
const validationFailedStatus = 422;

// GitHub OAuth와 사용자 API 요청을 담당합니다.
@Injectable()
export class GitHubAuthenticationClient {
  // GitHub 외부 요청 실패를 기록하는 로그 기능을 저장합니다.
  private readonly logger = new Logger(GitHubAuthenticationClient.name);

  // GitHub authorization code를 access token으로 교환합니다.
  async exchangeAuthorizationCode(
    code: string,
    configuration: GitHubAuthenticationConfiguration,
    codeVerifier: string,
  ): Promise<string> {
    const response = await this.requestGitHubApi(() =>
      axios.post<GitHubOAuthResponse>(
        'https://github.com/login/oauth/access_token',
        {
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          code,
          redirect_uri: configuration.callbackURL,
          code_verifier: codeVerifier,
        },
        { headers: { Accept: 'application/json' } },
      ),
    );
    if (response.data.error) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'invalid-argument',
        `GitHub OAuth 오류: ${response.data.error}`,
      );
    }
    if (!response.data.access_token) {
      throw githubProviderException;
    }
    return response.data.access_token;
  }

  // GitHub access token으로 로그인 사용자의 프로필을 반환합니다.
  async user(accessToken: string): Promise<GitHubUser> {
    const response = await this.requestGitHubApi(() =>
      axios.get<GitHubUser>('https://api.github.com/user', {
        headers: githubRequestHeaders(accessToken),
      }),
    );
    return response.data;
  }

  // GitHub email 목록에서 검증된 이메일을 반환합니다.
  async verifiedEmail(accessToken: string): Promise<string | undefined> {
    const response = await this.requestGitHubApi(() =>
      axios.get<GitHubEmail[]>('https://api.github.com/user/emails', {
        headers: githubRequestHeaders(accessToken),
      }),
    );
    const primary = response.data.find(
      (email) => email.primary && email.verified,
    )?.email;
    return primary ?? response.data.find((email) => email.verified)?.email;
  }

  // GitHub OAuth App의 지정 access token을 폐기합니다.
  async revokeOAuthToken(
    uid: string,
    accessToken: string,
    configuration: GitHubAuthenticationConfiguration,
  ): Promise<void> {
    try {
      const response = await axios.request({
        method: 'delete',
        url: applicationTokenURL(configuration.clientId),
        ...applicationRequestConfiguration(configuration),
        data: { access_token: accessToken },
      });
      if (response.status === Number(HttpStatus.NO_CONTENT)) {
        return;
      }
    } catch (error) {
      if (await this.isAlreadyInvalidToken(error, accessToken, configuration)) {
        this.logger.warn({
          message: 'GitHub OAuth token이 이미 무효화되어 성공으로 처리합니다.',
          uid,
          github: errorMetadata(error),
        });
        return;
      }
      this.logger.error({
        message: 'GitHub OAuth token 폐기에 실패했습니다.',
        ...errorMetadata(error),
      });
      throw githubRevocationException;
    }
    throw githubRevocationException;
  }

  // GitHub token 조회 결과로 이미 무효화된 token인지 확인합니다.
  private async isAlreadyInvalidToken(
    error: unknown,
    accessToken: string,
    configuration: GitHubAuthenticationConfiguration,
  ): Promise<boolean> {
    const status = responseStatus(error);
    if (status !== notFoundStatus && status !== validationFailedStatus) {
      return false;
    }

    try {
      await axios.request({
        method: 'post',
        url: applicationTokenURL(configuration.clientId),
        ...applicationRequestConfiguration(configuration),
        data: { access_token: accessToken },
      });
      return false;
    } catch (checkError) {
      if (responseStatus(checkError) === notFoundStatus) {
        return true;
      }
      this.logger.error({
        message: 'GitHub token 상태 확인에 실패했습니다.',
        ...errorMetadata(checkError),
      });
      return false;
    }
  }

  // GitHub 인증 서버 요청 실패를 계약 오류로 변환합니다.
  private async requestGitHubApi<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (error) {
      this.logger.error({
        message: 'GitHub 인증 서버 요청에 실패했습니다.',
        ...errorMetadata(error),
      });
      throw githubProviderException;
    }
  }
}

// GitHub API 요청의 공통 헤더를 반환합니다.
function githubRequestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: accept,
    'User-Agent': userAgent,
  };
}

// GitHub OAuth 애플리케이션 token 관리 주소를 반환합니다.
function applicationTokenURL(clientId: string): string {
  return `https://api.github.com/applications/${clientId}/token`;
}

// GitHub OAuth 애플리케이션 인증 요청 설정을 반환합니다.
function applicationRequestConfiguration(
  configuration: GitHubAuthenticationConfiguration,
) {
  return {
    auth: {
      username: configuration.clientId,
      password: configuration.clientSecret,
    },
    headers: { Accept: accept, 'User-Agent': userAgent },
  };
}

// Axios 예외에서 HTTP 상태를 반환합니다.
function responseStatus(error: unknown): number | undefined {
  return axios.isAxiosError(error) ? error.response?.status : undefined;
}

// 외부 API 실패에서 로그에 허용할 정보만 반환합니다.
function errorMetadata(error: unknown): {
  status?: number;
  errorMessage: string;
  data?: unknown;
} {
  if (axios.isAxiosError(error)) {
    return {
      status: error.response?.status,
      errorMessage: error.message,
      data: error.response?.data,
    };
  }
  return {
    errorMessage: error instanceof Error ? error.message : 'Unknown error',
  };
}

const githubProviderException = new ApiException(
  HttpStatus.BAD_GATEWAY,
  'github-provider-failed',
  'GitHub 인증 서버 요청에 실패했습니다.',
);
const githubRevocationException = new ApiException(
  HttpStatus.BAD_GATEWAY,
  'github-revoke-failed',
  'GitHub grant 폐기에 실패했습니다.',
);
