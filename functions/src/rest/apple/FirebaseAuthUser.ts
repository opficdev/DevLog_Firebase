// Apple 인증 처리에 필요한 Firebase Auth 사용자 정보를 나타냅니다.
export interface FirebaseAuthUser {
    // Firebase Auth 사용자 uid를 저장합니다.
    uid: string;
    // Firebase Auth 사용자 이메일을 저장합니다.
    email?: string;
    // Firebase Auth 사용자 provider 목록을 저장합니다.
    providerData?: Array<{
        // 연결된 provider id를 저장합니다.
        providerId: string;
        // 연결된 provider 사용자 uid를 저장합니다.
        uid: string;
    }>;
}
