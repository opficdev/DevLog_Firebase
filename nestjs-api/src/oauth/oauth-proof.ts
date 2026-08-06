import { createHash, randomBytes } from 'crypto';

// OAuth PKCE와 app proof에 사용할 임의 verifier를 생성합니다.
export function createOAuthVerifier(): string {
  return randomBytes(48).toString('base64url');
}

// verifier의 SHA-256 digest를 base64url 문자열로 변환합니다.
export function challengeFor(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
