const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { Timestamp } = require("firebase-admin/firestore");
const {
    challengeFor,
    claimOAuthSession,
    claimOAuthTicket,
    completeOAuthSession,
    consumeOAuthTicket,
    createOAuthSession
} = require("../lib/rest/oauth/session");

(async () => {
    await assertInvalidAppChallengeIsRejected();
    await assertTicketVerifierAndConsumptionLifecycle();
    await assertLinkTicketKeepsUIDBinding();
    await assertExpiredTicketIsRejectedWithoutConsumption();
    await assertExpiredSessionClaimCanBeRecovered();
    await assertExpiredTicketClaimCanBeRecovered();
    assertOAuthExpirationFieldsUseTTL();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// session 생성 시 잘못된 app challenge를 verifier 오류와 구분하는지 검증합니다.
async function assertInvalidAppChallengeIsRejected() {
    const db = fakeFirestore();
    await assert.rejects(
        () => createOAuthSession(db, {
            provider: "github",
            purpose: "signIn",
            appChallenge: "invalid",
            providerPKCEVerifier: "b".repeat(64)
        }),
        (error) => error.details?.reason === "invalid_app_challenge"
    );
}

// verifier 실패가 ticket을 소비하지 않고 성공 요청만 한 번 소비하는지 검증합니다.
async function assertTicketVerifierAndConsumptionLifecycle() {
    const db = fakeFirestore();
    const appVerifier = "a".repeat(64);
    const session = await createOAuthSession(db, {
        provider: "github",
        purpose: "signIn",
        appChallenge: challengeFor(appVerifier),
        providerPKCEVerifier: "b".repeat(64)
    });
    const claimedSession = await claimOAuthSession(db, session.state, "github");
    const ticket = await completeOAuthSession(db, {
        session: claimedSession,
        payload: { accessToken: "github-token" }
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

    const claimedTicket = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        "github",
        "signIn"
    );
    assert.strictEqual(claimedTicket.payload.accessToken, "github-token");
    await consumeOAuthTicket(db, claimedTicket);
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

// 중단된 session의 processing lease가 만료되면 callback이 다시 claim하는지 검증합니다.
async function assertExpiredSessionClaimCanBeRecovered() {
    const db = fakeFirestore();
    const appVerifier = "i".repeat(64);
    const session = await createOAuthSession(db, {
        provider: "github",
        purpose: "signIn",
        appChallenge: challengeFor(appVerifier),
        providerPKCEVerifier: "j".repeat(64)
    });
    const stored = db.data.get(`oauthSessions/${session.state}`);
    db.data.set(`oauthSessions/${session.state}`, {
        ...stored,
        status: "processing",
        claim: "abandoned-claim",
        processingAt: Timestamp.fromMillis(Date.now() - 61 * 1000)
    });

    const claimed = await claimOAuthSession(db, session.state, "github");

    assert.notStrictEqual(claimed.claim, "abandoned-claim");
    assert.strictEqual(db.data.get(`oauthSessions/${session.state}`).claim, claimed.claim);
}

// 중단된 ticket의 processing lease가 만료되면 교환 요청이 다시 claim하는지 검증합니다.
async function assertExpiredTicketClaimCanBeRecovered() {
    const db = fakeFirestore();
    const appVerifier = "k".repeat(64);
    const ticket = "recoverable-ticket";
    db.data.set(`oauthTickets/${ticket}`, {
        provider: "github",
        purpose: "signIn",
        sessionId: "session-id",
        appChallenge: challengeFor(appVerifier),
        payload: { accessToken: "github-token" },
        status: "processing",
        claim: "abandoned-claim",
        processingAt: Timestamp.fromMillis(Date.now() - 61 * 1000),
        expiresAt: Timestamp.fromMillis(Date.now() + 60 * 1000)
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

// 계정 연결 ticket이 session을 요청한 Firebase uid와 계속 결합되는지 검증합니다.
async function assertLinkTicketKeepsUIDBinding() {
    const db = fakeFirestore();
    const appVerifier = "d".repeat(64);
    const session = await createOAuthSession(db, {
        provider: "github",
        purpose: "link",
        appChallenge: challengeFor(appVerifier),
        providerPKCEVerifier: "e".repeat(64),
        uid: "current-uid"
    });
    const claimedSession = await claimOAuthSession(db, session.state, "github");
    const ticket = await completeOAuthSession(db, {
        session: claimedSession,
        payload: { accessToken: "github-token" }
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

    const claimedTicket = await claimOAuthTicket(
        db,
        ticket,
        appVerifier,
        "github",
        "link",
        "current-uid"
    );
    assert.strictEqual(claimedTicket.uid, "current-uid");
}

// 만료 ticket이 거부되고 소비 상태로 바뀌지 않는지 검증합니다.
async function assertExpiredTicketIsRejectedWithoutConsumption() {
    const db = fakeFirestore();
    const appVerifier = "f".repeat(64);
    const ticket = "expired-ticket";
    db.data.set(`oauthTickets/${ticket}`, {
        provider: "github",
        purpose: "signIn",
        sessionId: "session-id",
        appChallenge: challengeFor(appVerifier),
        payload: { accessToken: "github-token" },
        status: "ready",
        expiresAt: Timestamp.fromMillis(Date.now() - 1)
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

// OAuth session과 ticket transaction을 메모리에서 실행할 Firestore 대역을 구성합니다.
function fakeFirestore() {
    const data = new Map();
    const db = {
        data,
        doc(path) {
            return {
                path,
                async create(value) {
                    if (data.has(path)) {
                        throw new Error("document already exists");
                    }
                    data.set(path, { ...value });
                }
            };
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
                create(reference, value) {
                    if (data.has(reference.path)) {
                        throw new Error("document already exists");
                    }
                    data.set(reference.path, { ...value });
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
    return db;
}
