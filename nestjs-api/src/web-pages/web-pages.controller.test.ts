import { HttpStatus } from '@nestjs/common';

import { type FirebaseAuthenticatedRequest } from '../auth/firebase-authenticated-request';
import { WebPagesController } from './web-pages.controller';
import { WebPagesService } from './web-pages.service';

describe(WebPagesController.name, () => {
  const uid = 'user-1';
  const request = { uid } as FirebaseAuthenticatedRequest;

  it('검증된 UID와 공백을 제거한 WebPage ID로 삭제를 요청한다', async () => {
    const requestDeletion = jest.fn().mockResolvedValue(undefined);
    const service = {
      requestDeletion,
    } as unknown as WebPagesService;
    const controller = new WebPagesController(service);

    await expect(
      controller.requestDeletion(request, ' web-page-1 '),
    ).resolves.toEqual({ success: true });
    expect(requestDeletion).toHaveBeenCalledWith(uid, 'web-page-1');
  });

  it('검증된 UID와 공백을 제거한 WebPage ID로 삭제를 취소한다', async () => {
    const undoDeletion = jest.fn().mockResolvedValue(undefined);
    const service = { undoDeletion } as unknown as WebPagesService;
    const controller = new WebPagesController(service);

    await expect(
      controller.undoDeletion(request, ' web-page-1 '),
    ).resolves.toEqual({ success: true });
    expect(undoDeletion).toHaveBeenCalledWith(uid, 'web-page-1');
  });

  it('공백인 WebPage ID를 invalid-argument로 거부한다', async () => {
    const requestDeletion = jest.fn();
    const service = {
      requestDeletion,
    } as unknown as WebPagesService;
    const controller = new WebPagesController(service);

    await expect(
      controller.requestDeletion(request, ' '),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
      response: {
        code: 'invalid-argument',
        message: 'id가 필요합니다.',
      },
    });
    expect(requestDeletion).not.toHaveBeenCalled();
  });

  it('검증된 UID가 없으면 unauthenticated로 거부한다', async () => {
    const requestDeletion = jest.fn();
    const service = {
      requestDeletion,
    } as unknown as WebPagesService;
    const controller = new WebPagesController(service);

    await expect(
      controller.requestDeletion(
        {} as FirebaseAuthenticatedRequest,
        'web-page-1',
      ),
    ).rejects.toMatchObject({
      status: HttpStatus.UNAUTHORIZED,
      response: {
        code: 'unauthenticated',
        message: '인증된 사용자가 아닙니다.',
      },
    });
    expect(requestDeletion).not.toHaveBeenCalled();
  });
});
