import { randomBytes } from "crypto";
import {
    FieldValue,
    Timestamp
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { FirestorePath } from "../../common/firestorePath";
import { revokeGoogleOAuthToken } from "./googleClient";

const REVOCATION_LEASE_MILLISECONDS = 5 * 60 * 1000;

// 서버에서 보관하는 Google OAuth credential을 나타냅니다.
export interface GoogleCredential {
    // 최근 Google access token을 저장합니다.
    accessToken: string;
    // access token을 발급한 OAuth client id를 저장합니다.
    clientId: string;
    // 장기 grant 폐기에 사용할 refresh token을 저장합니다.
    refreshToken?: string;
}

// 저장된 Google credential을 반환합니다.
export async function googleCredentialForUser(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<GoogleCredential | undefined> {
    const snapshot = await db.doc(FirestorePath.googleCredential(uid)).get();
    return credentialFromData(snapshot.data());
}

// Google grant를 폐기한 뒤 같은 credential 문서를 조건부 삭제합니다.
export async function revokeGoogleCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    requestedCredential?: GoogleCredential
): Promise<void> {
    const credential = requestedCredential ?? await googleCredentialForUser(db, uid);
    if (!credential) {
        await deleteGoogleCredential(db, uid);
        return;
    }

    const claim = randomBytes(32).toString("base64url");
    await claimGoogleCredentialRevocation(
        db,
        uid,
        credential,
        claim
    );
    try {
        await revokeGoogleOAuthToken(
            uid,
            credential.refreshToken ?? credential.accessToken
        );
        await deleteClaimedGoogleCredential(
            db,
            uid,
            credential,
            claim
        );
    } catch (error) {
        await releaseGoogleCredentialRevocation(db, uid, claim);
        throw error;
    }
}

// 현재 Google credential에 grant 폐기 lease를 설정합니다.
async function claimGoogleCredentialRevocation(
    db: FirebaseFirestore.Firestore,
    uid: string,
    credential: GoogleCredential,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.googleCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        const stored = credentialFromData(snapshot.data());
        if (
            !credentialsEqual(stored, credential) ||
            revocationLeaseActive(snapshot.data()) ||
            accountLinkLeaseActive(snapshot.data())
        ) {
            throw new HttpsError(
                "aborted",
                "Google credential이 변경되어 폐기를 다시 시도해야 합니다."
            );
        }
        transaction.update(credentialRef, {
            revocationClaim: claim,
            revocationExpiresAt: Timestamp.fromMillis(
                Date.now() + REVOCATION_LEASE_MILLISECONDS
            )
        });
    });
}

// claim한 Google credential이 그대로일 때만 문서를 삭제합니다.
async function deleteClaimedGoogleCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    credential: GoogleCredential,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.googleCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        if (
            snapshot.data()?.revocationClaim !== claim ||
            !credentialsEqual(
                credentialFromData(snapshot.data()),
                credential
            )
        ) {
            throw new HttpsError(
                "aborted",
                "Google credential 폐기 결과를 적용할 수 없습니다."
            );
        }
        transaction.delete(credentialRef);
    });
}

// grant 폐기 실패 뒤 같은 credential을 다시 처리할 수 있도록 lease를 해제합니다.
async function releaseGoogleCredentialRevocation(
    db: FirebaseFirestore.Firestore,
    uid: string,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.googleCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        if (snapshot.data()?.revocationClaim === claim) {
            transaction.update(credentialRef, {
                revocationClaim: FieldValue.delete(),
                revocationExpiresAt: FieldValue.delete()
            });
        }
    });
}

// 비어 있는 Google credential 문서를 조건 없이 삭제합니다.
async function deleteGoogleCredential(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.googleCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        if (
            credentialFromData(snapshot.data()) ||
            typeof snapshot.data()?.revocationClaim === "string" ||
            accountLinkLeaseActive(snapshot.data())
        ) {
            throw new HttpsError(
                "aborted",
                "Google credential이 변경되어 정리를 다시 시도해야 합니다."
            );
        }
        transaction.delete(credentialRef);
    });
}

// credential 문서 데이터에서 유효한 Google credential을 반환합니다.
function credentialFromData(
    data: FirebaseFirestore.DocumentData | undefined
): GoogleCredential | undefined {
    const accessToken = data?.accessToken;
    const clientId = data?.clientId;
    const refreshToken = data?.refreshToken;
    if (typeof accessToken !== "string" || typeof clientId !== "string") {
        return undefined;
    }
    return {
        accessToken,
        clientId,
        refreshToken: typeof refreshToken === "string" ? refreshToken : undefined
    };
}

// 두 Google credential이 같은 발급 값인지 확인합니다.
function credentialsEqual(
    first: GoogleCredential | undefined,
    second: GoogleCredential
): boolean {
    return first?.accessToken === second.accessToken &&
        first.clientId === second.clientId &&
        first.refreshToken === second.refreshToken;
}

// credential 문서에 유효한 grant 폐기 lease가 남아 있는지 확인합니다.
function revocationLeaseActive(
    data: FirebaseFirestore.DocumentData | undefined
): boolean {
    const claim = data?.revocationClaim;
    const expiresAt = data?.revocationExpiresAt;
    return typeof claim === "string" &&
        expiresAt &&
        typeof expiresAt.toMillis === "function" &&
        Date.now() < expiresAt.toMillis();
}

// credential 문서에 유효한 계정 연결 lease가 남아 있는지 확인합니다.
function accountLinkLeaseActive(
    data: FirebaseFirestore.DocumentData | undefined
): boolean {
    const claim = data?.accountLinkClaim;
    const expiresAt = data?.accountLinkExpiresAt;
    return typeof claim === "string" &&
        expiresAt &&
        typeof expiresAt.toMillis === "function" &&
        Date.now() < expiresAt.toMillis();
}
