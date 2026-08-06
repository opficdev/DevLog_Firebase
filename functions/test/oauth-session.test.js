const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const {
    challengeFor,
    claimOAuthTicket,
    consumeOAuthTicket
} = require("../lib/rest/oauth/session");

(async () => {
    await assertTicketVerifierAndConsumptionLifecycle();
    await assertLinkTicketKeepsUIDBinding();
    await assertExpiredTicketIsRejectedWithoutConsumption();
    await assertExpiredTicketClaimCanBeRecovered();
    assertOAuthExpirationFieldsUseTTL();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// verifier 실패가 ticket을 소비하지 않고 성공 요청만 한 번 소비하는지 검증합니다.
async function assertTicketVerifierAndConsumptionLifecycle() {
    const appVerifier = "a".repeat(64);
    const ticket = "ticket-1";
    const db = fakeFirestore({
        [`oauthTickets/${ticket}`]: ticketData(appVerifier)
    });

    await assert.rejects(
        () => claimOAuthTicket(
            db,
            ticket,
            "c".repeat(64),
            "github",
            "signIn"
        ),
        (error) => error.details?.reason === "invalid_app_verifier"
    );
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "ready");

    const claimed = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        "github",
        "signIn"
    );
    assert.strictEqual(claimed.payload.accessToken, "github-token");
    await consumeOAuthTicket(db, claimed);
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "consumed");

    await assert.rejects(
        () => claimOAuthTicket(
            db,
            ticket,
            appVerifier,
            "github",
            "signIn"
        ),
        (error) => error.details?.reason === "consumed_oauth_ticket"
    );
}

// 계정 연결 ticket이 session을 요청한 Firebase uid와 계속 결합되는지 검증합니다.
async function assertLinkTicketKeepsUIDBinding() {
    const appVerifier = "d".repeat(64);
    const ticket = "link-ticket";
    const db = fakeFirestore({
        [`oauthTickets/${ticket}`]: {
            ...ticketData(appVerifier),
            purpose: "link",
            uid: "current-uid"
        }
    });

    await assert.rejects(
        () => claimOAuthTicket(
            db,
            ticket,
            appVerifier,
            "github",
            "link",
            "other-uid"
        ),
        (error) => error.details?.reason === "mismatched_oauth_ticket"
    );
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "ready");

    const claimed = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        "github",
        "link",
        "current-uid"
    );
    assert.strictEqual(claimed.uid, "current-uid");
}

// 만료 ticket이 거부되고 소비 상태로 바뀌지 않는지 검증합니다.
async function assertExpiredTicketIsRejectedWithoutConsumption() {
    const appVerifier = "f".repeat(64);
    const ticket = "expired-ticket";
    const db = fakeFirestore({
        [`oauthTickets/${ticket}`]: {
            ...ticketData(appVerifier),
            expiresAt: Timestamp.fromMillis(Date.now() - 1)
        }
    });

    await assert.rejects(
        () => claimOAuthTicket(
            db,
            ticket,
            appVerifier,
            "github",
            "signIn"
        ),
        (error) => error.details?.reason === "expired_oauth_ticket"
    );
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).status, "ready");
}

// 중단된 ticket의 processing lease가 만료되면 교환 요청이 다시 claim하는지 검증합니다.
async function assertExpiredTicketClaimCanBeRecovered() {
    const appVerifier = "k".repeat(64);
    const ticket = "recoverable-ticket";
    const db = fakeFirestore({
        [`oauthTickets/${ticket}`]: {
            ...ticketData(appVerifier),
            status: "processing",
            claim: "abandoned-claim",
            processingAt: Timestamp.fromMillis(Date.now() - 61 * 1000)
        }
    });

    const claimed = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        "github",
        "signIn"
    );

    assert.notStrictEqual(claimed.claim, "abandoned-claim");
    assert.strictEqual(db.data.get(`oauthTickets/${ticket}`).claim, claimed.claim);
}

// OAuth session과 ticket 만료 필드가 Firestore TTL 대상으로 설정되는지 검증합니다.
function assertOAuthExpirationFieldsUseTTL() {
    const indexPath = path.resolve(__dirname, "../../firestore.index.json");
    const configuration = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const ttlCollections = configuration.fieldOverrides
        .filter((override) => override.fieldPath === "expiresAt" && override.ttl === true)
        .map((override) => override.collectionGroup);

    assert.ok(ttlCollections.includes("oauthSessions"));
    assert.ok(ttlCollections.includes("oauthTickets"));
    assert.ok(ttlCollections.includes("authCredentials"));
}

// NestJS callback이 저장하는 OAuth ticket 문서 대역을 구성합니다.
function ticketData(appVerifier) {
    return {
        provider: "github",
        purpose: "signIn",
        sessionId: "session-id",
        appChallenge: challengeFor(appVerifier),
        payload: { accessToken: "github-token", clientId: "client-id" },
        status: "ready",
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 1000)
    };
}

// OAuth ticket transaction을 메모리에서 실행할 Firestore 대역을 구성합니다.
function fakeFirestore(initial = {}) {
    const data = new Map(Object.entries(initial));
    return {
        data,
        doc(documentPath) {
            return { path: documentPath };
        },
        async runTransaction(operation) {
            return operation({
                async get(reference) {
                    const value = data.get(reference.path);
                    return {
                        exists: value !== undefined,
                        data: () => value
                    };
                },
                update(reference, value) {
                    data.set(reference.path, {
                        ...data.get(reference.path),
                        ...value
                    });
                }
            });
        }
    };
}
