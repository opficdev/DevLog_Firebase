// GitHub OAuth App 요청에 필요한 환경별 설정입니다.
export interface GitHubAuthenticationConfiguration {
  // OAuth App 공개 식별자를 저장합니다.
  clientId: string;
  // OAuth App 비밀값을 저장합니다.
  clientSecret: string;
  // GitHub가 호출할 callback 주소를 저장합니다.
  callbackURL: string;
}
