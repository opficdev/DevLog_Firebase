import { HttpStatus, Logger } from '@nestjs/common';
import axios, { type AxiosError } from 'axios';

import { GitHubAuthenticationClient } from './github-authentication.client';

jest.mock('axios');

const mockedAxios = jest.mocked(axios);
const configuration = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  callbackURL: 'https://example.com/api/auth/github/callback',
};

describe(GitHubAuthenticationClient.name, () => {
  const client = new GitHubAuthenticationClient();

  beforeEach(() => {
    jest.resetAllMocks();
    mockedAxios.isAxiosError.mockImplementation(
      (error) =>
        !!error &&
        typeof error === 'object' &&
        (error as Record<string, unknown>).isAxiosError === true,
    );
  });

  it('callback과 PKCE verifier를 포함해 authorization code를 교환한다', async () => {
    mockedAxios.post.mockResolvedValue({
      status: HttpStatus.OK,
      data: { access_token: 'access-token' },
    });

    await expect(
      client.exchangeAuthorizationCode(
        'authorization-code',
        configuration,
        'provider-verifier',
      ),
    ).resolves.toBe('access-token');
    expect(mockedAxios.post.mock.calls).toContainEqual([
      'https://github.com/login/oauth/access_token',
      {
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'authorization-code',
        redirect_uri: configuration.callbackURL,
        code_verifier: 'provider-verifier',
      },
      { headers: { Accept: 'application/json' } },
    ]);
  });

  it('GitHub OAuth 오류 응답을 invalid-argument로 반환한다', async () => {
    mockedAxios.post.mockResolvedValue({
      status: HttpStatus.OK,
      data: { error: 'bad_verification_code' },
    });

    await expect(
      client.exchangeAuthorizationCode('code', configuration, 'verifier'),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'GitHub OAuth 오류: bad_verification_code',
      },
    });
  });

  it('GitHub 사용자와 대표 verified email을 반환한다', async () => {
    mockedAxios.get
      .mockResolvedValueOnce({ data: { id: 1, login: 'opfic' } })
      .mockResolvedValueOnce({
        data: [
          { email: 'secondary@example.com', primary: false, verified: true },
          { email: 'primary@example.com', primary: true, verified: true },
        ],
      });

    await expect(client.user('access-token')).resolves.toEqual({
      id: 1,
      login: 'opfic',
    });
    await expect(client.verifiedEmail('access-token')).resolves.toBe(
      'primary@example.com',
    );
  });

  it('GitHub API 실패를 provider 계약 오류로 변환한다', async () => {
    mockedAxios.get.mockRejectedValue(
      axiosError(HttpStatus.INTERNAL_SERVER_ERROR, { error: 'server_error' }),
    );

    await expect(client.user('access-token')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { code: 'github-provider-failed' },
    });
  });

  it('GitHub OAuth App의 지정 token을 폐기한다', async () => {
    mockedAxios.request.mockResolvedValue({ status: HttpStatus.NO_CONTENT });

    await client.revokeOAuthToken('user-1', 'access-token', configuration);

    expect(mockedAxios.request.mock.calls).toContainEqual([
      {
        method: 'delete',
        url: 'https://api.github.com/applications/client-id/token',
        auth: { username: 'client-id', password: 'client-secret' },
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'DevLog-Firebase',
        },
        data: { access_token: 'access-token' },
      },
    ]);
  });

  it('이미 무효화된 GitHub token 폐기를 성공으로 처리한다', async () => {
    const deletionError = axiosError(HttpStatus.NOT_FOUND, {});
    const loggerWarn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation();
    mockedAxios.request
      .mockRejectedValueOnce(deletionError)
      .mockRejectedValueOnce(axiosError(HttpStatus.NOT_FOUND, {}));

    await expect(
      client.revokeOAuthToken('user-1', 'access-token', configuration),
    ).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith({
      message: 'GitHub OAuth token이 이미 무효화되어 성공으로 처리합니다.',
      uid: 'user-1',
      github: {
        status: HttpStatus.NOT_FOUND,
        errorMessage: deletionError.message,
        data: {},
      },
    });
    loggerWarn.mockRestore();
  });

  it('GitHub token 폐기 실패를 계약 오류로 변환한다', async () => {
    mockedAxios.request.mockRejectedValue(
      axiosError(HttpStatus.INTERNAL_SERVER_ERROR, {}),
    );

    await expect(
      client.revokeOAuthToken('user-1', 'access-token', configuration),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
      response: { code: 'github-revoke-failed' },
    });
  });
});

// Axios 오류 대역을 구성합니다.
function axiosError(status: number, data: unknown): AxiosError {
  return {
    name: 'AxiosError',
    message: `status ${status}`,
    isAxiosError: true,
    response: { status, data },
  } as AxiosError;
}
