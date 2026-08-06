import { HttpStatus } from '@nestjs/common';
import { type Auth, type UserRecord } from 'firebase-admin/auth';

import { type AppleTokenPayload } from './apple-authentication.types';
import { AppleProviderRepository } from './apple-provider.repository';

describe(AppleProviderRepository.name, () => {
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
  const repository = new AppleProviderRepository(auth);

  beforeEach(() => {
    jest.resetAllMocks();
    updateUser.mockImplementation((uid: string) =>
      Promise.resolve(userRecord(uid)),
    );
  });

  it('기존 Apple provider의 uid를 그대로 반환한다', async () => {
    getUserByProviderUid.mockResolvedValue(
      userRecord('linked-uid', [appleProvider()]),
    );

    await expect(repository.resolveUid(payload())).resolves.toBe('linked-uid');
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('미연결 Apple provider는 같은 이메일 사용자의 uid를 반환한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockResolvedValue(userRecord('email-uid'));

    await expect(repository.resolveUid(payload())).resolves.toBe('email-uid');
    expect(createUser).not.toHaveBeenCalled();
  });

  it('사용자가 없으면 검증된 이메일로 Firebase 사용자를 생성한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail.mockRejectedValue(authError('auth/user-not-found'));
    createUser.mockResolvedValue(userRecord('new-uid'));

    await expect(repository.resolveUid(payload())).resolves.toBe('new-uid');
    expect(createUser).toHaveBeenCalledWith({
      email: 'user@example.com',
      emailVerified: true,
    });
  });

  it('동시 요청이 같은 이메일 사용자를 생성하면 생성된 uid를 반환한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('concurrent-uid'));
    createUser.mockRejectedValue(authError('auth/email-already-exists'));

    await expect(repository.resolveUid(payload())).resolves.toBe(
      'concurrent-uid',
    );
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('미검증 이메일의 사용자 생성을 거부한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));

    await expect(
      repository.resolveUid(payload({ email_verified: false })),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: { code: 'email-not-found' },
    });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(createUser).not.toHaveBeenCalled();
  });

  it('현재 uid가 Apple provider를 소유하면 연결 요청을 생략한다', async () => {
    getUserByProviderUid.mockResolvedValue(userRecord('current-uid'));

    await expect(
      repository.ensureProvider('current-uid', payload()),
    ).resolves.toBeUndefined();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('소유자가 없는 Apple provider를 현재 uid에 연결한다', async () => {
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));

    await expect(
      repository.ensureProvider('current-uid', payload()),
    ).resolves.toBeUndefined();
    expect(updateUser).toHaveBeenCalledWith('current-uid', {
      providerToLink: appleProvider(),
    });
  });

  it('동시 요청이 같은 uid에 provider 연결을 완료하면 성공으로 처리한다', async () => {
    getUserByProviderUid
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('current-uid', [appleProvider()]));
    updateUser.mockRejectedValue(authError('auth/provider-already-linked'));

    await expect(
      repository.ensureProvider('current-uid', payload()),
    ).resolves.toBeUndefined();
  });

  it('동시 요청이 다른 uid에 provider 연결을 완료하면 충돌로 처리한다', async () => {
    getUserByProviderUid
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('other-uid', [appleProvider()]));
    updateUser.mockRejectedValue(authError('auth/provider-already-linked'));

    await expect(
      repository.ensureProvider('current-uid', payload()),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'apple-provider-link-conflict' },
    });
  });

  it('다른 uid가 소유한 Apple provider 연결을 거부한다', async () => {
    getUserByProviderUid.mockResolvedValue(userRecord('other-uid'));

    await expect(
      repository.ensureProvider('current-uid', payload()),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { code: 'apple-provider-link-conflict' },
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('provider 연결 실패 후 다음 요청에서 생성 사용자를 재사용한다', async () => {
    const linkError = new Error('link-failed');
    getUserByProviderUid.mockRejectedValue(authError('auth/user-not-found'));
    getUserByEmail
      .mockRejectedValueOnce(authError('auth/user-not-found'))
      .mockResolvedValueOnce(userRecord('new-uid'));
    createUser.mockResolvedValue(userRecord('new-uid'));
    updateUser.mockRejectedValueOnce(linkError);

    const firstUid = await repository.resolveUid(payload());
    await expect(repository.ensureProvider(firstUid, payload())).rejects.toBe(
      linkError,
    );
    expect(deleteUser).not.toHaveBeenCalled();

    const retriedUid = await repository.resolveUid(payload());
    await expect(
      repository.ensureProvider(retriedUid, payload()),
    ).resolves.toBeUndefined();
    expect(retriedUid).toBe('new-uid');
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(updateUser).toHaveBeenLastCalledWith('new-uid', {
      providerToLink: appleProvider(),
    });
  });
});

// Apple ID token payload 대역을 구성합니다.
function payload(
  overrides: Partial<AppleTokenPayload> = {},
): AppleTokenPayload {
  return {
    iss: 'https://appleid.apple.com',
    sub: 'apple-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    email: 'user@example.com',
    email_verified: true,
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

// Apple provider 대역을 구성합니다.
function appleProvider(): UserRecord['providerData'][number] {
  return {
    providerId: 'apple.com',
    uid: 'apple-subject',
    email: 'user@example.com',
  };
}

// Firebase Auth 오류 대역을 구성합니다.
function authError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
