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
      .useValue({ createSignInSession })
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
});
