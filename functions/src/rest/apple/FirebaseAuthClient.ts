import type { UserProvider } from "firebase-admin/auth";
import type { FirebaseAuthUser } from "./FirebaseAuthUser";

// Apple 인증에서 사용하는 Firebase Auth 작업을 나타냅니다.
export interface FirebaseAuthClient {
    // uid로 Firebase Auth 사용자를 조회합니다.
    getUser(uid: string): Promise<FirebaseAuthUser>;
    // provider uid로 Firebase Auth 사용자를 조회합니다.
    getUserByProviderUid(
        providerId: string,
        uid: string
    ): Promise<FirebaseAuthUser>;
    // Firebase Auth 사용자의 provider 정보를 변경합니다.
    updateUser(
        uid: string,
        properties: {
            // 연결할 provider 정보를 저장합니다.
            providerToLink?: UserProvider;
            // 해제할 provider id 목록을 저장합니다.
            providersToUnlink?: string[];
        }
    ): Promise<FirebaseAuthUser>;
}
