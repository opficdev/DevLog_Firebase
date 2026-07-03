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

        for (const firebaseDB of firebaseDBs()) {
            try {
                const db = firestoreFor(firebaseDB);
                const userDocRef = db.doc(FirestorePath.user(uid));
                await db.recursiveDelete(userDocRef);
                logger.info("Auth 사용자 삭제 후 Firestore 사용자 데이터 삭제 완료", {
                    firebaseDB,
                    uid
                });
            } catch (error) {
                logger.error("Auth 사용자 삭제 후 Firestore 사용자 데이터 삭제 실패", {
                    firebaseDB,
                    uid,
                    error
                });
                throw error;
            }
        }
    }
);
