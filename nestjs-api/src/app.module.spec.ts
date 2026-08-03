import { Test } from '@nestjs/testing';
import {
  applicationDefault,
  type App,
  type Credential,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import { type Auth, getAuth } from 'firebase-admin/auth';
import { type Firestore, getFirestore } from 'firebase-admin/firestore';

import { AppModule } from './app.module';

jest.mock('firebase-admin/app', () => ({
  applicationDefault: jest.fn(),
  getApps: jest.fn(),
  initializeApp: jest.fn(),
}));
jest.mock('firebase-admin/auth', () => ({
  getAuth: jest.fn(),
}));
jest.mock('firebase-admin/firestore', () => ({
  getFirestore: jest.fn(),
}));

const mockedApplicationDefault = jest.mocked(applicationDefault);
const mockedGetApps = jest.mocked(getApps);
const mockedInitializeApp = jest.mocked(initializeApp);
const mockedGetAuth = jest.mocked(getAuth);
const mockedGetFirestore = jest.mocked(getFirestore);

describe(AppModule.name, () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('FirebaseModule을 명시적으로 구성한다', async () => {
    const app = { name: '[DEFAULT]' } as App;
    const auth = {} as Auth;
    const firestore = {} as Firestore;
    mockedGetApps.mockReturnValue([app]);
    mockedGetAuth.mockReturnValue(auth);
    mockedGetFirestore.mockReturnValue(firestore);

    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(mockedGetAuth).toHaveBeenCalledWith(app);
    expect(mockedGetFirestore).toHaveBeenCalledWith(app);

    await module.close();
  });

  it('Firebase App 초기화 오류가 발생하면 구성을 중단한다', async () => {
    const credential = {} as Credential;
    const error = new Error('Firebase App 초기화 실패');
    mockedGetApps.mockReturnValue([]);
    mockedApplicationDefault.mockReturnValue(credential);
    mockedInitializeApp.mockImplementation(() => {
      throw error;
    });

    await expect(
      Test.createTestingModule({
        imports: [AppModule],
      }).compile(),
    ).rejects.toBe(error);
  });
});
