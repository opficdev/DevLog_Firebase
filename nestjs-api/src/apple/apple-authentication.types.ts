// Apple OAuth 요청에 필요한 project별 설정입니다.
export interface AppleAuthenticationConfiguration {
  // Apple Developer team 식별자를 저장합니다.
  teamId: string;
  // Apple OAuth client 공개 식별자를 저장합니다.
  clientId: string;
  // Apple Sign in with Apple key 식별자를 저장합니다.
  keyId: string;
  // Apple client secret 서명용 private key를 저장합니다.
  privateKey: string;
}

// 서버가 Apple 인증 처리에 사용할 token 묶음입니다.
export interface AppleOAuthToken {
  // Apple API 요청과 grant 폐기에 사용할 access token을 저장합니다.
  accessToken?: string;
  // 서버에 보관하고 grant 폐기에 사용할 refresh token을 저장합니다.
  refreshToken?: string;
  // 사용자 식별과 nonce 검증에 사용할 ID token을 저장합니다.
  idToken?: string;
}

// 검증된 Apple ID token의 인증·프로필 claim입니다.
export interface AppleTokenPayload {
  // token 발행자를 저장합니다.
  iss: string;
  // 변경되지 않는 Apple 사용자 식별자를 저장합니다.
  sub: string;
  // token을 발급받은 OAuth client 식별자를 저장합니다.
  aud: string;
  // token 발행 시각을 저장합니다.
  iat: number;
  // token 만료 시각을 저장합니다.
  exp: number;
  // Apple 계정 이메일을 저장합니다.
  email?: string;
  // 이메일 검증 여부를 저장합니다.
  email_verified?: boolean | string;
  // 비공개 릴레이 이메일 여부를 저장합니다.
  is_private_email?: boolean | string;
  // challenge에서 전달한 nonce hash를 저장합니다.
  nonce?: string;
  // nonce 지원 여부를 저장합니다.
  nonce_supported?: boolean;
  // 실제 사용자 상태를 저장합니다.
  real_user_status?: number;
  // 사용자 인증 시각을 저장합니다.
  auth_time?: number;
}
