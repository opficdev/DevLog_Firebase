import { randomBytes } from "crypto";
import {
    FieldValue,
    Timestamp
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { FirestorePath } from "../../common/firestorePath";
import {
    revokeGitHubOAuthGrant,
    revokeGitHubOAuthToken
} from "./githubClient";
import {
    githubRevocationConfiguration
} from "./githubConfiguration";
import type { GitHubConfiguration } from "./githubConfiguration";

// 서버에서 보관하는 GitHub OAuth credential을 나타냅니다.
export interface GitHubCredential {
    // GitHub 사용자 access token을 저장합니다.
    accessToken: string;
    // access token을 발급한 OAuth App client id를 저장합니다.
    clientId: string;
}

const REVOCATION_LEASE_MILLISECONDS = 5 * 60 * 1000;

// GitHub access token을 서버 전용 경로에 저장하고 기존 사용자 필드를 제거합니다.
export async function saveGithubCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    credential: GitHubCredential
): Promise<void> {
    const credentialRootRef = db.doc(FirestorePath.authCredential(uid));
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    const legacyRef = legacyTokenRef(db, uid);
    await db.runTransaction(async (transaction) => {
        const credentialRootSnapshot = await transaction.get(credentialRootRef);
        const credentialSnapshot = await transaction.get(credentialRef);
        const legacySnapshot = await transaction.get(legacyRef);
        if (credentialRootSnapshot.data()?.deletionStartedAt) {
            throw new HttpsError(
                "failed-precondition",
                "삭제 중인 사용자의 GitHub credential은 저장할 수 없습니다."
            );
        }
        const storedCredential = credentialFromData(credentialSnapshot.data());
        if (revocationLeaseActive(credentialSnapshot.data())) {
            throw new HttpsError(
                "aborted",
                "GitHub credential 폐기 처리가 진행 중입니다."
            );
        }
        const pendingRevocations = pendingCredentialsFrom(credentialSnapshot.data())
            .filter((pending) =>
                pending.accessToken !== credential.accessToken &&
                pending.clientId === credential.clientId
            );
        if (
            storedCredential &&
            storedCredential.accessToken !== credential.accessToken &&
            storedCredential.clientId === credential.clientId
        ) {
            pendingRevocations.push(storedCredential);
        }
        const uniquePendingRevocations = Array.from(
            new Map(pendingRevocations.map((pending) => [
                JSON.stringify([
                    pending.clientId,
                    pending.accessToken
                ]),
                pending
            ])).values()
        );
        transaction.set(credentialRef, {
            accessToken: credential.accessToken,
            clientId: credential.clientId,
            pendingRevocations: uniquePendingRevocations,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
        if (
            legacySnapshot.exists &&
            typeof legacySnapshot.data()?.githubAccessToken === "string"
        ) {
            transaction.update(legacyRef, {
                githubAccessToken: FieldValue.delete()
            });
        }
    });
}

// 새 경로를 우선해 GitHub credential을 읽고 기존 값은 새 값을 보존하며 이관합니다.
export async function githubCredentialForUser(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<GitHubCredential | undefined> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    const legacyRef = legacyTokenRef(db, uid);
    return db.runTransaction(async (transaction) => {
        const credentialSnapshot = await transaction.get(credentialRef);
        const legacySnapshot = await transaction.get(legacyRef);
        const storedAccessToken = credentialSnapshot.data()?.accessToken;
        const storedClientId = credentialSnapshot.data()?.clientId;
        if (
            typeof storedAccessToken === "string" &&
            typeof storedClientId !== "string"
        ) {
            throw new HttpsError(
                "internal",
                "GitHub credential을 발급한 OAuth App 설정이 필요합니다."
            );
        }
        if (
            legacySnapshot.exists &&
            typeof legacySnapshot.data()?.githubAccessToken === "string"
        ) {
            transaction.update(legacyRef, {
                githubAccessToken: FieldValue.delete()
            });
        }
        return typeof storedAccessToken === "string" && typeof storedClientId === "string" ?
            { accessToken: storedAccessToken, clientId: storedClientId } :
            undefined;
    });
}

// credential 문서에 추적된 이전 App grant를 폐기하고 성공한 항목만 제거합니다.
export async function revokePendingGithubCredentials(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    const snapshot = await credentialRef.get();
    const pendingRevocations = pendingCredentialsFrom(snapshot.data());
    const currentCredential = credentialFromData(snapshot.data());
    for (const credential of pendingRevocations) {
        const configuration = githubRevocationConfiguration(credential.clientId);
        if (credential.clientId === currentCredential?.clientId) {
            await revokeGitHubOAuthToken(
                uid,
                credential.accessToken,
                configuration.clientId,
                configuration.clientSecret
            );
        } else {
            await revokeGitHubOAuthGrant(
                uid,
                credential.accessToken,
                configuration.clientId,
                configuration.clientSecret
            );
        }
        await removePendingGithubCredential(
            db,
            uid,
            credential
        );
    }
}

// GitHub grant를 폐기하고 새 credential과 남아 있는 기존 token 필드를 삭제합니다.
export async function revokeGithubCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    configuration: GitHubConfiguration,
    requestedCredential?: GitHubCredential
): Promise<void> {
    const credential = requestedCredential ?? await githubCredentialForUser(db, uid);
    if (!credential) {
        await deleteGithubCredential(db, uid);
        return;
    }

    const claim = randomBytes(32).toString("base64url");
    await claimGithubCredentialRevocation(
        db,
        uid,
        credential,
        claim
    );
    try {
        await revokeGitHubOAuthGrant(
            uid,
            credential.accessToken,
            configuration.clientId,
            configuration.clientSecret
        );
        await deleteClaimedGithubCredential(
            db,
            uid,
            credential,
            claim
        );
    } catch (error) {
        await releaseGithubCredentialRevocation(
            db,
            uid,
            claim
        );
        throw error;
    }
}

// 현재 credential snapshot에 grant 폐기 lease를 설정합니다.
async function claimGithubCredentialRevocation(
    db: FirebaseFirestore.Firestore,
    uid: string,
    credential: GitHubCredential,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        const stored = credentialFromData(snapshot.data());
        if (
            !stored ||
            stored.accessToken !== credential.accessToken ||
            stored.clientId !== credential.clientId ||
            revocationLeaseActive(snapshot.data())
        ) {
            throw new HttpsError(
                "aborted",
                "GitHub credential이 변경되어 폐기를 다시 시도해야 합니다."
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

// claim한 credential이 그대로일 때만 서버 credential 문서를 삭제합니다.
async function deleteClaimedGithubCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    credential: GitHubCredential,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    const legacyRef = legacyTokenRef(db, uid);
    await db.runTransaction(async (transaction) => {
        const credentialSnapshot = await transaction.get(credentialRef);
        const legacySnapshot = await transaction.get(legacyRef);
        const stored = credentialFromData(credentialSnapshot.data());
        if (
            credentialSnapshot.data()?.revocationClaim !== claim ||
            stored?.accessToken !== credential.accessToken ||
            stored.clientId !== credential.clientId
        ) {
            throw new HttpsError(
                "aborted",
                "GitHub credential 폐기 결과를 적용할 수 없습니다."
            );
        }
        transaction.delete(credentialRef);
        if (
            legacySnapshot.exists &&
            typeof legacySnapshot.data()?.githubAccessToken === "string"
        ) {
            transaction.update(legacyRef, {
                githubAccessToken: FieldValue.delete()
            });
        }
    });
}

// grant 폐기 실패 뒤 같은 credential을 다시 처리할 수 있도록 lease를 해제합니다.
async function releaseGithubCredentialRevocation(
    db: FirebaseFirestore.Firestore,
    uid: string,
    claim: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
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

// 서버 전용 GitHub credential과 남아 있는 기존 token 필드를 삭제합니다.
export async function deleteGithubCredential(
    db: FirebaseFirestore.Firestore,
    uid: string
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    const legacyRef = legacyTokenRef(db, uid);
    await db.runTransaction(async (transaction) => {
        const credentialSnapshot = await transaction.get(credentialRef);
        const legacySnapshot = await transaction.get(legacyRef);
        if (
            credentialFromData(credentialSnapshot.data()) ||
            pendingCredentialsFrom(credentialSnapshot.data()).length !== 0 ||
            typeof credentialSnapshot.data()?.revocationClaim === "string" ||
            typeof legacySnapshot.data()?.githubAccessToken === "string"
        ) {
            throw new HttpsError(
                "aborted",
                "GitHub credential이 변경되어 정리를 다시 시도해야 합니다."
            );
        }
        transaction.delete(credentialRef);
    });
}

// 기존 클라이언트 저장 token 문서 참조를 반환합니다.
function legacyTokenRef(
    db: FirebaseFirestore.Firestore,
    uid: string
): FirebaseFirestore.DocumentReference {
    return db.doc(FirestorePath.userData(uid, FirestorePath.UserDataDocument.tokens));
}

// credential 문서 데이터에서 현재 GitHub credential을 반환합니다.
function credentialFromData(data: FirebaseFirestore.DocumentData | undefined): GitHubCredential | undefined {
    const accessToken = data?.accessToken;
    const clientId = data?.clientId;
    return typeof accessToken === "string" && typeof clientId === "string" ?
        { accessToken, clientId } :
        undefined;
}

// credential 문서에 유효한 grant 폐기 lease가 남아 있는지 반환합니다.
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

// credential 문서 데이터에서 폐기 대기 중인 이전 App credential을 반환합니다.
function pendingCredentialsFrom(
    data: FirebaseFirestore.DocumentData | undefined
): GitHubCredential[] {
    const pendingRevocations = data?.pendingRevocations;
    if (!Array.isArray(pendingRevocations)) {
        return [];
    }
    return pendingRevocations.flatMap((value: unknown) => {
        if (!value || typeof value !== "object") {
            return [];
        }
        const credential = value as Record<string, unknown>;
        return typeof credential.accessToken === "string" &&
            typeof credential.clientId === "string" ? [{
                accessToken: credential.accessToken,
                clientId: credential.clientId
            }] : [];
    });
}

// grant 폐기에 성공한 credential만 transaction으로 폐기 대기 목록에서 제거합니다.
async function removePendingGithubCredential(
    db: FirebaseFirestore.Firestore,
    uid: string,
    removed: GitHubCredential
): Promise<void> {
    const credentialRef = db.doc(FirestorePath.githubCredential(uid));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(credentialRef);
        const remaining = pendingCredentialsFrom(snapshot.data()).filter((credential) =>
            credential.accessToken !== removed.accessToken
        );
        transaction.set(credentialRef, {
            pendingRevocations: remaining,
            updatedAt: FieldValue.serverTimestamp()
        }, { merge: true });
    });
}
