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
import { GitHubAuthenticationService } from '../src/github/github-authentication.service';

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

describe('GitHub 인증 API', () => {
  const verifyIdToken = jest.fn();
  const createSignInSession = jest.fn();
  const createAccountLinkSession = jest.fn();
  const callback = jest.fn();
  const customToken = jest.fn();
  const link = jest.fn();
  const revoke = jest.fn();
  const unlink = jest.fn();
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
      .overrideProvider(GitHubAuthenticationService)
      .useValue({
        createSignInSession,
        createAccountLinkSession,
        callback,
        customToken,
        link,
        revoke,
        unlink,
      })
      .compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    verifyIdToken.mockReset().mockResolvedValue({ uid: 'user-1' });
    createSignInSession.mockReset().mockResolvedValue({
      authorizationURL: 'https://github.com/login/oauth/authorize',
    });
    createAccountLinkSession.mockReset().mockResolvedValue({
      authorizationURL: 'https://github.com/login/oauth/authorize',
    });
    callback
      .mockReset()
      .mockResolvedValue('devlog://oauth-callback?ticket=ticket-1');
    customToken.mockReset().mockResolvedValue('custom-token');
    link.mockReset().mockResolvedValue(undefined);
    revoke.mockReset().mockResolvedValue(undefined);
    unlink.mockReset().mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await app.close();
  });

  it('인증 token 없이 로그인 session을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/sign-in-sessions')
      .send({ appChallenge: ' app-challenge ' })
      .expect(HttpStatus.OK)
      .expect({
        authorizationURL: 'https://github.com/login/oauth/authorize',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(createSignInSession).toHaveBeenCalledWith('app-challenge');
  });

  it('appChallenge가 없으면 invalid-argument로 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/sign-in-sessions')
      .send({ appChallenge: ' ' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'appChallenge가 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(createSignInSession).not.toHaveBeenCalled();
  });

  it('인증된 UID로 계정 연결 session을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/account-link-sessions')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .send({ appChallenge: ' app-challenge ' })
      .expect(HttpStatus.OK)
      .expect({
        authorizationURL: 'https://github.com/login/oauth/authorize',
      });

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(createAccountLinkSession).toHaveBeenCalledWith(
      'user-1',
      'app-challenge',
    );
  });

  it('계정 연결 session에 인증 token이 없으면 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/account-link-sessions')
      .send({ appChallenge: 'app-challenge' })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(createAccountLinkSession).not.toHaveBeenCalled();
  });

  it('인증 token 없이 callback 결과를 앱 주소로 redirect한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .get('/api/auth/github/callback?state=state-1&code=code-1')
      .expect(HttpStatus.FOUND)
      .expect('Location', 'devlog://oauth-callback?ticket=ticket-1');

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith('state-1', 'code-1');
  });

  it('callback 실패도 안전한 앱 주소로 redirect한다', async () => {
    const server = app.getHttpServer() as Server;
    callback.mockResolvedValue('devlog://oauth-callback?error=oauth-failed');

    await request(server)
      .get('/api/auth/github/callback')
      .expect(HttpStatus.FOUND)
      .expect('Location', 'devlog://oauth-callback?error=oauth-failed');

    expect(callback).toHaveBeenCalledWith(undefined, undefined);
  });

  it('인증 token 없이 ticket으로 custom token을 반환한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/custom-token')
      .send({ ticket: ' ticket-1 ', appVerifier: ' app-verifier ' })
      .expect(HttpStatus.OK)
      .expect({ customToken: 'custom-token' });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(customToken).toHaveBeenCalledWith('ticket-1', 'app-verifier');
  });

  it('ticket이 없으면 custom token 요청을 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .post('/api/auth/github/custom-token')
      .send({ appVerifier: 'app-verifier' })
      .expect(HttpStatus.BAD_REQUEST)
      .expect({
        code: 'invalid-argument',
        message: 'ticket가 필요합니다.',
      });

    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(customToken).not.toHaveBeenCalled();
  });

  it('인증된 UID와 ticket으로 GitHub 계정을 연결한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/github/account-link')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .send({ ticket: ' ticket-1 ', appVerifier: ' app-verifier ' })
      .expect(HttpStatus.NO_CONTENT);

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(link).toHaveBeenCalledWith('user-1', 'ticket-1', 'app-verifier');
  });

  it('GitHub 계정 연결 요청에 인증 token이 없으면 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .put('/api/auth/github/account-link')
      .send({ ticket: 'ticket-1', appVerifier: 'app-verifier' })
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(link).not.toHaveBeenCalled();
  });

  it.each([
    [
      HttpStatus.FORBIDDEN,
      'mismatched-oauth-ticket',
      'OAuth ticket 결합 정보가 일치하지 않습니다.',
    ],
    [
      HttpStatus.CONFLICT,
      'github-email-changed-account-conflict',
      'GitHub provider가 다른 계정에 연결되어 있습니다.',
    ],
    [HttpStatus.BAD_REQUEST, 'email-mismatch', '이메일이 일치하지 않습니다.'],
  ])(
    'GitHub 계정 연결 오류 %s %s 계약을 반환한다',
    async (status, code, message) => {
      const server = app.getHttpServer() as Server;
      link.mockRejectedValueOnce(new ApiException(status, code, message));

      await request(server)
        .put('/api/auth/github/account-link')
        .set('Authorization', 'Bearer Firebase-ID-Token')
        .send({ ticket: 'ticket-1', appVerifier: 'app-verifier' })
        .expect(status)
        .expect({ code, message });
    },
  );

  it('인증된 UID의 GitHub grant와 credential을 폐기한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/github/access-token')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .expect(HttpStatus.NO_CONTENT);

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(revoke).toHaveBeenCalledWith('user-1');
  });

  it('GitHub grant 폐기 요청에 인증 token이 없으면 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/github/access-token')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(revoke).not.toHaveBeenCalled();
  });

  it('GitHub grant 폐기 실패의 기존 오류 계약을 반환한다', async () => {
    const server = app.getHttpServer() as Server;
    revoke.mockRejectedValueOnce(
      new ApiException(
        HttpStatus.BAD_GATEWAY,
        'github-revoke-failed',
        'GitHub OAuth App grant 제거에 실패했습니다.',
      ),
    );

    await request(server)
      .delete('/api/auth/github/access-token')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .expect(HttpStatus.BAD_GATEWAY)
      .expect({
        code: 'github-revoke-failed',
        message: 'GitHub OAuth App grant 제거에 실패했습니다.',
      });
  });

  it('인증된 UID의 GitHub provider 연결을 해제한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/github/account-link')
      .set('Authorization', 'Bearer Firebase-ID-Token')
      .expect(HttpStatus.NO_CONTENT);

    expect(verifyIdToken).toHaveBeenCalledWith('Firebase-ID-Token');
    expect(unlink).toHaveBeenCalledWith('user-1');
  });

  it('GitHub provider 해제 요청에 인증 token이 없으면 거부한다', async () => {
    const server = app.getHttpServer() as Server;

    await request(server)
      .delete('/api/auth/github/account-link')
      .expect(HttpStatus.UNAUTHORIZED)
      .expect({
        code: 'unauthenticated',
        message: '인증 토큰이 필요합니다.',
      });

    expect(unlink).not.toHaveBeenCalled();
  });
});
