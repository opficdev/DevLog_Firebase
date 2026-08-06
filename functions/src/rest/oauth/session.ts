import {
    createHash,
    randomBytes,
    timingSafeEqual
} from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { FirestorePath } from "../../common/firestorePath";

const CLAIM_LIFETIME_MILLISECONDS = 60 * 1000;
const APP_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

// OAuth 요청이 수행할 인증 목적을 나타냅니다.
export type OAuthPurpose = "signIn" | "link";

// ticket 교환 처리를 위해 claim한 값을 나타냅니다.
export interface ClaimedOAuthTicket {
    // ticket 처리 소유권을 확인할 임의 값을 저장합니다.
    claim: string;
    // ticket 식별자를 저장합니다.
    ticket: string;
    // 원본 session 식별자를 저장합니다.
    sessionId: string;
    // 인증 공급자를 저장합니다.
    provider: string;
    // 로그인 또는 계정 연결 목적을 저장합니다.
    purpose: OAuthPurpose;
    // 계정 연결을 요청한 Firebase uid를 저장합니다.
    uid?: string;
    // provider 처리를 완료할 서버 전용 결과를 저장합니다.
    payload: Record<string, unknown>;
}

// app verifier와 ticket 결합 조건을 확인하고 ticket을 transaction으로 claim합니다.
export async function claimOAuthTicket(
    db: FirebaseFirestore.Firestore,
    ticket: string,
    appVerifier: string,
    expectedProvider: string,
    expectedPurpose: OAuthPurpose,
    expectedUID?: string
): Promise<ClaimedOAuthTicket> {
    if (!APP_VERIFIER_PATTERN.test(appVerifier)) {
        throw invalidAppVerifierError();
    }

    const ticketRef = db.doc(FirestorePath.oauthTicket(ticket));
    const claim = randomValue();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ticketRef);
        const data = snapshot.data();
        if (!snapshot.exists || !data) {
            throw oauthError(
                "invalid-argument",
                "invalid_oauth_ticket",
                "OAuth ticket을 찾을 수 없습니다."
            );
        }
        validateStoredTicket(data);
        if (!challengeMatches(appVerifier, data.appChallenge)) {
            throw invalidAppVerifierError();
        }
        if (
            data.provider !== expectedProvider ||
            data.purpose !== expectedPurpose ||
            (expectedUID !== undefined && data.uid !== expectedUID)
        ) {
            throw oauthError(
                "permission-denied",
                "mismatched_oauth_ticket",
                "OAuth ticket 결합 정보가 일치하지 않습니다."
            );
        }
        if (!claimAvailable(data)) {
            throw oauthError(
                "failed-precondition",
                "consumed_oauth_ticket",
                "OAuth ticket이 이미 사용되었습니다."
            );
        }

        transaction.update(ticketRef, {
            status: "processing",
            claim,
            processingAt: FieldValue.serverTimestamp()
        });
        return {
            claim,
            ticket,
            sessionId: data.sessionId,
            provider: data.provider,
            purpose: data.purpose,
            uid: typeof data.uid === "string" ? data.uid : undefined,
            payload: data.payload
        };
    });
}

// 처리에 성공한 ticket을 transaction으로 한 번만 소비합니다.
export async function consumeOAuthTicket(
    db: FirebaseFirestore.Firestore,
    ticket: ClaimedOAuthTicket
): Promise<void> {
    const ticketRef = db.doc(FirestorePath.oauthTicket(ticket.ticket));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ticketRef);
        const data = snapshot.data();
        if (
            !snapshot.exists ||
            !data ||
            data.status !== "processing" ||
            data.claim !== ticket.claim
        ) {
            throw oauthError(
                "failed-precondition",
                "consumed_oauth_ticket",
                "OAuth ticket 처리 권한이 유효하지 않습니다."
            );
        }
        transaction.update(ticketRef, {
            status: "consumed",
            consumedAt: FieldValue.serverTimestamp(),
            claim: FieldValue.delete(),
            payload: FieldValue.delete()
        });
    });
}

// ticket 처리 실패 뒤 같은 verifier가 다시 요청할 수 있도록 claim을 해제합니다.
export async function releaseOAuthTicket(
    db: FirebaseFirestore.Firestore,
    ticket: ClaimedOAuthTicket
): Promise<void> {
    const ticketRef = db.doc(FirestorePath.oauthTicket(ticket.ticket));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ticketRef);
        const data = snapshot.data();
        if (
            snapshot.exists &&
            data?.status === "processing" &&
            data.claim === ticket.claim
        ) {
            transaction.update(ticketRef, {
                status: "ready",
                claim: FieldValue.delete(),
                processingAt: FieldValue.delete()
            });
        }
    });
}

// verifier의 SHA-256 digest를 base64url 문자열로 변환합니다.
export function challengeFor(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

// 저장된 ticket 형식과 만료 시각을 검증합니다.
function validateStoredTicket(data: FirebaseFirestore.DocumentData): void {
    if (
        typeof data.provider !== "string" ||
        (data.purpose !== "signIn" && data.purpose !== "link") ||
        typeof data.sessionId !== "string" ||
        typeof data.appChallenge !== "string" ||
        !data.payload ||
        typeof data.payload !== "object"
    ) {
        throw oauthError(
            "invalid-argument",
            "invalid_oauth_ticket",
            "OAuth ticket 형식이 올바르지 않습니다."
        );
    }
    if (expired(data.expiresAt)) {
        throw oauthError(
            "failed-precondition",
            "expired_oauth_ticket",
            "OAuth ticket이 만료되었습니다."
        );
    }
}

// 원본 verifier에서 계산한 challenge를 timing-safe 방식으로 비교합니다.
function challengeMatches(appVerifier: string, appChallenge: string): boolean {
    const actual = Buffer.from(challengeFor(appVerifier));
    const expected = Buffer.from(appChallenge);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Firestore Timestamp 계열 만료 시각이 지났는지 반환합니다.
function expired(value: unknown): boolean {
    const milliseconds = timestampMilliseconds(value);
    return milliseconds === undefined || milliseconds <= Date.now();
}

// ready 상태이거나 중단된 processing lease가 만료된 문서인지 반환합니다.
function claimAvailable(data: FirebaseFirestore.DocumentData): boolean {
    if (data.status === "ready") {
        return true;
    }
    if (data.status !== "processing") {
        return false;
    }
    const processingAt = timestampMilliseconds(data.processingAt);
    return processingAt === undefined ||
        processingAt + CLAIM_LIFETIME_MILLISECONDS <= Date.now();
}

// Firestore Timestamp 계열 값을 epoch millisecond로 변환합니다.
function timestampMilliseconds(value: unknown): number | undefined {
    if (
        value &&
        typeof value === "object" &&
        "toMillis" in value &&
        typeof (value as { toMillis?: unknown }).toMillis === "function"
    ) {
        return (value as { toMillis: () => number }).toMillis();
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    return undefined;
}

// URL과 Firestore 문서 식별자에 사용할 충분한 길이의 임의 값을 생성합니다.
function randomValue(): string {
    return randomBytes(32).toString("base64url");
}

// app verifier 검증 실패를 공개 가능한 오류로 구성합니다.
function invalidAppVerifierError(): HttpsError {
    return oauthError(
        "unauthenticated",
        "invalid_app_verifier",
        "app verifier가 유효하지 않습니다."
    );
}

// OAuth ticket 오류에 reason을 결합합니다.
function oauthError(
    code: "invalid-argument" | "unauthenticated" | "permission-denied" | "failed-precondition",
    reason: string,
    message: string
): HttpsError {
    return new HttpsError(code, message, { reason });
}
