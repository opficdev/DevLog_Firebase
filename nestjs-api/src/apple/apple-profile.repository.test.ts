import { HttpStatus } from '@nestjs/common';
import { type Auth, type UserRecord } from 'firebase-admin/auth';
import { type Firestore } from 'firebase-admin/firestore';

import { AppleProfileRepository } from './apple-profile.repository';

describe(AppleProfileRepository.name, () => {
  const get = jest.fn();
  const reference = { get };
  const doc = jest.fn().mockReturnValue(reference);
  const getUser = jest.fn();
  const updateUser = jest.fn();
  const repository = new AppleProfileRepository(
    { doc } as unknown as Firestore,
    { getUser, updateUser } as unknown as Auth,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    doc.mockReturnValue(reference);
    get.mockResolvedValue({ data: () => undefined });
    getUser.mockResolvedValue(userRecord());
    updateUser.mockResolvedValue(userRecord());
  });

  it('전달된 이름을 정리해 Firebase Auth 프로필에 반영한다', async () => {
    await repository.update('user-1', '  Apple User  ');

    expect(get).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Apple User',
      photoURL: null,
    });
  });

  it('전달된 이름이 없으면 저장된 Apple 이름을 사용한다', async () => {
    get.mockResolvedValue({
      data: () => ({ appleName: '  Stored Apple User  ' }),
    });

    await repository.update('user-1');

    expect(doc).toHaveBeenCalledWith('users/user-1/userData/info');
    expect(getUser).not.toHaveBeenCalled();
    expect(updateUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Stored Apple User',
      photoURL: null,
    });
  });

  it('공백 이름은 없는 값으로 처리해 저장된 Apple 이름을 사용한다', async () => {
    get.mockResolvedValue({ data: () => ({ appleName: 'Stored Apple User' }) });

    await repository.update('user-1', '   ');

    expect(updateUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Stored Apple User',
      photoURL: null,
    });
  });

  it('현재 Firebase Auth 프로필이 완성되어 있으면 갱신하지 않는다', async () => {
    getUser.mockResolvedValue(userRecord('Firebase Apple User'));

    await repository.update('user-1');

    expect(updateUser).not.toHaveBeenCalled();
  });

  it('Firebase Auth 이름의 앞뒤 공백을 정리한다', async () => {
    getUser.mockResolvedValue(userRecord('  Firebase Apple User  '));

    await repository.update('user-1');

    expect(updateUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Firebase Apple User',
      photoURL: null,
    });
  });

  it('Firebase Auth 프로필 이미지가 있으면 제거한다', async () => {
    getUser.mockResolvedValue(
      userRecord('Firebase Apple User', 'https://example.com/profile.png'),
    );

    await repository.update('user-1');

    expect(updateUser).toHaveBeenCalledWith('user-1', {
      displayName: 'Firebase Apple User',
      photoURL: null,
    });
  });

  it('사용할 이름이 없으면 프로필 미완성 오류를 반환한다', async () => {
    await expect(repository.update('user-1', '   ')).rejects.toMatchObject({
      status: HttpStatus.PRECONDITION_FAILED,
      response: {
        code: 'apple-profile-incomplete',
        message: 'Apple 프로필 이름을 찾을 수 없습니다.',
      },
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('프로필 갱신 실패 뒤 같은 이름으로 다시 시도할 수 있다', async () => {
    const updateError = new Error('profile update failed');
    updateUser.mockRejectedValueOnce(updateError);

    await expect(repository.update('user-1', 'Apple User')).rejects.toBe(
      updateError,
    );
    await expect(
      repository.update('user-1', 'Apple User'),
    ).resolves.toBeUndefined();

    expect(updateUser).toHaveBeenCalledTimes(2);
    expect(updateUser).toHaveBeenLastCalledWith('user-1', {
      displayName: 'Apple User',
      photoURL: null,
    });
  });
});

// Firebase Auth 사용자 대역을 구성합니다.
// prettier-ignore
function userRecord(
  displayName?: string,
  photoURL?: string,
): UserRecord {
  return { uid: 'user-1', displayName, photoURL } as UserRecord;
}
