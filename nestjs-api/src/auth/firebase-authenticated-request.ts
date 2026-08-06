/** Firebase 인증에 사용하는 HTTP header 정보입니다. */
export interface FirebaseAuthenticationHeaders {
  /** Firebase ID Token을 전달하는 Authorization 값을 저장합니다. */
  authorization?: string | string[];
}

/** Firebase 인증 전후에 사용하는 HTTP 요청 정보입니다. */
export interface FirebaseAuthenticatedRequest {
  /** Authorization을 포함한 HTTP header를 저장합니다. */
  headers: FirebaseAuthenticationHeaders;
  /** Firebase ID Token에서 검증된 사용자 식별자를 저장합니다. */
  uid?: string;
}
