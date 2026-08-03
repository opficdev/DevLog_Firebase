import { resolvePort } from './port';

describe(resolvePort.name, () => {
  it('값이 없으면 8080을 반환한다', () => {
    expect(resolvePort(undefined)).toBe(8080);
  });

  it.each([
    ['최솟값', '1', 1],
    ['최댓값', '65535', 65_535],
  ])('%s 범위의 포트를 반환한다', (_, value, expected) => {
    expect(resolvePort(value)).toBe(expected);
  });

  it.each(['0', '65536', '8080.5', 'invalid'])(
    '유효하지 않은 %s 값을 거부한다',
    (value) => {
      expect(() => resolvePort(value)).toThrow(
        'PORT는 1부터 65535 사이의 정수여야 합니다.',
      );
    },
  );
});
