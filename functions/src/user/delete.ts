import * as functions from "firebase-functions/v1";
import * as logger from "firebase-functions/logger";
import { firebaseDBs, firestoreFor } from "../common/firestore";
import { FirestorePath } from "../common/firestorePath";

export const cleanupDeletedUserFirestoreData = functions
    .runWith({
        maxInstances: 1
    })
    .region("asia-northeast3")
    .auth
    .user()
    .onDelete(async (user) => {
        const uid = user.uid;
        const errors: unknown[] = [];

        for (const firebaseDB of firebaseDBs()) {
            const db = firestoreFor(firebaseDB);
            const paths = [
                FirestorePath.user(uid),
                FirestorePath.authCredential(uid)
            ];
            for (const path of paths) {
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
        }

        if (errors.length !== 0) {
            throw new Error("일부 Firestore 데이터베이스에서 사용자 데이터 삭제에 실패했습니다.");
        }
    }
);
