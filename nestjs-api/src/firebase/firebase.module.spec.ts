import { Test } from '@nestjs/testing';
import {
  applicationDefault,
  type App,
  type Credential,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';

import { FirebaseModule } from './firebase.module';
import { FIREBASE_APP_TOKEN, FIREBASE_AUTH_TOKEN } from './firebase.tokens';

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));

const mockedApplicationDefault = jest.mocked(applicationDefault);
const mockedGetApps = jest.mocked(getApps);
const mockedInitializeApp = jest.mocked(initializeApp);
const mockedGetAuth = jest.mocked(getAuth);
const firebaseAuthConsumerToken = Symbol('FIREBASE_AUTH_CONSUMER_TOKEN');

describe(FirebaseModule.name, () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('기본 Firebase App이 있으면 재사용한다', async () => {
    const namedApp = { name: 'named' } as App;
    const app = { name: '[DEFAULT]' } as App;
    mockedGetApps.mockReturnValue([namedApp, app]);

    const module = await Test.createTestingModule({
      imports: [FirebaseModule],
    }).compile();

    expect(module.get(FIREBASE_APP_TOKEN)).toBe(app);
    expect(mockedApplicationDefault).not.toHaveBeenCalled();
    expect(mockedInitializeApp).not.toHaveBeenCalled();

    await module.close();
  });

  it('기본 Firebase App이 없으면 ADC로 초기화한다', async () => {
    const namedApp = { name: 'named' } as App;
    const credential = {} as Credential;
    const app = { name: '[DEFAULT]' } as App;
    mockedGetApps.mockReturnValue([namedApp]);
    mockedApplicationDefault.mockReturnValue(credential);
    mockedInitializeApp.mockReturnValue(app);

    const module = await Test.createTestingModule({
      imports: [FirebaseModule],
    }).compile();

    expect(mockedApplicationDefault).toHaveBeenCalledTimes(1);
    expect(mockedInitializeApp).toHaveBeenCalledWith({ credential });
    expect(module.get(FIREBASE_APP_TOKEN)).toBe(app);

    await module.close();
  });

  it('Firebase App 초기화 오류를 전파한다', async () => {
    const credential = {} as Credential;
    const error = new Error('Firebase App 초기화 실패');
    mockedGetApps.mockReturnValue([]);
    mockedApplicationDefault.mockReturnValue(credential);
    mockedInitializeApp.mockImplementation(() => {
      throw error;
    });

    await expect(
      Test.createTestingModule({
        imports: [FirebaseModule],
      }).compile(),
    ).rejects.toBe(error);
  });

  it('같은 Firebase App의 Auth를 외부 모듈에 제공한다', async () => {
    const app = { name: '[DEFAULT]' } as App;
    const auth = {} as Auth;
    mockedGetApps.mockReturnValue([app]);
    mockedGetAuth.mockReturnValue(auth);

    const module = await Test.createTestingModule({
      imports: [FirebaseModule],
      providers: [
        {
          provide: firebaseAuthConsumerToken,
          inject: [FIREBASE_AUTH_TOKEN],
          useFactory: (injectedAuth: Auth) => injectedAuth,
        },
      ],
    }).compile();

    expect(mockedGetAuth).toHaveBeenCalledWith(app);
    expect(module.get(firebaseAuthConsumerToken)).toBe(auth);

    await module.close();
  });
});
