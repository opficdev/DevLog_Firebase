import { HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Server } from 'node:http';
import request from 'supertest';

import { configureApplication } from '../src/app.config';
import { AppModule } from '../src/app.module';
import { ApiException } from '../src/common/api.exception';
import {
  FIREBASE_APP_TOKEN,
  FIREBASE_AUTH_TOKEN,
  FIREBASE_FIRESTORE_TOKEN,
} from '../src/firebase/firebase.tokens';
import { WebPagesService } from '../src/web-pages/web-pages.service';

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

describe('WebPage 삭제 API', () => {
  const uid = 'user-1';
  const token = 'Firebase-ID-Token';
  const verifyIdToken = jest.fn();
  const requestDeletion = jest.fn();
  const undoDeletion = jest.fn();
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
      .overrideProvider(WebPagesService)
      .useValue({ requestDeletion, undoDeletion })
      .compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    verifyIdToken.mockReset().mockResolvedValue({ uid });
    requestDeletion.mockReset().mockResolvedValue(undefined);
    undoDeletion.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('검증된 UID와 공백을 제거한 WebPage ID로 삭제를 요청한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/web-pages/%20web-page-1%20/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect({ success: true });

    expect(verifyIdToken).toHaveBeenCalledWith(token);
    expect(requestDeletion).toHaveBeenCalledWith(uid, 'web-page-1');
  });

  it('공백인 WebPage ID를 invalid-argument로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/web-pages/%20/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ code: 'invalid-argument', message: 'id가 필요합니다.' });

    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('인증 token이 없으면 unauthenticated로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/web-pages/web-page-1/deletion-request')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('Firebase Auth 오류를 401 응답으로 보존한다', async () => {
    const server = app.getHttpServer() as Server;
    verifyIdToken.mockRejectedValue({
      code: 'auth/id-token-expired',
      message: 'Firebase ID token has expired.',
    });

    await request(server)
      .post('/api/web-pages/web-page-1/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'auth/id-token-expired',
        message: 'Firebase ID token has expired.',
      });

    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('WebPage가 없으면 Service의 not-found 오류를 반환한다', async () => {
    const server = app.getHttpServer() as Server;
    requestDeletion.mockRejectedValue(
      new ApiException(
        HttpStatus.NOT_FOUND,
        'not-found',
        'WebPage를 찾을 수 없습니다.',
      ),
    );

    await request(server)
      .post('/api/web-pages/web-page-1/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.NOT_FOUND)
      .expect({ code: 'not-found', message: 'WebPage를 찾을 수 없습니다.' });
  });

  it('삭제 요청 실패를 Service의 internal 오류로 반환한다', async () => {
    const server = app.getHttpServer() as Server;
    requestDeletion.mockRejectedValue(
      new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '웹페이지 삭제 요청에 실패했습니다.',
      ),
    );

    await request(server)
      .post('/api/web-pages/web-page-1/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.INTERNAL_SERVER_ERROR)
      .expect({
        code: 'internal',
        message: '웹페이지 삭제 요청에 실패했습니다.',
      });
  });

  it('검증된 UID와 공백을 제거한 WebPage ID로 삭제를 취소한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/web-pages/%20web-page-1%20/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.OK)
      .expect({ success: true });

    expect(verifyIdToken).toHaveBeenCalledWith(token);
    expect(undoDeletion).toHaveBeenCalledWith(uid, 'web-page-1');
  });

  it('삭제 취소에서 인증 token이 없으면 unauthenticated로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/web-pages/web-page-1/deletion-request')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(undoDeletion).not.toHaveBeenCalled();
  });

  it('삭제 취소에서 공백인 WebPage ID를 invalid-argument로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/web-pages/%20/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.BAD_REQUEST)
      .expect({ code: 'invalid-argument', message: 'id가 필요합니다.' });

    expect(undoDeletion).not.toHaveBeenCalled();
  });

  it('삭제 취소 실패를 Service의 internal 오류로 반환한다', async () => {
    const server = app.getHttpServer() as Server;
    undoDeletion.mockRejectedValue(
      new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '웹페이지 삭제 취소에 실패했습니다.',
      ),
    );

    await request(server)
      .delete('/api/web-pages/web-page-1/deletion-request')
      .set('Authorization', `Bearer ${token}`)
      .expect(HttpStatus.INTERNAL_SERVER_ERROR)
      .expect({
        code: 'internal',
        message: '웹페이지 삭제 취소에 실패했습니다.',
      });
  });
});
