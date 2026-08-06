import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Server } from 'node:http';
import request from 'supertest';

import { configureApplication } from '../src/app.config';
import { AppModule } from '../src/app.module';
import {
  FIREBASE_APP_TOKEN,
  FIREBASE_AUTH_TOKEN,
  FIREBASE_FIRESTORE_TOKEN,
} from '../src/firebase/firebase.tokens';
import { GoogleAuthenticationService } from '../src/google/google-authentication.service';

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => ({
  FieldPath: { documentId: jest.fn() },
  FieldValue: {
    delete: jest.fn(),
    serverTimestamp: jest.fn(),
  },
  getFirestore: jest.fn(),
}));

describe('Google 인증 API', () => {
  const verifyIdToken = jest.fn();
  const customToken = jest.fn();
  const link = jest.fn();
  const unlink = jest.fn();
  const revoke = jest.fn();
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
      .overrideProvider(GoogleAuthenticationService)
      .useValue({ customToken, link, unlink, revoke })
      .compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    verifyIdToken.mockReset().mockResolvedValue({ uid: 'user-1' });
    customToken.mockReset().mockResolvedValue('custom-token');
    link.mockReset().mockResolvedValue(undefined);
    unlink.mockReset().mockResolvedValue(undefined);
    revoke.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('인증 token 없이 serverAuthCode로 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/google/authorization-code/custom-token')
      .send({ serverAuthCode: ' server-auth-code ' })
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(customToken).toHaveBeenCalledWith('server-auth-code');
  });

  it('serverAuthCode가 없으면 invalid-argument로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/google/authorization-code/custom-token')
      .send({ serverAuthCode: ' ' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'serverAuthCode가 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(customToken).not.toHaveBeenCalled();
  });

  it('인증된 UID로 Google 계정을 연결한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/google/authorization-code/account-link')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .send({ serverAuthCode: ' server-auth-code ' })
      .expect(HttpStatus.NO_CONTENT)
      .expect('');

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(link).toHaveBeenCalledWith('user-1', 'server-auth-code');
  });

  it('계정 연결에 인증 token이 없으면 unauthenticated로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/google/authorization-code/account-link')
      .send({ serverAuthCode: 'server-auth-code' })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(link).not.toHaveBeenCalled();
  });

  it('계정 연결에 serverAuthCode가 없으면 invalid-argument로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/google/authorization-code/account-link')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .send({ serverAuthCode: ' ' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'serverAuthCode가 필요합니다.',
      });

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(link).not.toHaveBeenCalled();
  });

  it('인증된 UID의 Google 계정 연결을 해제한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/google/account-link')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .expect(HttpStatus.NO_CONTENT)
      .expect('');

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(unlink).toHaveBeenCalledWith('user-1');
  });

  it('Google 계정 해제에 인증 token이 없으면 unauthenticated로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/google/account-link')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('인증된 UID의 Google grant와 credential을 폐기한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/google/access-token')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .expect(HttpStatus.NO_CONTENT)
      .expect('');

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(revoke).toHaveBeenCalledWith('user-1');
  });

  it('Google grant 폐기에 인증 token이 없으면 unauthenticated로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/google/access-token')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
