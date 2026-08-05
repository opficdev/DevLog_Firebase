// prettier-ignore
import {
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';

import { ApiException } from '../common/api.exception';
import { WebPagesRepository } from './web-pages.repository';

// WebPage 삭제 요청과 취소 업무 규칙을 조정합니다.
@Injectable()
export class WebPagesService {
  // WebPage 삭제 처리 실패 원인을 기록하는 로그 기능입니다.
  private readonly logger = new Logger(WebPagesService.name);

  // WebPage 저장 동작을 제공하는 의존성을 주입받습니다.
  constructor(private readonly repository: WebPagesRepository) {}

  // 유효한 WebPage에 삭제 요청 상태를 기록합니다.
  // prettier-ignore
  async requestDeletion(
    uid: string,
    webPageId: string,
  ): Promise<void> {
    const state = await this.repository.getWebPageDeletionState(uid, webPageId);
    if (state !== 'active') {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'not-found',
        'WebPage를 찾을 수 없습니다.',
      );
    }

    try {
      await this.repository.markWebPageDeletionRequested(uid, webPageId);
    } catch (error) {
      await this.cleanupDeletionRequest(uid, webPageId);

      this.logger.error('웹페이지 삭제 요청 실패', error, {
        uid,
        webPageId,
      });
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '웹페이지 삭제 요청에 실패했습니다.',
      );
    }
  }

  // WebPage가 없거나 활성 상태여도 삭제 취소를 성공으로 처리합니다.
  // prettier-ignore
  async undoDeletion(
    uid: string,
    webPageId: string,
  ): Promise<void> {
    try {
      const state = await this.repository.getWebPageDeletionState(
        uid,
        webPageId,
      );
      if (state === 'deleted') {
        await this.repository.restoreWebPageDeletion(uid, webPageId);
      }
    } catch (error) {
      this.logger.error('웹페이지 삭제 취소 실패', error, {
        uid,
        webPageId,
      });
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'internal',
        '웹페이지 삭제 취소에 실패했습니다.',
      );
    }
  }

  // 삭제 요청 실패 후 현재 문서가 삭제 상태이면 복구합니다.
  private async cleanupDeletionRequest(
    uid: string,
    webPageId: string,
  ): Promise<void> {
    try {
      const state = await this.repository.getWebPageDeletionState(
        uid,
        webPageId,
      );
      if (state === 'deleted') {
        await this.repository.restoreWebPageDeletion(uid, webPageId);
      }
    } catch (error) {
      this.logger.error('웹페이지 삭제 요청 cleanup 실패', error, {
        uid,
        webPageId,
      });
    }
  }
}
