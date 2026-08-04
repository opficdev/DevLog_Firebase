import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { WebPagesRepository } from './web-pages.repository';

describe(WebPagesRepository.name, () => {
  const uid = 'user-1';
  const webPageId = 'web-page-1';

  it.each([
    { snapshot: { exists: false }, expected: 'missing' },
    {
      snapshot: { exists: true, data: () => ({ title: 'WebPage' }) },
      expected: 'active',
    },
    {
      snapshot: { exists: true, data: () => ({ isDeleted: true }) },
      expected: 'deleted',
    },
  ])(
    'WebPage 삭제 상태 $expected를 반환한다',
    async ({ snapshot, expected }) => {
      const get = jest.fn().mockResolvedValue(snapshot);
      const doc = jest.fn().mockReturnValue({ get });
      const repository = new WebPagesRepository({
        doc,
      } as unknown as Firestore);

      await expect(
        repository.getWebPageDeletionState(uid, webPageId),
      ).resolves.toBe(expected);
      expect(doc).toHaveBeenCalledWith('users/user-1/webPages/web-page-1');
    },
  );

  it('WebPage에 삭제 요청 상태를 기록한다', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ set });
    const repository = new WebPagesRepository({
      doc,
    } as unknown as Firestore);

    await repository.markWebPageDeletionRequested(uid, webPageId);

    expect(doc).toHaveBeenCalledWith('users/user-1/webPages/web-page-1');
    expect(set).toHaveBeenCalledWith(
      {
        deletingAt: FieldValue.delete(),
        isDeleted: true,
      },
      { merge: true },
    );
  });

  it('WebPage 삭제 상태를 복구한다', async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    const doc = jest.fn().mockReturnValue({ update });
    const repository = new WebPagesRepository({
      doc,
    } as unknown as Firestore);

    await repository.restoreWebPageDeletion(uid, webPageId);

    expect(doc).toHaveBeenCalledWith('users/user-1/webPages/web-page-1');
    expect(update).toHaveBeenCalledWith({
      deletingAt: FieldValue.delete(),
      isDeleted: false,
    });
  });
});
