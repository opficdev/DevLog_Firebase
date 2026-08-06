// OAuth 요청 목적입니다.
export type OAuthPurpose = 'signIn' | 'link';

// OAuth session 생성에 필요한 서버 저장 값입니다.
export interface OAuthSessionInput {
  // 인증 공급자를 저장합니다.
  provider: string;
  // 로그인 또는 계정 연결 목적을 저장합니다.
  purpose: OAuthPurpose;
  // 앱 verifier에서 계산한 challenge를 저장합니다.
  appChallenge: string;
  // 공급자 PKCE 교환에 사용할 서버 전용 verifier를 저장합니다.
  providerPKCEVerifier: string;
  // 계정 연결을 요청한 Firebase uid를 저장합니다.
  uid?: string;
}

// OAuth session 생성 결과입니다.
export interface OAuthSessionCreation {
  // callback 검증에 사용할 임의 state를 저장합니다.
  state: string;
  // 공급자 PKCE 요청에 사용할 challenge를 저장합니다.
  providerPKCEChallenge: string;
  // session 만료 시각을 저장합니다.
  expiresAt: Date;
}

// callback 처리를 위해 claim한 OAuth session입니다.
export interface ClaimedOAuthSession {
  // callback 처리 소유권을 확인할 임의 값을 저장합니다.
  claim: string;
  // session을 식별하는 state를 저장합니다.
  state: string;
  // 인증 공급자를 저장합니다.
  provider: string;
  // 로그인 또는 계정 연결 목적을 저장합니다.
  purpose: OAuthPurpose;
  // 앱 verifier 검증에 사용할 challenge를 저장합니다.
  appChallenge: string;
  // 공급자 code 교환에 사용할 서버 전용 verifier를 저장합니다.
  providerPKCEVerifier: string;
  // 계정 연결을 요청한 Firebase uid를 저장합니다.
  uid?: string;
}

// callback 완료 뒤 ticket에 보관할 provider 결과입니다.
export interface OAuthTicketInput {
  // callback이 처리한 session을 저장합니다.
  session: ClaimedOAuthSession;
  // ticket 교환까지 서버에만 보관할 provider 결과를 저장합니다.
  payload: Record<string, unknown>;
}

// ticket 교환 처리를 위해 claim한 값입니다.
export interface ClaimedOAuthTicket {
  // ticket 처리 소유권을 확인할 임의 값을 저장합니다.
  claim: string;
  // ticket 식별자를 저장합니다.
  ticket: string;
  // 원본 session 식별자를 저장합니다.
  sessionId: string;
  // 인증 공급자를 저장합니다.
  provider: string;
  // 로그인 또는 계정 연결 목적을 저장합니다.
  purpose: OAuthPurpose;
  // 계정 연결을 요청한 Firebase uid를 저장합니다.
  uid?: string;
  // provider 처리를 완료할 서버 전용 결과를 저장합니다.
  payload: Record<string, unknown>;
}
