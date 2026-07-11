// Apple token 교환 응답에서 사용하는 자격 증명 정보를 나타냅니다.
export interface AppleTokenResponse {
    // Apple API access token을 저장합니다.
    access_token?: string;
    // 서버에 보관할 Apple refresh token을 저장합니다.
    refresh_token?: string;
    // 검증할 Apple ID token을 저장합니다.
    id_token?: string;
    // access token 형식을 저장합니다.
    token_type?: string;
    // access token 만료 시간을 초 단위로 저장합니다.
    expires_in?: number;
}
