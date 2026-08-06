import { HttpStatus, Logger } from '@nestjs/common';
import { type Auth, type UserRecord } from 'firebase-admin/auth';

import { GitHubAuthenticationClient } from './github-authentication.client';
import { type GitHubUser } from './github-authentication.types';
import { GitHubProviderRepository } from './github-provider.repository';

describe(GitHubProviderRepository.name, () => {
  const getUserByProviderUid = jest.fn();
  const getUserByEmail = jest.fn();
  const updateUser = jest.fn();
  const createUser = jest.fn();
  const deleteUser = jest.fn();
  const auth = {
    getUserByProviderUid,
    getUserByEmail,
    updateUser,
    createUser,
    deleteUser,
  } as unknown as Auth;
  const user = jest.fn();
  const verifiedEmail = jest.fn();
  const client = {
    user,
    verifiedEmail,
  } as unknown as GitHubAuthenticationClient;
  const loggerError = jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation();
  const repository = new GitHubProviderRepository(auth, client);

  beforeEach(() => {
    jest.resetAllMocks();
    user.mockResolvedValue(githubUser());
    verifiedEmail.mockResolvedValue('user@example.com');
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('verified email이 없어도 기존 GitHub provider uid로 로그인한다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [githubProvider()]),
    );
    verifiedEmail.mockResolvedValue(undefined);

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'linked-uid',
    );
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith('linked-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
    });
  });

  it('GitHub만 연결된 사용자의 verified email과 프로필을 갱신한다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [githubProvider('old@example.com')]),
    );
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    verifiedEmail.mockResolvedValue('new@example.com');

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'linked-uid',
    );
    expect(updateUser).toHaveBeenCalledWith('linked-uid', {
      displayName: 'GitHub User',
      email: 'new@example.com',
      photoURL: 'https://example.com/avatar.png',
    });
  });

  it('다른 사용자가 새 email을 소유하면 기존 GitHub provider email을 유지한다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [githubProvider('old@example.com')]),
    );
    getUserByEmail.mockResolvedValue(userRecord('other-uid'));
    verifiedEmail.mockResolvedValue('new@example.com');

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'linked-uid',
    );
    expect(updateUser).toHaveBeenCalledWith('linked-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
    });
  });

  it('다른 provider도 연결된 사용자는 GitHub email을 갱신하지 않는다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [
        githubProvider('old@example.com'),
        googleProvider(),
      ]),
    );
    verifiedEmail.mockResolvedValue('new@example.com');

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'linked-uid',
    );
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith('linked-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
    });
  });

  it('미연결 GitHub provider를 같은 이메일 사용자에게 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockResolvedValue(userRecord('email-uid'));

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'email-uid',
    );
    expect(updateUser).toHaveBeenCalledWith('email-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
      providerToLink: githubProvider(),
    });
  });

  it('사용자가 없으면 GitHub provider가 연결된 사용자를 생성한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'new-uid',
    );
    expect(createUser).toHaveBeenCalledWith({
      displayName: 'GitHub User',
      email: 'user@example.com',
      photoURL: 'https://example.com/avatar.png',
    });
    expect(updateUser).toHaveBeenCalledWith('new-uid', {
      providerToLink: githubProvider(),
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('신규 사용자 provider 연결 실패 시 생성한 사용자를 삭제한다', async () => {
    const error = new Error('provider 연결 실패');
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValue(error);

    await expect(repository.resolveUid('access-token')).rejects.toBe(error);
    expect(deleteUser).toHaveBeenCalledWith('new-uid');
  });

  it('신규 사용자 삭제 실패가 provider 연결 오류를 덮지 않는다', async () => {
    const error = new Error('provider 연결 실패');
    const cleanupError = new Error('사용자 삭제 실패');
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValue(error);
    deleteUser.mockRejectedValue(cleanupError);

    await expect(repository.resolveUid('access-token')).rejects.toBe(error);
    expect(loggerError).toHaveBeenCalledWith({
      message: 'GitHub provider 연결 실패 사용자 정리 실패',
      errorMessage: cleanupError.message,
      errorStack: cleanupError.stack,
      uid: 'new-uid',
    });
  });

  it('미연결 GitHub provider에 verified email이 없으면 거부한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    verifiedEmail.mockResolvedValue(undefined);

    await expect(repository.resolveUid('access-token')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'email-not-found',
        message: 'GitHub 사용자 데이터를 가져오지 못했습니다.',
      },
    });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('GitHub user id가 없으면 거부한다', async () => {
    user.mockResolvedValue(githubUser({ id: 0 }));

    await expect(repository.resolveUid('access-token')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'email-not-found' },
    });
    expect(getUserByProviderUid).not.toHaveBeenCalled();
  });
});

// GitHub 사용자 대역을 구성합니다.
function githubUser(overrides: Partial<GitHubUser> = {}): GitHubUser {
  return {
    id: 1,
    login: 'github-user',
    name: 'GitHub User',
    avatar_url: 'https://example.com/avatar.png',
    ...overrides,
  };
}

// Firebase Auth 사용자 대역을 구성합니다.
function userRecord(
  uid: string,
  providerData: UserRecord['providerData'] = [],
): UserRecord {
  return { uid, providerData } as UserRecord;
}

// GitHub provider 대역을 구성합니다.
function githubProvider(
  email = 'user@example.com',
): UserRecord['providerData'][number] {
  return {
    providerId: 'github.com',
    uid: '1',
    displayName: 'GitHub User',
    email,
    photoURL: 'https://example.com/avatar.png',
  };
}

// Google provider 대역을 구성합니다.
function googleProvider(): UserRecord['providerData'][number] {
  return {
    providerId: 'google.com',
    uid: 'google-user',
    displayName: 'Google User',
    email: 'old@example.com',
    photoURL: undefined,
  };
}

// Firebase Auth 오류 대역을 구성합니다.
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
