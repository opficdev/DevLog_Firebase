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
      .useValue({ customToken })
      .compile();

    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  beforeEach(() => {
    verifyIdToken.mockReset();
    customToken.mockReset().mockResolvedValue('custom-token');
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
});
