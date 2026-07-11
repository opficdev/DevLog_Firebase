// Apple OAuth 환경 설정을 나타냅니다.
export interface AppleConfiguration {
    // Apple Developer team id를 저장합니다.
    teamId: string;
    // Apple OAuth client id를 저장합니다.
    clientId: string;
    // Apple Sign in with Apple key id를 저장합니다.
    keyId: string;
    // Apple client secret 서명용 private key를 저장합니다.
    privateKey: string;
}
