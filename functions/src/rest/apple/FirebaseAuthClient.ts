import type { UserProvider } from "firebase-admin/auth";
import type { FirebaseAuthUser } from "./FirebaseAuthUser";

// Apple 인증에서 사용하는 Firebase Auth 작업을 나타냅니다.
export interface FirebaseAuthClient {
    // uid로 Firebase Auth 사용자를 조회합니다.
    getUser(uid: string): Promise<FirebaseAuthUser>;
    // 이메일로 Firebase Auth 사용자를 조회합니다.
    getUserByEmail(email: string): Promise<FirebaseAuthUser>;
    // provider uid로 Firebase Auth 사용자를 조회합니다.
    getUserByProviderUid(
        providerId: string,
        uid: string
    ): Promise<FirebaseAuthUser>;
    // 지정한 속성으로 Firebase Auth 사용자를 생성합니다.
    createUser(properties: {
        // 신규 사용자의 uid를 저장합니다.
        uid?: string;
        // 신규 사용자의 이메일을 저장합니다.
        email?: string;
        // 신규 사용자 이메일의 검증 여부를 저장합니다.
        emailVerified?: boolean;
        // 신규 사용자에 연결할 provider 정보를 저장합니다.
        providerToLink?: UserProvider;
    }): Promise<FirebaseAuthUser>;
    // Firebase Auth 사용자의 provider와 profile 정보를 변경합니다.
    updateUser(
        uid: string,
        properties: {
            // 연결할 provider 정보를 저장합니다.
            providerToLink?: UserProvider;
            // 해제할 provider id 목록을 저장합니다.
            providersToUnlink?: string[];
            // Firebase Auth profile에 저장할 표시 이름을 저장합니다.
            displayName?: string;
            // Firebase Auth profile에 저장할 사진 URL을 저장합니다.
            photoURL?: string | null;
        }
    ): Promise<FirebaseAuthUser>;
    // 지정한 uid로 Firebase custom token을 생성합니다.
    createCustomToken(uid: string): Promise<string>;
}
