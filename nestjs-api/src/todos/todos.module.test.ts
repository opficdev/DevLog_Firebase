import { type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';

import { FirebaseModule } from '../firebase/firebase.module';
import { TodosModule } from './todos.module';
import { TodosRepository } from './todos.repository';
import { TodosService } from './todos.service';

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

describe(TodosModule.name, () => {
  it('FirebaseModule과 Todo provider를 구성한다', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      TodosModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      TodosModule,
    ) as Provider[];

    expect(imports).toContain(FirebaseModule);
    expect(providers).toEqual(
      expect.arrayContaining([TodosRepository, TodosService]),
    );
  });
});
