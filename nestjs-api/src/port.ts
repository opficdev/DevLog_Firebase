const DEFAULT_PORT = 8080;
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/** 환경 변수의 포트를 서버가 사용할 수 있는 정수로 변환합니다. */
export function resolvePort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < MIN_PORT || MAX_PORT < port) {
    throw new Error('PORT는 1부터 65535 사이의 정수여야 합니다.');
  }

  return port;
}
