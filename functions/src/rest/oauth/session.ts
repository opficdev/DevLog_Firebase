import {
    createHash,
    randomBytes,
    timingSafeEqual
} from "crypto";
import {
    FieldValue,
    Timestamp
} from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { FirestorePath } from "../../common/firestorePath";

const SESSION_LIFETIME_MILLISECONDS = 10 * 60 * 1000;
const TICKET_LIFETIME_MILLISECONDS = 5 * 60 * 1000;
const CLAIM_LIFETIME_MILLISECONDS = 60 * 1000;
const APP_CHALLENGE_LENGTH = 43;
const APP_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;

// OAuth 요청이 수행할 인증 목적을 나타냅니다.
export type OAuthPurpose = "signIn" | "link";

// OAuth session 생성에 필요한 서버 저장 값을 나타냅니다.
export interface OAuthSessionInput {
    // 인증 공급자를 저장합니다.
    provider: string;
    // 로그인 또는 계정 연결 목적을 저장합니다.
    purpose: OAuthPurpose;
    // 앱이 원본 verifier에서 계산한 challenge를 저장합니다.
    appChallenge: string;
    // 공급자 PKCE 교환에 사용할 서버 전용 verifier를 저장합니다.
    providerPKCEVerifier: string;
    // 계정 연결을 요청한 Firebase uid를 저장합니다.
    uid?: string;
}

// OAuth session 생성 결과와 공급자 authorization 요청 값을 나타냅니다.
export interface OAuthSessionCreation {
    // callback 검증에 사용할 임의 state를 저장합니다.
    state: string;
    // 공급자 PKCE 요청에 사용할 challenge를 저장합니다.
    providerPKCEChallenge: string;
    // session 만료 시각을 저장합니다.
    expiresAt: Date;
}

// callback 처리를 위해 claim한 OAuth session 값을 나타냅니다.
export interface ClaimedOAuthSession {
    // callback 처리 소유권을 확인할 임의 값을 저장합니다.
    claim: string;
    // session을 식별하는 state를 저장합니다.
    state: string;
    // 인증 공급자를 저장합니다.
    provider: string;
    // 로그인 또는 계정 연결 목적을 저장합니다.
    purpose: OAuthPurpose;
    // 앱 verifier 검증에 사용할 challenge를 저장합니다.
    appChallenge: string;
    // 공급자 code 교환에 사용할 서버 전용 verifier를 저장합니다.
    providerPKCEVerifier: string;
    // 계정 연결을 요청한 Firebase uid를 저장합니다.
    uid?: string;
}

// callback 완료 뒤 ticket에 보관할 provider 결과를 나타냅니다.
export interface OAuthTicketInput {
    // callback이 처리한 session을 저장합니다.
    session: ClaimedOAuthSession;
    // ticket 교환까지 서버에만 보관할 provider 결과를 저장합니다.
    payload: Record<string, unknown>;
}

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

// provider 공통 OAuth session을 생성하고 공개 가능한 PKCE 값을 반환합니다.
export async function createOAuthSession(
    db: FirebaseFirestore.Firestore,
    input: OAuthSessionInput
): Promise<OAuthSessionCreation> {
    validateAppChallenge(input.appChallenge);
    if (input.purpose === "link" && !input.uid) {
        throw oauthError(
            "invalid-argument",
            "invalid_oauth_session",
            "계정 연결 OAuth session에는 Firebase uid가 필요합니다."
        );
    }

    const state = randomValue();
    const expiresAt = Timestamp.fromMillis(Date.now() + SESSION_LIFETIME_MILLISECONDS);
    await db.doc(FirestorePath.oauthSession(state)).create({
        state,
        provider: input.provider,
        purpose: input.purpose,
        appChallenge: input.appChallenge,
        providerPKCEVerifier: input.providerPKCEVerifier,
        uid: input.uid ?? null,
        status: "ready",
        expiresAt,
        createdAt: FieldValue.serverTimestamp()
    });

    return {
        state,
        providerPKCEChallenge: challengeFor(input.providerPKCEVerifier),
        expiresAt: expiresAt.toDate()
    };
}

// callback state에 대응하는 session을 transaction으로 한 번만 claim합니다.
export async function claimOAuthSession(
    db: FirebaseFirestore.Firestore,
    state: string,
    expectedProvider: string
): Promise<ClaimedOAuthSession> {
    const sessionRef = db.doc(FirestorePath.oauthSession(state));
    const claim = randomValue();
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        const data = snapshot.data();
        if (!snapshot.exists || !data || data.provider !== expectedProvider) {
            throw oauthError(
                "invalid-argument",
                "invalid_oauth_session",
                "OAuth session을 찾을 수 없습니다."
            );
        }
        validateStoredSession(data);
        if (!claimAvailable(data)) {
            throw oauthError(
                "failed-precondition",
                "consumed_oauth_session",
                "OAuth session이 이미 처리되었습니다."
            );
        }

        transaction.update(sessionRef, {
            status: "processing",
            claim,
            processingAt: FieldValue.serverTimestamp()
        });
        return {
            claim,
            state,
            provider: data.provider,
            purpose: data.purpose,
            appChallenge: data.appChallenge,
            providerPKCEVerifier: data.providerPKCEVerifier,
            uid: typeof data.uid === "string" ? data.uid : undefined
        };
    });
}

