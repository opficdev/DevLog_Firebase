import { HttpStatus } from '@nestjs/common';
import { type Auth, type UserRecord } from 'firebase-admin/auth';

import { type GoogleTokenPayload } from './google-authentication.types';
import { GoogleProviderRepository } from './google-provider.repository';

describe(GoogleProviderRepository.name, () => {
  const getUser = jest.fn();
  const getUserByProviderUid = jest.fn();
  const getUserByEmail = jest.fn();
  const updateUser = jest.fn();
  const createUser = jest.fn();
  const deleteUser = jest.fn();
  const auth = {
    getUser,
    getUserByProviderUid,
    getUserByEmail,
    updateUser,
    createUser,
    deleteUser,
  } as unknown as Auth;
  const repository = new GoogleProviderRepository(auth);

  beforeEach(() => {
    jest.resetAllMocks();
    updateUser.mockImplementation((uid: string) =>
      Promise.resolve(userRecord(uid)),
    );
  });

  it('기존 Google provider의 uid와 프로필을 유지한다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [googleProvider('old@example.com')]),
    );
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));

    await expect(repository.resolveUid(payload())).resolves.toBe('linked-uid');
    expect(updateUser).toHaveBeenCalledWith('linked-uid', {
      displayName: 'User',
      email: 'user@example.com',
      photoURL: 'https://example.com/photo.png',
    });
  });

  it('미연결 Google provider를 같은 이메일 사용자에게 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockResolvedValue(userRecord('email-uid'));

    await expect(repository.resolveUid(payload())).resolves.toBe('email-uid');
    expect(updateUser).toHaveBeenCalledWith('email-uid', {
      displayName: 'User',
      photoURL: 'https://example.com/photo.png',
      providerToLink: googleProvider('user@example.com'),
    });
  });

  it('사용자가 없으면 생성한 사용자에 Google provider를 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));

    await expect(repository.resolveUid(payload())).resolves.toBe('new-uid');
    expect(createUser).toHaveBeenCalledWith({
      displayName: 'User',
      email: 'user@example.com',
      photoURL: 'https://example.com/photo.png',
    });
    expect(updateUser).toHaveBeenCalledWith('new-uid', {
      displayName: 'User',
      photoURL: 'https://example.com/photo.png',
      providerToLink: googleProvider('user@example.com'),
    });
  });

  it('동시 요청이 같은 이메일 사용자를 생성하면 생성된 사용자에 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('concurrent-uid'));
    createUser.mockRejectedValue(authError('auth/email-already-exists'));

    await expect(repository.resolveUid(payload())).resolves.toBe(
      'concurrent-uid',
    );
    expect(updateUser).toHaveBeenCalledWith('concurrent-uid', {
      displayName: 'User',
      photoURL: 'https://example.com/photo.png',
      providerToLink: googleProvider('user@example.com'),
    });
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('동시 요청이 provider 연결을 완료하면 연결된 uid를 반환한다', async () => {
    getUserByProviderUid
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(
        userRecord('new-uid', [googleProvider('user@example.com')]),
      );
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValue(authError('auth/provider-already-linked'));

    await expect(repository.resolveUid(payload())).resolves.toBe('new-uid');
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('provider 연결이 실패해도 생성 사용자를 삭제하지 않는다', async () => {
    const linkError = new Error('link-failed');
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValue(linkError);

    await expect(repository.resolveUid(payload())).rejects.toBe(linkError);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('미검증 이메일의 자동 연결을 거부한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));

    await expect(
      repository.resolveUid(payload({ email_verified: false })),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'email-not-found' },
    });
  });

  it('현재 사용자에게 새 Google provider를 연결한다', async () => {
    getUser.mockResolvedValue(
      userRecord('current-uid', [githubProvider()], 'user@example.com'),
    );
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));

    await expect(repository.link('current-uid', payload())).resolves.toBe(true);
    expect(updateUser).toHaveBeenCalledWith('current-uid', {
      providerToLink: googleProvider('user@example.com'),
    });
  });

  it('다른 사용자에게 연결된 Google provider를 거부한다', async () => {
    getUser.mockResolvedValue(
      userRecord('current-uid', [githubProvider()], 'user@example.com'),
    );
    getUserByProviderUid.mockResolvedValue(userRecord('other-uid'));

    await expect(
      repository.link('current-uid', payload()),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'google-provider-link-conflict' },
    });
  });
});

// Google ID token payload 대역을 구성합니다.
function payload(
  overrides: Partial<GoogleTokenPayload> = {},
): GoogleTokenPayload {
  return {
    iss: 'https://accounts.google.com',
    sub: 'google-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    email: 'user@example.com',
    email_verified: true,
    name: 'User',
    picture: 'https://example.com/photo.png',
    ...overrides,
  };
}

// Firebase Auth 사용자 대역을 구성합니다.
function userRecord(
  uid: string,
  providerData: UserRecord['providerData'] = [],
  email?: string,
): UserRecord {
  return { uid, providerData, email } as UserRecord;
}

// Google provider 대역을 구성합니다.
function googleProvider(
  email = 'user@example.com',
): UserRecord['providerData'][number] {
  return {
    providerId: 'google.com',
    uid: 'google-subject',
    displayName: 'User',
    email,
    photoURL: 'https://example.com/photo.png',
  };
}

// GitHub provider 대역을 구성합니다.
function githubProvider(): UserRecord['providerData'][number] {
  return {
    providerId: 'github.com',
    uid: 'github-user',
    displayName: 'User',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.png',
  };
}

// Firebase Auth 오류 대역을 구성합니다.
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
