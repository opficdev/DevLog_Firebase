import { FirestorePath } from "../../common/firestorePath";
import { appleAuthError } from "./error";
import type { FirebaseAuthClient } from "./FirebaseAuthClient";

// 요청, Firestore, Firebase Auth 순서로 Apple 이름을 선택해 profile에 반영합니다.
export async function updateAppleProfile(
    db: FirebaseFirestore.Firestore,
    auth: FirebaseAuthClient,
    uid: string,
    displayName?: string
): Promise<void> {
    let selectedDisplayName = normalizedDisplayName(displayName);
    if (!selectedDisplayName) {
        const infoSnapshot = await db.doc(
            FirestorePath.userData(uid, FirestorePath.UserDataDocument.info)
        ).get();
        selectedDisplayName = normalizedDisplayName(infoSnapshot.data()?.appleName);
    }

    if (!selectedDisplayName) {
        const user = await auth.getUser(uid);
        selectedDisplayName = normalizedDisplayName(user.displayName);
        if (
            selectedDisplayName &&
            user.displayName === selectedDisplayName &&
            !user.photoURL
        ) {
            return;
        }
    }

    if (!selectedDisplayName) {
        throw appleAuthError(
            "failed-precondition",
            "apple_profile_incomplete",
            "Apple 프로필 이름을 찾을 수 없습니다."
        );
    }

    await auth.updateUser(uid, {
        displayName: selectedDisplayName,
        photoURL: null
    });
}

// 공백이 아닌 문자열을 앞뒤 공백을 제거해 반환합니다.
function normalizedDisplayName(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const displayName = value.trim();
    return displayName || undefined;
}