// callback 결과를 ticket으로 저장하고 claim한 session을 완료 상태로 전환합니다.
export async function completeOAuthSession(
    db: FirebaseFirestore.Firestore,
    input: OAuthTicketInput
): Promise<string> {
    const ticket = randomValue();
    const sessionRef = db.doc(FirestorePath.oauthSession(input.session.state));
    const ticketRef = db.doc(FirestorePath.oauthTicket(ticket));
    const expiresAt = Timestamp.fromMillis(Date.now() + TICKET_LIFETIME_MILLISECONDS);
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        const data = snapshot.data();
        if (
            !snapshot.exists ||
            !data ||
            data.status !== "processing" ||
            data.claim !== input.session.claim
        ) {
            throw oauthError(
                "failed-precondition",
                "consumed_oauth_session",
                "OAuth session 처리 권한이 유효하지 않습니다."
            );
        }

        transaction.create(ticketRef, {
            provider: input.session.provider,
            purpose: input.session.purpose,
            sessionId: input.session.state,
            appChallenge: input.session.appChallenge,
            uid: input.session.uid ?? null,
            payload: input.payload,
            status: "ready",
            expiresAt,
            createdAt: FieldValue.serverTimestamp()
        });
        transaction.update(sessionRef, {
            status: "completed",
            ticketId: ticket,
            completedAt: FieldValue.serverTimestamp(),
            claim: FieldValue.delete(),
            providerPKCEVerifier: FieldValue.delete()
        });
    });
    return ticket;
}

// callback 실패 뒤 같은 session을 다시 처리할 수 있도록 claim을 해제합니다.
export async function releaseOAuthSession(
    db: FirebaseFirestore.Firestore,
    session: ClaimedOAuthSession
): Promise<void> {
    const sessionRef = db.doc(FirestorePath.oauthSession(session.state));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        const data = snapshot.data();
        if (
            snapshot.exists &&
            data?.status === "processing" &&
            data.claim === session.claim
        ) {
            transaction.update(sessionRef, {
                status: "ready",
                claim: FieldValue.delete(),
                processingAt: FieldValue.delete()
            });
        }
    });
}

// callback 보상 폐기에 실패한 provider credential을 session 만료 정리용으로 저장합니다.
export async function storeOAuthSessionCleanupPayload(
    db: FirebaseFirestore.Firestore,
    session: ClaimedOAuthSession,
    payload: Record<string, unknown>
): Promise<void> {
    const sessionRef = db.doc(FirestorePath.oauthSession(session.state));
    await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(sessionRef);
        if (!snapshot.exists) {
            throw oauthError(
                "invalid-argument",
                "invalid_oauth_session",
                "정리할 OAuth session을 찾을 수 없습니다."
            );
        }
        transaction.update(sessionRef, {
            cleanupPayload: payload,
            updatedAt: FieldValue.serverTimestamp()
        });
    });
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

// OAuth PKCE와 app proof에 사용할 임의 verifier를 생성합니다.
export function createOAuthVerifier(): string {
    return randomBytes(48).toString("base64url");
}

// verifier의 SHA-256 digest를 base64url 문자열로 변환합니다.
export function challengeFor(verifier: string): string {
    return createHash("sha256").update(verifier).digest("base64url");
}

// 저장된 session 형식과 만료 시각을 검증합니다.
function validateStoredSession(data: FirebaseFirestore.DocumentData): void {
    if (
        typeof data.provider !== "string" ||
        (data.purpose !== "signIn" && data.purpose !== "link") ||
        typeof data.appChallenge !== "string" ||
        typeof data.providerPKCEVerifier !== "string"
    ) {
        throw oauthError(
            "invalid-argument",
            "invalid_oauth_session",
            "OAuth session 형식이 올바르지 않습니다."
        );
    }
    if (expired(data.expiresAt)) {
        throw oauthError(
            "failed-precondition",
            "expired_oauth_session",
            "OAuth session이 만료되었습니다."
        );
    }
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

// app challenge 입력 형식을 검증합니다.
function validateAppChallenge(appChallenge: string): void {
    if (
        appChallenge.length !== APP_CHALLENGE_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(appChallenge)
    ) {
        throw oauthError(
            "invalid-argument",
            "invalid_app_challenge",
            "app challenge가 유효하지 않습니다."
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

// OAuth session과 ticket 오류에 reason을 결합합니다.
function oauthError(
    code: "invalid-argument" | "unauthenticated" | "permission-denied" | "failed-precondition",
    reason: string,
    message: string
): HttpsError {
    return new HttpsError(code, message, { reason });
}
