import { FirestorePath } from "../../common/firestorePath";
import type { FirebaseAuthClient } from "./FirebaseAuthClient";

// 전달된 이름 또는 기존 Firestore Apple 이름을 Firebase Auth profile에 반영합니다.
export async function updateAppleProfile(
    db: FirebaseFirestore.Firestore,
    auth: FirebaseAuthClient,
    uid: string,
    displayName?: string
): Promise<void> {
    const providedDisplayName = normalizedDisplayName(displayName);
    if (providedDisplayName) {
        await auth.updateUser(uid, { displayName: providedDisplayName });
        return;
    }

    const infoSnapshot = await db.doc(
        FirestorePath.userData(uid, FirestorePath.UserDataDocument.info)
    ).get();
    const storedDisplayName = normalizedDisplayName(infoSnapshot.data()?.appleName);
    if (storedDisplayName) {
        await auth.updateUser(uid, { displayName: storedDisplayName });
    }
}

// 공백이 아닌 문자열을 앞뒤 공백을 제거해 반환합니다.
function normalizedDisplayName(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const displayName = value.trim();
    return displayName || undefined;
}
