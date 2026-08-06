import { HttpStatus } from '@nestjs/common';
import { type Auth } from 'firebase-admin/auth';

import { AppleAuthenticationClient } from './apple-authentication.client';
import { AppleAuthenticationService } from './apple-authentication.service';
import {
  type AppleOAuthToken,
  type AppleTokenPayload,
} from './apple-authentication.types';
import { AppleChallengeRepository } from './apple-challenge.repository';
import { AppleCredentialRepository } from './apple-credential.repository';
import { AppleProfileRepository } from './apple-profile.repository';
import { AppleProviderRepository } from './apple-provider.repository';

describe(AppleAuthenticationService.name, () => {
  const createCustomToken = jest.fn();
  const createChallenge = jest.fn();
  const consume = jest.fn();
  const exchangeAuthorizationCode = jest.fn();
  const verifyIdToken = jest.fn();
  const requiredRefreshToken = jest.fn();
  const revokeExchangedTokens = jest.fn();
  const resolveUid = jest.fn();
  const ensureProvider = jest.fn();
  const link = jest.fn();
  const update = jest.fn();
  const save = jest.fn();
  const service = new AppleAuthenticationService(
    { createCustomToken } as unknown as Auth,
    {
      exchangeAuthorizationCode,
      verifyIdToken,
      requiredRefreshToken,
      revokeExchangedTokens,
    } as unknown as AppleAuthenticationClient,
    { create: createChallenge, consume } as unknown as AppleChallengeRepository,
    { resolveUid, ensureProvider, link } as unknown as AppleProviderRepository,
    { update } as unknown as AppleProfileRepository,
    { save } as unknown as AppleCredentialRepository,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    createChallenge.mockResolvedValue({
      challengeId: 'challenge-1',
      hashedNonce: 'hashed-nonce',
      expiresAt: '2026-08-06T00:05:00.000Z',
    });
    consume.mockResolvedValue('hashed-nonce');
    exchangeAuthorizationCode.mockResolvedValue(oauthTokens());
    verifyIdToken.mockResolvedValue(tokenPayload());
    requiredRefreshToken.mockResolvedValue('refresh-token');
    revokeExchangedTokens.mockResolvedValue(undefined);
    resolveUid.mockResolvedValue('user-1');
    ensureProvider.mockResolvedValue(undefined);
    link.mockResolvedValue(undefined);
    update.mockResolvedValue(undefined);
    save.mockResolvedValue(undefined);
    createCustomToken.mockResolvedValue('custom-token');
  });

  it('새 Apple 인증 challenge를 반환한다', async () => {
    await expect(service.createChallenge()).resolves.toEqual({
      challengeId: 'challenge-1',
      hashedNonce: 'hashed-nonce',
      expiresAt: '2026-08-06T00:05:00.000Z',
    });
    expect(createChallenge).toHaveBeenCalledWith();
  });

  it('challenge 증명 처리 순서를 유지해 Firebase custom token을 반환한다', async () => {
    const sequence: string[] = [];
    consume.mockImplementation(() => {
      sequence.push('challenge 소비');
      return Promise.resolve('hashed-nonce');
    });
    exchangeAuthorizationCode.mockImplementation(() => {
      sequence.push('authorization code 교환');
      return Promise.resolve(oauthTokens());
    });
    verifyIdToken.mockImplementation(() => {
      sequence.push('ID token 검증');
      return Promise.resolve(tokenPayload());
    });
    requiredRefreshToken.mockImplementation(() => {
      sequence.push('refresh token 확인');
      return Promise.resolve('refresh-token');
    });
    resolveUid.mockImplementation(() => {
      sequence.push('Firebase uid 결정');
      return Promise.resolve('user-1');
    });
    ensureProvider.mockImplementation(() => {
      sequence.push('Apple provider 연결');
      return Promise.resolve();
    });
    update.mockImplementation(() => {
      sequence.push('Apple 프로필 갱신');
      return Promise.resolve();
    });
    save.mockImplementation(() => {
      sequence.push('Apple credential 저장');
      return Promise.resolve();
    });
    createCustomToken.mockImplementation(() => {
      sequence.push('Firebase custom token 생성');
      return Promise.resolve('custom-token');
    });

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
        '  Apple User  ',
      ),
    ).resolves.toBe('custom-token');

    expect(consume).toHaveBeenCalledWith('challenge-1');
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'authorization-code',
    );
    expect(verifyIdToken).toHaveBeenCalledWith('id-token', 'hashed-nonce');
    expect(requiredRefreshToken).toHaveBeenCalledWith(oauthTokens());
    expect(resolveUid).toHaveBeenCalledWith(tokenPayload());
    expect(ensureProvider).toHaveBeenCalledWith('user-1', tokenPayload());
    expect(update).toHaveBeenCalledWith('user-1', '  Apple User  ');
    expect(save).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(createCustomToken).toHaveBeenCalledWith('user-1');
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
    expect(sequence).toEqual([
      'challenge 소비',
      'authorization code 교환',
      'ID token 검증',
      'refresh token 확인',
      'Firebase uid 결정',
      'Apple provider 연결',
      'Apple 프로필 갱신',
      'Apple credential 저장',
      'Firebase custom token 생성',
    ]);
  });

  it('challenge 소비 실패 시 authorization code를 교환하지 않는다', async () => {
    const error = new Error('challenge 소비 실패');
    consume.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('ID token이 없으면 교환 token을 폐기하고 인증 오류를 반환한다', async () => {
    const tokens = oauthTokens({ idToken: undefined });
    exchangeAuthorizationCode.mockResolvedValue(tokens);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'invalid-apple-proof',
        message: 'Apple 교환 응답에 ID token이 없습니다.',
      },
    });
    expect(revokeExchangedTokens).toHaveBeenCalledWith(tokens);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('ID token 검증 실패 시 교환 token을 폐기하고 오류를 전달한다', async () => {
    const error = new Error('ID token 검증 실패');
    verifyIdToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(requiredRefreshToken).not.toHaveBeenCalled();
  });

  it('refresh token 확인 실패 시 후속 처리를 중단하고 오류를 전달한다', async () => {
    const error = new Error('refresh token 확인 실패');
    requiredRefreshToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(resolveUid).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('Firebase uid 결정 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Firebase uid 결정 실패');
    resolveUid.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(ensureProvider).not.toHaveBeenCalled();
  });

  it('Apple provider 연결 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple provider 연결 실패');
    ensureProvider.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(update).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('Apple 프로필 갱신 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple 프로필 갱신 실패');
    update.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(save).not.toHaveBeenCalled();
  });

  it('Apple credential 저장 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple credential 저장 실패');
    save.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(createCustomToken).not.toHaveBeenCalled();
  });

  it('Firebase custom token 생성 실패 시 저장된 credential을 유지한다', async () => {
    const error = new Error('Firebase custom token 생성 실패');
    createCustomToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithChallenge(
        'challenge-1',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(save).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청 처리 순서를 유지해 Firebase custom token을 반환한다', async () => {
    const sequence: string[] = [];
    verifyIdToken.mockImplementation(() => {
      sequence.push('ID token 검증');
      return Promise.resolve(tokenPayload());
    });
    resolveUid.mockImplementation(() => {
      sequence.push('Firebase uid 결정');
      return Promise.resolve('user-1');
    });
    ensureProvider.mockImplementation(() => {
      sequence.push('Apple provider 연결');
      return Promise.resolve();
    });
    exchangeAuthorizationCode.mockImplementation(() => {
      sequence.push('authorization code 교환');
      return Promise.resolve(oauthTokens());
    });
    requiredRefreshToken.mockImplementation(() => {
      sequence.push('refresh token 확인');
      return Promise.resolve('refresh-token');
    });
    save.mockImplementation(() => {
      sequence.push('Apple credential 저장');
      return Promise.resolve();
    });
    createCustomToken.mockImplementation(() => {
      sequence.push('Firebase custom token 생성');
      return Promise.resolve('custom-token');
    });

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).resolves.toBe('custom-token');

    expect(verifyIdToken).toHaveBeenCalledWith('legacy-id-token');
    expect(resolveUid).toHaveBeenCalledWith(tokenPayload());
    expect(ensureProvider).toHaveBeenCalledWith('user-1', tokenPayload());
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'authorization-code',
    );
    expect(requiredRefreshToken).toHaveBeenCalledWith(oauthTokens());
    expect(save).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(createCustomToken).toHaveBeenCalledWith('user-1');
    expect(update).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
    expect(sequence).toEqual([
      'ID token 검증',
      'Firebase uid 결정',
      'Apple provider 연결',
      'authorization code 교환',
      'refresh token 확인',
      'Apple credential 저장',
      'Firebase custom token 생성',
    ]);
  });

  it('기존 요청의 ID token 검증 실패 시 후속 처리를 중단한다', async () => {
    const error = new Error('ID token 검증 실패');
    verifyIdToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(resolveUid).not.toHaveBeenCalled();
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청의 Firebase uid 결정 실패 시 code를 교환하지 않는다', async () => {
    const error = new Error('Firebase uid 결정 실패');
    resolveUid.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(ensureProvider).not.toHaveBeenCalled();
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청의 Apple provider 연결 실패 시 code를 교환하지 않는다', async () => {
    const error = new Error('Apple provider 연결 실패');
    ensureProvider.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청의 code 교환 실패 시 보상 폐기를 시도하지 않는다', async () => {
    const error = new Error('authorization code 교환 실패');
    exchangeAuthorizationCode.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(requiredRefreshToken).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청의 refresh token 확인 실패 시 후속 처리를 중단한다', async () => {
    const error = new Error('refresh token 확인 실패');
    requiredRefreshToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(save).not.toHaveBeenCalled();
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('기존 요청의 credential 저장 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple credential 저장 실패');
    save.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(createCustomToken).not.toHaveBeenCalled();
  });

  it('기존 요청의 custom token 생성 실패 시 저장된 credential을 유지한다', async () => {
    const error = new Error('Firebase custom token 생성 실패');
    createCustomToken.mockRejectedValue(error);

    await expect(
      service.requestCustomTokenWithIdToken(
        'legacy-id-token',
        'authorization-code',
      ),
    ).rejects.toBe(error);
    expect(save).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
  });

  it('Apple provider 연결 처리 순서와 성공 응답을 유지한다', async () => {
    const sequence: string[] = [];
    consume.mockImplementation(() => {
      sequence.push('challenge 소비');
      return Promise.resolve('hashed-nonce');
    });
    exchangeAuthorizationCode.mockImplementation(() => {
      sequence.push('authorization code 교환');
      return Promise.resolve(oauthTokens());
    });
    verifyIdToken.mockImplementation(() => {
      sequence.push('ID token 검증');
      return Promise.resolve(tokenPayload());
    });
    requiredRefreshToken.mockImplementation(() => {
      sequence.push('refresh token 확인');
      return Promise.resolve('refresh-token');
    });
    link.mockImplementation(() => {
      sequence.push('Apple provider 연결');
      return Promise.resolve();
    });
    save.mockImplementation(() => {
      sequence.push('Apple credential 저장');
      return Promise.resolve();
    });

    await expect(
      service.linkProvider(
        'user-1',
        'challenge-1',
        'authorization-code',
        'user@example.com',
      ),
    ).resolves.toBeUndefined();

    expect(consume).toHaveBeenCalledWith('challenge-1');
    expect(exchangeAuthorizationCode).toHaveBeenCalledWith(
      'authorization-code',
    );
    expect(verifyIdToken).toHaveBeenCalledWith('id-token', 'hashed-nonce');
    expect(requiredRefreshToken).toHaveBeenCalledWith(oauthTokens());
    expect(link).toHaveBeenCalledWith(
      'user-1',
      tokenPayload(),
      'user@example.com',
    );
    expect(save).toHaveBeenCalledWith('user-1', 'refresh-token');
    expect(revokeExchangedTokens).not.toHaveBeenCalled();
    expect(sequence).toEqual([
      'challenge 소비',
      'authorization code 교환',
      'ID token 검증',
      'refresh token 확인',
      'Apple provider 연결',
      'Apple credential 저장',
    ]);
  });

  it('Apple provider 연결 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple provider 연결 실패');
    link.mockRejectedValue(error);

    await expect(
      service.linkProvider('user-1', 'challenge-1', 'authorization-code'),
    ).rejects.toBe(error);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
    expect(save).not.toHaveBeenCalled();
  });

  it('Apple provider 연결 뒤 credential 저장 실패 시 교환 token을 폐기한다', async () => {
    const error = new Error('Apple credential 저장 실패');
    save.mockRejectedValue(error);

    await expect(
      service.linkProvider('user-1', 'challenge-1', 'authorization-code'),
    ).rejects.toBe(error);
    expect(link).toHaveBeenCalledWith('user-1', tokenPayload(), undefined);
    expect(revokeExchangedTokens).toHaveBeenCalledWith(oauthTokens());
  });
});

// Apple OAuth token 대역을 구성합니다.
function oauthTokens(
  overrides: Partial<AppleOAuthToken> = {},
): AppleOAuthToken {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    idToken: 'id-token',
    ...overrides,
  };
}

// 검증된 Apple ID token payload 대역을 구성합니다.
function tokenPayload(): AppleTokenPayload {
  return {
    iss: 'https://appleid.apple.com',
    sub: 'apple-subject',
    aud: 'client-id',
    iat: 1_700_000_000,
    exp: 1_700_003_600,
    email: 'user@example.com',
    email_verified: true,
    nonce: 'hashed-nonce',
  };
}
