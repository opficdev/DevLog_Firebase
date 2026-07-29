import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { FirestorePath } from "../../common/firestorePath";

// 새 Apple credential을 저장하고 기존 사용자 token 필드를 제거합니다.
export async function saveAppleCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    refreshToken: string
): Promise<void> {
    const credentialRootRef = db.doc(FirestorePath.authCredential(uid));
    const credentialRef = db.doc(FirestorePath.appleCredential(uid));
    const legacyRef = db.doc(
        FirestorePath.userData(uid, FirestorePath.UserDataDocument.tokens)
    );
    await db.runTransaction(async (transaction) => {
        const credentialRootSnapshot = await transaction.get(credentialRootRef);
        const legacySnapshot = await transaction.get(legacyRef);
        const legacyData = legacySnapshot.data();
        if (credentialRootSnapshot.data()?.deletionStartedAt) {
            throw new HttpsError(
                "failed-precondition",
                "삭제 중인 사용자의 Apple credential은 저장할 수 없습니다."
            );
        }
        transaction.set(credentialRef, {
            refreshToken,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        if (
            legacySnapshot.exists &&
            legacyData &&
            "appleRefreshToken" in legacyData
        ) {
            transaction.update(legacyRef, {
                appleRefreshToken: FieldValue.delete()
            });
        }
    });
}

// 새 경로를 우선해 credential을 읽고 기존 값은 새 값을 보존하며 이관합니다.
export async function appleCredentialForUser(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<string | undefined> {
    const credentialRootRef = db.doc(FirestorePath.authCredential(uid));
    const credentialRef = db.doc(FirestorePath.appleCredential(uid));
    const legacyRef = db.doc(
        FirestorePath.userData(uid, FirestorePath.UserDataDocument.tokens)
    );
    return db.runTransaction(async (transaction) => {
        const credentialRootSnapshot = await transaction.get(credentialRootRef);
        const credentialSnapshot = await transaction.get(credentialRef);
        const legacySnapshot = await transaction.get(legacyRef);
        const storedRefreshToken = credentialSnapshot.data()?.refreshToken;
        const legacyRefreshToken = legacySnapshot.data()?.appleRefreshToken;
        const refreshToken = typeof storedRefreshToken === "string" ?
            storedRefreshToken :
            typeof legacyRefreshToken === "string" ? legacyRefreshToken : undefined;

        if (
            !credentialRootSnapshot.data()?.deletionStartedAt &&
            !storedRefreshToken &&
            refreshToken
        ) {
            transaction.set(credentialRef, {
                refreshToken,
                migratedAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }
        if (legacySnapshot.exists && typeof legacyRefreshToken === "string") {
            transaction.update(legacyRef, {
                appleRefreshToken: FieldValue.delete()
            });
        }

        return refreshToken;
    });
}

// 서버 전용 Apple credential 문서와 남아 있는 기존 token 필드를 삭제합니다.
export async function deleteAppleCredential(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.appleCredential(uid));
    const legacyRef = db.doc(
        FirestorePath.userData(uid, FirestorePath.UserDataDocument.tokens)
    );
    await db.runTransaction(async (transaction) => {
        const legacySnapshot = await transaction.get(legacyRef);
        const legacyData = legacySnapshot.data();
        transaction.delete(credentialRef);
        if (
            legacySnapshot.exists &&
            legacyData &&
            "appleRefreshToken" in legacyData
        ) {
            transaction.update(legacyRef, {
                appleRefreshToken: FieldValue.delete()
            });
        }
    });
}
