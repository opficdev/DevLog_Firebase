import { cloudRunLogger } from './cloud-run.logger';

describe('Cloud Run logger', () => {
  it('오류를 ANSI 문자 없이 한 JSON 행으로 기록한다', () => {
    const stderrWrite = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);

    cloudRunLogger.error({
      message: '요청 실패',
      errorCode: 'auth/insufficient-permission',
      errorMessage: '권한이 없습니다.',
      errorStack: 'first\nsecond',
    });

    expect(stderrWrite).toHaveBeenCalledTimes(1);
    const output = String(stderrWrite.mock.calls[0][0]);
    expect(output.match(/\n/g)).toHaveLength(1);
    expect(output).not.toContain('\u001b[');
    expect(JSON.parse(output)).toMatchObject({
      level: 'error',
      message: {
        message: '요청 실패',
        errorCode: 'auth/insufficient-permission',
        errorMessage: '권한이 없습니다.',
        errorStack: 'first\nsecond',
      },
    });

    stderrWrite.mockRestore();
  });
});
