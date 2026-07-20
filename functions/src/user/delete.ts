import * as functions from "firebase-functions/v1";
import * as logger from "firebase-functions/logger";
import {
    FieldValue,
    Timestamp
} from "firebase-admin/firestore";
import { firebaseDBs, firestoreFor } from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";
import {
    githubOAuthConfigurationSecret,
    githubRevocationConfiguration
} from "../rest/githubConfiguration";
import {
    githubCredentialForUser,
    revokePendingGithubCredentials,
    revokeGithubCredential
} from "../rest/githubCredential";
import {
    googleCredentialForUser,
    revokeGoogleCredential
} from "../rest/googleCredential";

const DELETION_MARKER_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;

export const cleanupDeletedUserFirestoreData = functions
    .runWith({
        maxInstances: 1,
        failurePolicy: true,
        secrets: [githubOAuthConfigurationSecret]
    })
    .region("asia-northeast3")
    .auth
    .user()
    .onDelete(async (user) => {
        const uid = user.uid;
        const errors: unknown[] = [];

        for (const firebaseDB of firebaseDBs()) {
            const db = firestoreFor(firebaseDB);
            try {
                await markAuthCredentialDeletion(db, uid);
            } catch (error) {
                logger.error("Auth 사용자 삭제 표식 기록 실패", {
                    firebaseDB,
                    uid,
                    error
                });
                errors.push(error);
                continue;
            }

            const providerErrors = await revokeProviderCredentials(
                db,
                firebaseDB,
                uid
            );
            errors.push(...providerErrors);
            if (providerErrors.length !== 0) {
                continue;
            }

            await deleteCredentialProviders(
                db,
                firebaseDB,
                uid,
                errors
            );
            await deleteRoot(
                db,
                firebaseDB,
                uid,
                FirestorePath.user(uid),
                errors
            );
        }

        if (errors.length !== 0) {
            throw new Error("일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다.");
        }
    }
);

// 지정한 database의 provider credential을 각각 폐기하고 발생한 오류를 반환합니다.
async function revokeProviderCredentials(
    db: FirebaseFirestore.Firestore,
    firebaseDB: string,
    uid: string
): Promise<unknown[]> {
    const errors: unknown[] = [];
    try {
        const credential = await githubCredentialForUser(
            db,
            uid
        );
        if (credential) {
            await revokePendingGithubCredentials(
                db,
                uid
            );
            await revokeGithubCredential(
                db,
                uid,
                githubRevocationConfiguration(credential.clientId),
                credential
            );
        }
    } catch (error) {
        logger.error("Auth 사용자 삭제 후 GitHub credential 정리 실패", {
            firebaseDB,
            uid,
            error
        });
        errors.push(error);
    }

    try {
        const credential = await googleCredentialForUser(
            db,
            uid
        );
        if (credential) {
            await revokeGoogleCredential(
                db,
                uid,
                credential
            );
        }
    } catch (error) {
        logger.error("Auth 사용자 삭제 후 Google credential 정리 실패", {
            firebaseDB,
            uid,
            error
        });
        errors.push(error);
    }
    return errors;
}

// 늦게 도착한 인증 요청이 삭제 중인 uid에 credential을 저장하지 못하도록 표식을 기록합니다.
async function markAuthCredentialDeletion(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    await db.doc(FirestorePath.authCredential(uid)).set({
        deletionStartedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(
            Date.now() + DELETION_MARKER_LIFETIME_MILLISECONDS
        )
    }, { merge: true });
}

// 삭제 표식은 유지하고 사용자의 모든 provider credential 문서를 제거합니다.
async function deleteCredentialProviders(
    db: FirebaseFirestore.Firestore,
    firebaseDB: string,
    uid: string,
    errors: unknown[]
): Promise<void> {
    const path = FirestorePath.authCredentialProviders(uid);
    try {
        await db.recursiveDelete(db.collection(path));
        logger.info("Auth 사용자 삭제 후 provider credential 삭제 완료", {
            firebaseDB,
            uid,
            path
        });
    } catch (error) {
        logger.error("Auth 사용자 삭제 후 provider credential 삭제 실패", {
            firebaseDB,
            uid,
            path,
            error
        });
        errors.push(error);
    }
}

// 지정한 사용자 Firestore 루트를 삭제하고 실패를 다음 재호출에 전달합니다.
async function deleteRoot(
    db: FirebaseFirestore.Firestore,
    firebaseDB: string,
    uid: string,
    path: string,
    errors: unknown[]
): Promise<void> {
    try {
        await db.recursiveDelete(db.doc(path));
        logger.info("Auth 사용자 삭제 후 Firestore 데이터 삭제 완료", {
            firebaseDB,
            uid,
            path
        });
    } catch (error) {
        logger.error("Auth 사용자 삭제 후 Firestore 데이터 삭제 실패", {
            firebaseDB,
            uid,
            path,
            error
        });
        errors.push(error);
    }
}
