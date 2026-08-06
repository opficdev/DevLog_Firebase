import { HttpStatus } from '@nestjs/common';
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
  const repository = new GitHubProviderRepository(auth, client);

  beforeEach(() => {
    jest.resetAllMocks();
    user.mockResolvedValue(githubUser());
    verifiedEmail.mockResolvedValue('user@example.com');
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
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
      providerToLink: githubProvider(),
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('동시 요청이 같은 이메일 사용자를 생성하면 생성된 사용자에 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('concurrent-uid'));
    createUser.mockRejectedValue(authError('auth/email-already-exists'));

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'concurrent-uid',
    );
    expect(updateUser).toHaveBeenCalledWith('concurrent-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
      providerToLink: githubProvider(),
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('동시 요청이 provider 연결을 완료하면 연결된 uid를 반환한다', async () => {
    getUserByProviderUid
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(
        userRecord('new-uid', [githubProvider('user@example.com')]),
      );
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValue(authError('auth/provider-already-linked'));

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'new-uid',
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('provider 연결이 실패하면 다음 요청에서 생성 사용자를 재사용한다', async () => {
    const linkError = new Error('link-failed');
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('new-uid'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValueOnce(linkError);

    await expect(repository.resolveUid('access-token')).rejects.toBe(linkError);
    expect(deleteUser).not.toHaveBeenCalled();

    await expect(repository.resolveUid('access-token')).resolves.toBe(
      'new-uid',
    );
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenLastCalledWith('new-uid', {
      displayName: 'GitHub User',
      photoURL: 'https://example.com/avatar.png',
      providerToLink: githubProvider(),
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
