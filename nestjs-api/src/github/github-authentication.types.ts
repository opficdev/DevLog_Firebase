// GitHub OAuth App 요청에 필요한 환경별 설정입니다.
export interface GitHubAuthenticationConfiguration {
  // OAuth App 공개 식별자를 저장합니다.
  clientId: string;
  // OAuth App 비밀값을 저장합니다.
  clientSecret: string;
  // GitHub가 호출할 callback 주소를 저장합니다.
  callbackURL: string;
}

// GitHub 사용자 API에서 인증 판단에 사용하는 프로필입니다.
export interface GitHubUser {
  // GitHub 계정의 숫자 식별자를 저장합니다.
  id: number;
  // GitHub 로그인 이름을 저장합니다.
  login: string;
  // 공개 표시 이름을 저장합니다.
  name?: string;
  // 공개 이메일을 저장합니다.
  email?: string;
  // 공개 프로필 이미지 주소를 저장합니다.
  avatar_url?: string;
}

// 서버에서 보관하는 GitHub OAuth credential입니다.
export interface GitHubCredential {
  // GitHub 사용자 access token을 저장합니다.
  accessToken: string;
  // access token을 발급한 OAuth App client id를 저장합니다.
  clientId: string;
}

// GitHub OAuth session 생성 응답입니다.
export interface GitHubOAuthSessionResponse {
  // 앱이 열 GitHub authorization 주소를 저장합니다.
  authorizationURL: string;
}
