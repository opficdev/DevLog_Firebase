import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Server } from 'node:http';
import request from 'supertest';

import { configureApplication } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { AppleAuthenticationService } from '../src/apple/apple-authentication.service';
import { ApiException } from '../src/common/api.exception';
import {
  FIREBASE_APP_TOKEN,
  FIREBASE_AUTH_TOKEN,
  FIREBASE_FIRESTORE_TOKEN,
} from '../src/firebase/firebase.tokens';

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    delete: jest.fn(),
    serverTimestamp: jest.fn(),
  },
  getFirestore: jest.fn(),
}));

describe('Apple 로그인 API', () => {
  const verifyIdToken = jest.fn();
  const createChallenge = jest.fn();
  const requestCustomTokenWithChallenge = jest.fn();
  const requestCustomTokenWithIdToken = jest.fn();
  const linkProvider = jest.fn();
  const requestRefreshToken = jest.fn();
  const refreshAccessToken = jest.fn();
  const revokeAccessToken = jest.fn();
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FIREBASE_APP_TOKEN)
      .useValue({})
      .overrideProvider(FIREBASE_AUTH_TOKEN)
      .useValue({ verifyIdToken })
      .overrideProvider(FIREBASE_FIRESTORE_TOKEN)
      .useValue({})
      .overrideProvider(AppleAuthenticationService)
      .useValue({
        createChallenge,
        requestCustomTokenWithChallenge,
        requestCustomTokenWithIdToken,
        linkProvider,
        requestRefreshToken,
        refreshAccessToken,
        revokeAccessToken,
      })
      .compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    verifyIdToken.mockReset().mockResolvedValue({ uid: 'user-1' });
    createChallenge.mockReset().mockResolvedValue({
      challengeId: 'challenge-1',
      hashedNonce: 'hashed-nonce',
      expiresAt: '2026-08-06T00:05:00.000Z',
    });
    requestCustomTokenWithChallenge
      .mockReset()
      .mockResolvedValue('custom-token');
    requestCustomTokenWithIdToken.mockReset().mockResolvedValue('custom-token');
    linkProvider.mockReset().mockResolvedValue(undefined);
    requestRefreshToken.mockReset().mockResolvedValue('refresh-token');
    refreshAccessToken.mockReset().mockResolvedValue('access-token');
    revokeAccessToken.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('인증 token 없이 Apple challenge를 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/challenges')
      .expect(HttpStatus.OK)
      .expect({
        challengeId: 'challenge-1',
        hashedNonce: 'hashed-nonce',
        expiresAt: '2026-08-06T00:05:00.000Z',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(createChallenge).toHaveBeenCalledWith();
  });

  it('인증 token 없이 challenge 요청의 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .send({
        challengeId: ' challenge-1 ',
        authorizationCode: ' authorization-code ',
        displayName: ' Apple User ',
      })
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(requestCustomTokenWithChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'authorization-code',
      'Apple User',
    );
  });

  it('인증 token 없이 기존 요청의 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .send({
        idToken: ' legacy-id-token ',
        authorizationCode: ' authorization-code ',
      })
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(requestCustomTokenWithIdToken).toHaveBeenCalledWith(
      'legacy-id-token',
      'authorization-code',
    );
  });

  it('text/plain JSON challenge 요청의 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .set('Content-Type', 'text/plain')
      .send(
        JSON.stringify({
          challengeId: ' challenge-1 ',
          authorizationCode: ' authorization-code ',
          displayName: ' Apple User ',
        }),
      )
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(requestCustomTokenWithChallenge).toHaveBeenCalledWith(
      'challenge-1',
      'authorization-code',
      'Apple User',
    );
  });

  it('Buffer JSON 기존 요청의 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .set('Content-Type', 'application/octet-stream')
      .send(
        Buffer.from(
          JSON.stringify({
            idToken: ' legacy-id-token ',
            authorizationCode: ' authorization-code ',
          }),
        ),
      )
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(requestCustomTokenWithIdToken).toHaveBeenCalledWith(
      'legacy-id-token',
      'authorization-code',
    );
  });

  it('요청 형식 식별 값이 없으면 idToken 오류를 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .send({ authorizationCode: 'authorization-code' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'idToken가 필요합니다.',
      });

    expect(requestCustomTokenWithChallenge).not.toHaveBeenCalled();
    expect(requestCustomTokenWithIdToken).not.toHaveBeenCalled();
  });

  it('문자열이 아닌 displayName을 오류 body로 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/custom-token')
      .send({
        challengeId: 'challenge-1',
        authorizationCode: 'authorization-code',
        displayName: 1,
      })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'displayName 형식이 올바르지 않습니다.',
      });
  });

  it('Service의 Apple challenge 오류 계약을 반환한다', async () => {
    const server = app.getHttpServer() as Server;
    requestCustomTokenWithChallenge.mockRejectedValue(
      new ApiException(
        HttpStatus.GONE,
        'expired-apple-challenge',
        'Apple 인증 challenge가 만료되었습니다.',
      ),
    );

    await request(server)
      .post('/api/auth/apple/custom-token')
      .send({
        challengeId: 'challenge-1',
        authorizationCode: 'authorization-code',
      })
      .expect(HttpStatus.GONE)
      .expect({
        code: 'expired-apple-challenge',
        message: 'Apple 인증 challenge가 만료되었습니다.',
      });
  });

  it('인증된 사용자의 Apple provider를 연결한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/apple/account-link')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({
        challengeId: ' challenge-1 ',
        authorizationCode: ' authorization-code ',
        credentialEmail: ' user@example.com ',
      })
      .expect(HttpStatus.OK)
      .expect({ success: true });

    expect(verifyIdToken).toHaveBeenCalledWith('firebase-id-token');
    expect(linkProvider).toHaveBeenCalledWith(
      'user-1',
      'challenge-1',
      'authorization-code',
      'user@example.com',
    );
  });

  it('인증 token 없는 Apple provider 연결을 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/apple/account-link')
      .send({
        challengeId: 'challenge-1',
        authorizationCode: 'authorization-code',
      })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(linkProvider).not.toHaveBeenCalled();
  });

  it('인증된 사용자의 Apple refresh token을 저장해 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/refresh-token')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ authorizationCode: ' authorization-code ' })
      .expect(HttpStatus.OK)
      .expect({ success: true, refreshToken: 'refresh-token' });

    expect(requestRefreshToken).toHaveBeenCalledWith(
      'user-1',
      'authorization-code',
    );
  });

  it('인증 token 없는 Apple refresh token 요청을 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/refresh-token')
      .send({ authorizationCode: 'authorization-code' })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(requestRefreshToken).not.toHaveBeenCalled();
  });

  it('인증된 사용자의 Apple access token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/access-token')
      .set('Authorization', 'Bearer firebase-id-token')
      .expect(HttpStatus.OK)
      .expect({ token: 'access-token' });

    expect(refreshAccessToken).toHaveBeenCalledWith('user-1');
  });

  it('인증 token 없는 Apple access token 요청을 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/apple/access-token')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it('인증된 사용자의 Apple access token을 폐기한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/apple/access-token')
      .set('Authorization', 'Bearer firebase-id-token')
      .send({ token: ' legacy-access-token ' })
      .expect(HttpStatus.OK)
      .expect({ success: true });

    expect(revokeAccessToken).toHaveBeenCalledWith(
      'user-1',
      ' legacy-access-token ',
    );
  });

  it('인증 token 없는 Apple access token 폐기를 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/apple/access-token')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(revokeAccessToken).not.toHaveBeenCalled();
  });
});
