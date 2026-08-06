// Google OAuth 요청에 필요한 project별 설정입니다.
export interface GoogleAuthenticationConfiguration {
  // OAuth client 공개 식별자를 저장합니다.
  clientId: string;

  // OAuth client 비밀값을 저장합니다.
  clientSecret: string;
}

// 서버가 Google 인증 처리에 사용할 token 묶음입니다.
export interface GoogleOAuthToken {
  // Google API 요청과 grant 폐기에 사용할 access token을 저장합니다.
  accessToken: string;

  // 사용자 식별과 프로필 검증에 사용할 ID token을 저장합니다.
  idToken: string;

  // 장기 grant 폐기에 사용할 선택적인 refresh token을 저장합니다.
  refreshToken?: string;
}

// 검증된 Google ID token의 인증·프로필 claim입니다.
export interface GoogleTokenPayload {
  // token 발행자를 저장합니다.
  iss: string;

  // 변경되지 않는 Google 사용자 식별자를 저장합니다.
  sub: string;

  // token을 발급받은 OAuth client 식별자를 저장합니다.
  aud: string;

  // token 발행 시각을 저장합니다.
  iat: number;

  // token 만료 시각을 저장합니다.
  exp: number;

  // Google 계정 이메일을 저장합니다.
  email?: string;

  // 이메일 검증 여부를 저장합니다.
  email_verified?: boolean;

  // 사용자 표시 이름을 저장합니다.
  name?: string;

  // 사용자 프로필 이미지 주소를 저장합니다.
  picture?: string;
}

// 서버에서 보관하는 Google OAuth credential입니다.
export interface GoogleCredential {
  // 최근 Google access token을 저장합니다.
  accessToken: string;

  // access token을 발급한 OAuth client 식별자를 저장합니다.
  clientId: string;

  // 장기 grant 폐기에 사용할 refresh token을 저장합니다.
  refreshToken?: string;
}
