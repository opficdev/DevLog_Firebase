const assert = require("assert");
const { Timestamp } = require("firebase-admin/firestore");

const authUpdates = [];
const authCreates = [];
const customTokenUIDs = [];
const tokenRequests = [];
const revokeRequests = [];
const users = new Map();
const providerOwners = new Map();
let tokenResponse;
let verifiedPayload;
let tokenExchangeError;
let revokeError;
let verifyError;
let providerLookupError;
let authUpdateError;
let authProfileUpdateError;
let authUpdateOwnerRaceUID;

const fakeAuth = {
    async getUser(uid) {
        const user = users.get(uid);
        if (!user) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return user;
    },
    async getUserByEmail(email) {
        const user = Array.from(users.values()).find((item) => item.email === email);
        if (!user) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return user;
    },
    async getUserByProviderUid(providerId, uid) {
        assert.strictEqual(providerId, "apple.com");
        if (providerLookupError) {
            const error = providerLookupError;
            providerLookupError = undefined;
            throw error;
        }
        const ownerUID = providerOwners.get(uid);
        if (!ownerUID) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return users.get(ownerUID) ?? { uid: ownerUID };
    },
    async createUser(properties) {
        authCreates.push(properties);
        const uid = properties.uid ?? `created-${authCreates.length}`;
        const providerData = properties.providerToLink ? [properties.providerToLink] : [];
        const user = {
            uid,
            email: properties.email,
            providerData
        };
        users.set(uid, user);
        if (properties.providerToLink?.uid) {
            providerOwners.set(properties.providerToLink.uid, uid);
        }
        return user;
    },
    async updateUser(uid, properties) {
        if (authUpdateOwnerRaceUID && properties.providerToLink) {
            const ownerUID = authUpdateOwnerRaceUID;
            authUpdateOwnerRaceUID = undefined;
            users.set(ownerUID, firebaseUser(
                ownerUID,
                "other@example.com",
                [appleProvider()]
            ));
            providerOwners.set(properties.providerToLink.uid, ownerUID);
            throw firebaseAuthError("auth/provider-already-linked");
        }
        if (authUpdateError) {
            const error = authUpdateError;
            authUpdateError = undefined;
            throw error;
        }
        if (authProfileUpdateError && "displayName" in properties) {
            const error = authProfileUpdateError;
            authProfileUpdateError = undefined;
            throw error;
        }
        authUpdates.push({ uid, properties });
        const user = users.get(uid) ?? { uid, providerData: [] };
        if (properties.providerToLink) {
            user.providerData = [
                ...(user.providerData ?? []).filter((provider) =>
                    provider.providerId !== properties.providerToLink.providerId
                ),
                properties.providerToLink
            ];
            providerOwners.set(properties.providerToLink.uid, uid);
        }
        if (properties.providersToUnlink) {
            user.providerData = (user.providerData ?? []).filter((provider) =>
                !properties.providersToUnlink.includes(provider.providerId)
            );
            for (const [subject, ownerUID] of providerOwners) {
                if (ownerUID === uid) {
                    providerOwners.delete(subject);
                }
            }
        }
        if ("displayName" in properties) {
            user.displayName = properties.displayName;
        }
        if ("photoURL" in properties) {
            user.photoURL = properties.photoURL ?? undefined;
        }
        users.set(uid, user);
        return user;
    },
    async createCustomToken(uid) {
        customTokenUIDs.push(uid);
        return `custom-token:${uid}`;
    }
};

const fakeAxios = {
    async post(url, data) {
        const parameters = new URLSearchParams(data);
        if (url === "https://appleid.apple.com/auth/token") {
            tokenRequests.push({
                grantType: parameters.get("grant_type"),
                code: parameters.get("code"),
                refreshToken: parameters.get("refresh_token")
            });
            if (tokenExchangeError) {
                throw tokenExchangeError;
            }
            if (parameters.get("grant_type") === "refresh_token") {
                return { data: { access_token: "issued-access-token" } };
            }
            return { data: tokenResponse };
        }
        if (url === "https://appleid.apple.com/auth/revoke") {
            revokeRequests.push({
                token: parameters.get("token"),
                tokenTypeHint: parameters.get("token_type_hint")
            });
            if (revokeError) {
                throw revokeError;
            }
            return { status: 200 };
        }
        throw new Error(`예상하지 않은 Apple API URL: ${url}`);
    },
    isAxiosError(error) {
        return error?.isAxiosError === true;
    }
};

const fakeAppleIdToken = {
    async verifyAppleIdToken(idToken, clientId, expectedHashedNonce) {
        if (verifyError) {
            throw verifyError;
        }
        assert.strictEqual(
            idToken,
            expectedHashedNonce === undefined ? "legacy-id-token" : "exchange-id-token"
        );
        assert.strictEqual(clientId, "apple-client-id");
        if (expectedHashedNonce !== undefined) {
            assert.strictEqual(expectedHashedNonce, "expected-hashed-nonce");
        }
        return verifiedPayload;
    },
    isAppleEmailVerified(payload) {
        return payload.email_verified === true || payload.email_verified === "true";
    }
};

require.cache[require.resolve("axios")] = { exports: fakeAxios };
require.cache[require.resolve("jsonwebtoken")] = {
    exports: { sign: () => "apple-client-secret" }
};
require.cache[require.resolve("firebase-admin")] = {
    exports: { auth: () => fakeAuth }
};
require.cache[require.resolve("../lib/auth/appleIdToken")] = {
    exports: fakeAppleIdToken
};

const {
    createAppleChallengeWithDatabase,
    linkAppleProviderWithDatabase,
    refreshAppleAccessTokenWithDatabase,
    requestAppleCustomTokenWithDatabase,
    requestAppleRefreshTokenWithDatabase,
    requestLegacyAppleCustomTokenWithDatabase,
    revokeAppleAccessTokenWithDatabase,
    unlinkAppleProviderWithDatabase
} = require("../lib/rest/apple/auth");

(async () => {
    setAppleEnvironment();
    assertChallengeTTLConfiguration();
    await assertChallengeCreation();
    await assertChallengeStateErrors();
    await assertConsumedChallengeSurvivesExchangeFailure();
    await assertMissingIDTokenRevokesExchangedCredential();
    await assertMissingRefreshTokenRevokesAccessToken();
    await assertInvalidProofRevokesExchangedCredential();
    await assertCompensationFailureIsReported();
    await assertAuthFailureRevokesExchangedCredential();
    await assertCredentialSaveFailureContinuesOnNextRequest();
    await assertCustomTokenUsesProofAndExistingEmailUID();
    await assertCustomTokenUsesAppleSubjectUIDWithoutEmail();
    await assertProvidedDisplayNameUpdatesProfile();
    await assertStoredAppleNameRestoresProfile();
    await assertBlankDisplayNameUsesStoredAppleName();
    await assertBlankDisplayNameDoesNotSetProfile();
    await assertFirebaseDisplayNameIsPreserved();
    await assertAppleProfileClearsPhotoURL();
    await assertProfileUpdateFailureContinuesOnNextRequest();
    await assertProviderChangeFailureContinuesOnNextRequest();
    await assertCustomTokenProviderOwnershipRaceCleansCredential();
    await assertLinkRequiresEmail();
    await assertLinkUsesCredentialEmailFallback();
    await assertLinkAcceptsEmailWithDifferentLetterCase();
    await assertLinkRejectsMismatchedEmail();
    await assertLinkRejectsOtherProviderOwner();
    await assertLinkKeepsCurrentProvider();
    await assertAccountLinkCredentialSaveFailureContinuesOnNextRequest();
    await assertAccountLinkProviderFailureContinuesOnNextRequest();
    await assertAccountLinkProviderOwnershipRaceCleansCredential();
    await assertCredentialMigrationPreservesNewValue();
    await assertInvalidRefreshGrantRequiresReauthentication();
    await assertOtherRefreshFailureRemainsInternal();
    await assertLegacyAppleContractsRemainAvailable();
    await assertLegacyCredentialSaveFailureContinuesOnRetry();
    await assertAccessTokenDeletionKeepsProvider();
    await assertAlreadyRevokedAndMissingCredentialSucceed();
    await assertRevokeFailurePreservesCredential();
    await assertUnlinkBlocksLastProvider();
    await assertCredentialDeleteFailureContinuesOnRetry();
    await assertProviderUnlinkFailureContinuesOnRetry();
    await assertUnlinkCompletesRemainingStepsOnRetry();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// challenge 만료 field가 TTL 대상이며 단일 field 색인이 비활성인지 검증합니다.
function assertChallengeTTLConfiguration() {
    const configuration = require("../../firestore.index.json");
    const override = configuration.fieldOverrides.find((item) =>
        item.collectionGroup === "authChallenges" &&
        item.fieldPath === "expiresAt"
    );

    assert.deepStrictEqual(override, {
        collectionGroup: "authChallenges",
        fieldPath: "expiresAt",
        ttl: true,
        indexes: []
    });
}

// challenge 생성 응답과 서버 저장 자료를 검증합니다.
async function assertChallengeCreation() {
    resetState();
    const db = fakeFirestore();
    const result = await createAppleChallengeWithDatabase(db);
    const stored = db.data.get(`authChallenges/${result.challengeId}`);

    assert.strictEqual(result.challengeId, "challenge-1");
    assert.match(result.hashedNonce, /^[a-f0-9]{64}$/);
    assert.strictEqual(result.hashedNonce, stored.expectedHashedNonce);
    assert.strictEqual(stored.consumedAt, null);
    assert.ok(stored.expiresAt.toMillis() <= Date.parse(result.expiresAt));
    assert.ok(Date.now() < stored.expiresAt.toMillis());
}

// challenge의 존재하지 않음, 만료, 소비 상태가 구분되는지 검증합니다.
async function assertChallengeStateErrors() {
    resetState();
    const missingDB = fakeFirestore();
    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(missingDB, "missing", "code"),
        "invalid_apple_challenge"
    );

    const expiredDB = fakeFirestore({
        "authChallenges/expired": challengeData(Date.now() - 1)
    });
    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(expiredDB, "expired", "code"),
        "expired_apple_challenge"
    );

    const consumedDB = fakeFirestore({
        "authChallenges/consumed": {
            ...challengeData(Date.now() + 60_000),
            consumedAt: Timestamp.now()
        }
    });
    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(consumedDB, "consumed", "code"),
        "consumed_apple_challenge"
    );
    assert.strictEqual(tokenRequests.length, 0);
}

// Apple code 교환 실패 뒤에도 challenge가 다시 사용되지 않는지 검증합니다.
async function assertConsumedChallengeSurvivesExchangeFailure() {
    resetState();
    const db = validChallengeFirestore("failure");
    tokenExchangeError = new Error("비밀 요청 본문을 포함할 수 있는 외부 오류");

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(db, "failure", "secret-code"),
        "invalid_apple_proof"
    );
    tokenExchangeError = undefined;
    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(db, "failure", "retry-code"),
        "consumed_apple_challenge"
    );
    assert.ok(db.data.get("authChallenges/failure").consumedAt);
    assert.strictEqual(tokenRequests.length, 1);
}

// 교환 응답의 ID token이 없으면 refresh token을 보상 폐기하는지 검증합니다.
async function assertMissingIDTokenRevokesExchangedCredential() {
    resetState();
    const db = validChallengeFirestore("missing-id-token");
    tokenResponse.id_token = undefined;

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "missing-id-token",
            "authorization-code"
        ),
        "invalid_apple_proof"
    );

    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
}

// refresh token이 빠진 교환 응답은 custom token과 account link 모두 access token을 보상 폐기하는지 검증합니다.
async function assertMissingRefreshTokenRevokesAccessToken() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    tokenResponse.refresh_token = undefined;
    const customTokenDB = validChallengeFirestore("missing-custom-refresh-token");

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(
            customTokenDB,
            "missing-custom-refresh-token",
            "authorization-code"
        ),
        "apple_credential_not_found"
    );
    assert.deepStrictEqual(revokeRequests, [{
        token: "access-token",
        tokenTypeHint: "access_token"
    }]);

    const linkDB = validChallengeFirestore("missing-link-refresh-token");
    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            linkDB,
            "current-uid",
            "missing-link-refresh-token",
            "authorization-code"
        ),
        "apple_credential_not_found"
    );
    assert.deepStrictEqual(revokeRequests, [{
        token: "access-token",
        tokenTypeHint: "access_token"
    }, {
        token: "access-token",
        tokenTypeHint: "access_token"
    }]);
    assert.strictEqual(authUpdates.length, 0);
}

// ID token 또는 nonce 검증 실패 시 교환된 credential을 보상 폐기하는지 검증합니다.
async function assertInvalidProofRevokesExchangedCredential() {
    resetState();
    const db = validChallengeFirestore("invalid-proof");
    verifyError = new Error("nonce mismatch");

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "invalid-proof",
            "authorization-code"
        ),
        "invalid_apple_proof"
    );

    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
    assert.ok(db.data.get("authChallenges/invalid-proof").consumedAt);
}

// 증명 실패 보상 폐기까지 실패하면 apple-revoke-failed를 반환하는지 검증합니다.
async function assertCompensationFailureIsReported() {
    resetState();
    const db = validChallengeFirestore("compensation-failure");
    verifyError = new Error("nonce mismatch");
    revokeError = axiosError(500, { error: "server_error" });

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "compensation-failure",
            "authorization-code"
        ),
        "apple_revoke_failed"
    );
}

// Firebase Auth uid 선택 실패 전에 교환된 credential을 보상 폐기하는지 검증합니다.
async function assertAuthFailureRevokesExchangedCredential() {
    resetState();
    const db = validChallengeFirestore("auth-failure");
    providerLookupError = new Error("Firebase Auth unavailable");

    await assert.rejects(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "auth-failure",
            "authorization-code"
        ),
        /Firebase Auth unavailable/
    );

    assert.strictEqual(revokeRequests.length, 1);
    assert.strictEqual(authUpdates.length, 0);
}

// provider 연결 뒤 credential 저장 실패가 grant를 폐기하고 다음 요청에서 저장을 완료하는지 검증합니다.
async function assertCredentialSaveFailureContinuesOnNextRequest() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/save-failure": challengeData(Date.now() + 60_000),
        "authChallenges/save-retry": challengeData(Date.now() + 60_000)
    });
    db.failNextSet = true;

    await assert.rejects(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "save-failure",
            "authorization-code"
        ),
        /credential write failed/
    );

    assert.strictEqual(revokeRequests.length, 1);
    assert.strictEqual(providerOwners.get("apple-subject"), "email-uid");
    assert.strictEqual(db.data.has("authCredentials/email-uid/providers/apple"), false);

    tokenResponse.refresh_token = "retry-refresh-token";
    const retried = await requestAppleCustomTokenWithDatabase(
        db,
        "save-retry",
        "retry-code"
    );

    assert.deepStrictEqual(retried, { customToken: "custom-token:email-uid" });
    assert.strictEqual(
        db.data.get("authCredentials/email-uid/providers/apple").refreshToken,
        "retry-refresh-token"
    );
}

// 기존 Apple provider가 없을 때 이메일 uid에 provider를 연결하고 custom token을 반환하는지 검증합니다.
async function assertCustomTokenUsesProofAndExistingEmailUID() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = validChallengeFirestore("login");

    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "login",
        "authorization-code"
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:email-uid" });
    assert.deepStrictEqual(customTokenUIDs, ["email-uid"]);
    assert.strictEqual(providerOwners.get("apple-subject"), "email-uid");
    assert.strictEqual(
        db.data.get("authCredentials/email-uid/providers/apple").refreshToken,
        "refresh-token"
    );
    assert.strictEqual(tokenRequests[0].code, "authorization-code");
    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(db, "login", "second-code"),
        "consumed_apple_challenge"
    );
}

// 이메일이 없는 Apple 계정은 apple subject uid로 사용자와 provider를 생성하는지 검증합니다.
async function assertCustomTokenUsesAppleSubjectUIDWithoutEmail() {
    resetState();
    verifiedPayload = applePayload({ email: undefined, email_verified: undefined });
    const db = validChallengeFirestore("subject-login");

    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "subject-login",
        "authorization-code"
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:apple:apple-subject" });
    assert.strictEqual(authCreates[0].uid, "apple:apple-subject");
    assert.strictEqual(authCreates[0].providerToLink, undefined);
    assert.strictEqual(authUpdates[0].properties.providerToLink.providerId, "apple.com");
}

// 전달된 이름을 정리해 선택된 Firebase Auth 사용자의 profile에 반영하는지 검증합니다.
async function assertProvidedDisplayNameUpdatesProfile() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = validChallengeFirestore("provided-name");

    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "provided-name",
        "authorization-code",
        "  Apple User  "
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:email-uid" });
    assert.strictEqual(users.get("email-uid").displayName, "Apple User");
    assert.deepStrictEqual(customTokenUIDs, ["email-uid"]);
}

// 전달된 이름이 없으면 기존 Firestore appleName을 Firebase Auth profile에 반영하는지 검증합니다.
async function assertStoredAppleNameRestoresProfile() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/stored-name": challengeData(Date.now() + 60_000),
        "users/email-uid/userData/info": { appleName: "Stored Apple User" }
    });

    await requestAppleCustomTokenWithDatabase(
        db,
        "stored-name",
        "authorization-code"
    );

    assert.strictEqual(users.get("email-uid").displayName, "Stored Apple User");
}

// 공백 이름은 없는 값으로 처리해 기존 Firestore appleName을 사용하는지 검증합니다.
async function assertBlankDisplayNameUsesStoredAppleName() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/blank-name": challengeData(Date.now() + 60_000),
        "users/email-uid/userData/info": { appleName: "Existing Apple User" }
    });

    await requestAppleCustomTokenWithDatabase(
        db,
        "blank-name",
        "authorization-code",
        "   "
    );

    assert.strictEqual(users.get("email-uid").displayName, "Existing Apple User");
}

// 모든 이름 자료가 비어 있으면 Firebase Auth profile 이름을 설정하지 않는지 검증합니다.
async function assertBlankDisplayNameDoesNotSetProfile() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = validChallengeFirestore("empty-name");

    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "empty-name",
        "authorization-code",
        "   "
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:email-uid" });
    assert.strictEqual(users.get("email-uid").displayName, undefined);
    assert.strictEqual(
        authUpdates.some((update) => "displayName" in update.properties),
        false
    );
}

// 이름 입력과 Firestore appleName이 없으면 기존 Firebase Auth displayName을 유지하는지 검증합니다.
async function assertFirebaseDisplayNameIsPreserved() {
    resetState();
    users.set("email-uid", {
        ...firebaseUser("email-uid", "user@example.com"),
        displayName: "Firebase Apple User"
    });
    const db = validChallengeFirestore("firebase-name");

    await requestAppleCustomTokenWithDatabase(
        db,
        "firebase-name",
        "authorization-code"
    );

    assert.strictEqual(users.get("email-uid").displayName, "Firebase Apple User");
    assert.strictEqual(
        authUpdates.some((update) => "displayName" in update.properties),
        false
    );
}

// Apple 로그인은 이름 자료가 없어도 기존 Firebase Auth photoURL을 제거하는지 검증합니다.
async function assertAppleProfileClearsPhotoURL() {
    resetState();
    users.set("email-uid", {
        ...firebaseUser("email-uid", "user@example.com"),
        photoURL: "https://example.com/profile.png"
    });
    const db = validChallengeFirestore("photo-url");

    await requestAppleCustomTokenWithDatabase(
        db,
        "photo-url",
        "authorization-code"
    );

    assert.strictEqual(users.get("email-uid").photoURL, undefined);
    assert.strictEqual(
        authUpdates.some((update) => update.properties.photoURL === null),
        true
    );
}

// profile 갱신 실패가 token을 폐기하고 다음 요청에서 profile과 credential 저장을 완료하는지 검증합니다.
async function assertProfileUpdateFailureContinuesOnNextRequest() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/profile-failure": challengeData(Date.now() + 60_000),
        "authChallenges/profile-retry": challengeData(Date.now() + 60_000)
    });
    authProfileUpdateError = new Error("profile update failed");

    await assert.rejects(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "profile-failure",
            "first-code",
            "First Apple User"
        ),
        /profile update failed/
    );

    assert.strictEqual(db.data.has("authCredentials/email-uid/providers/apple"), false);
    assert.strictEqual(providerOwners.get("apple-subject"), "email-uid");
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
    assert.deepStrictEqual(customTokenUIDs, []);

    tokenResponse.refresh_token = "second-refresh-token";
    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "profile-retry",
        "second-code",
        "Second Apple User"
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:email-uid" });
    assert.strictEqual(users.get("email-uid").displayName, "Second Apple User");
    assert.strictEqual(
        db.data.get("authCredentials/email-uid/providers/apple").refreshToken,
        "second-refresh-token"
    );
}

// provider 변경 실패 뒤 교환 token을 폐기하고 다음 요청에서 연결을 완료하는지 검증합니다.
async function assertProviderChangeFailureContinuesOnNextRequest() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/first-provider-attempt": challengeData(Date.now() + 60_000),
        "authChallenges/second-provider-attempt": challengeData(Date.now() + 60_000)
    });
    authUpdateError = new Error("provider update failed");

    await assert.rejects(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "first-provider-attempt",
            "first-code"
        ),
        /provider update failed/
    );
    assert.strictEqual(db.data.has("authCredentials/email-uid/providers/apple"), false);
    assert.strictEqual(providerOwners.has("apple-subject"), false);
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);

    tokenResponse.refresh_token = "second-refresh-token";
    const result = await requestAppleCustomTokenWithDatabase(
        db,
        "second-provider-attempt",
        "second-code"
    );

    assert.deepStrictEqual(result, { customToken: "custom-token:email-uid" });
    assert.strictEqual(providerOwners.get("apple-subject"), "email-uid");
    assert.strictEqual(
        db.data.get("authCredentials/email-uid/providers/apple").refreshToken,
        "second-refresh-token"
    );
    assert.strictEqual(revokeRequests.length, 1);
}

// custom token provider 연결 경합이 교환 token을 폐기하고 credential 저장을 막는지 검증합니다.
async function assertCustomTokenProviderOwnershipRaceCleansCredential() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = validChallengeFirestore("custom-token-race");
    authUpdateOwnerRaceUID = "other-uid";

    await assertAppleReason(
        () => requestAppleCustomTokenWithDatabase(
            db,
            "custom-token-race",
            "authorization-code"
        ),
        "apple_provider_link_conflict"
    );

    assert.strictEqual(db.data.has("authCredentials/email-uid/providers/apple"), false);
    assert.strictEqual(providerOwners.get("apple-subject"), "other-uid");
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
}

// 검증 가능한 이메일과 credentialEmail이 모두 없으면 연결을 차단하는지 검증합니다.
async function assertLinkRequiresEmail() {
    resetState();
    verifiedPayload = applePayload({ email: undefined, email_verified: undefined });
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = validChallengeFirestore("email-not-found");

    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "email-not-found",
            "authorization-code"
        ),
        "email_not_found"
    );

    assert.strictEqual(authUpdates.length, 0);
}

// Apple 이메일 claim이 없을 때 credentialEmail 호환 값으로 기존 이메일 결과를 보존하는지 검증합니다.
async function assertLinkUsesCredentialEmailFallback() {
    resetState();
    verifiedPayload = applePayload({ email: undefined, email_verified: undefined });
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = validChallengeFirestore("credential-email");

    const result = await linkAppleProviderWithDatabase(
        db,
        "current-uid",
        "credential-email",
        "authorization-code",
        "user@example.com"
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(authUpdates[0].properties.providerToLink.uid, "apple-subject");
}

// Firebase와 Apple 이메일의 대소문자만 다를 때 같은 이메일로 연결하는지 검증합니다.
async function assertLinkAcceptsEmailWithDifferentLetterCase() {
    resetState();
    verifiedPayload = applePayload({ email: "User@Example.com" });
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = validChallengeFirestore("email-letter-case");

    const result = await linkAppleProviderWithDatabase(
        db,
        "current-uid",
        "email-letter-case",
        "authorization-code"
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(authUpdates[0].properties.providerToLink.uid, "apple-subject");
}

// 현재 Firebase 이메일과 Apple credential 이메일 불일치가 provider 변경을 막는지 검증합니다.
async function assertLinkRejectsMismatchedEmail() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "current@example.com"));
    const db = validChallengeFirestore("mismatch");

    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "mismatch",
            "authorization-code"
        ),
        "email_mismatch"
    );

    assert.strictEqual(authUpdates.length, 0);
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
}

// 다른 Firebase uid가 소유한 Apple provider를 현재 uid로 이동하지 않는지 검증합니다.
async function assertLinkRejectsOtherProviderOwner() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    users.set("other-uid", firebaseUser("other-uid", "other@example.com", [appleProvider()]));
    providerOwners.set("apple-subject", "other-uid");
    const db = validChallengeFirestore("conflict");

    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "conflict",
            "authorization-code"
        ),
        "apple_provider_link_conflict"
    );

    assert.strictEqual(authUpdates.length, 0);
    assert.strictEqual(authCreates.length, 0);
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
}

// 현재 uid가 이미 소유한 Apple provider 연결 요청은 성공으로 처리되는지 검증합니다.
async function assertLinkKeepsCurrentProvider() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com", [appleProvider()]));
    providerOwners.set("apple-subject", "current-uid");
    const db = validChallengeFirestore("same-owner");

    const result = await linkAppleProviderWithDatabase(
        db,
        "current-uid",
        "same-owner",
        "authorization-code"
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(authUpdates.length, 0);
    assert.strictEqual(
        db.data.get("authCredentials/current-uid/providers/apple").refreshToken,
        "refresh-token"
    );
}

// account link credential 저장 실패가 provider 연결을 유지하고 다음 요청에서 저장을 완료하는지 검증합니다.
async function assertAccountLinkCredentialSaveFailureContinuesOnNextRequest() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/first-link-save": challengeData(Date.now() + 60_000),
        "authChallenges/second-link-save": challengeData(Date.now() + 60_000)
    });
    db.failNextSet = true;

    await assert.rejects(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "first-link-save",
            "first-code"
        ),
        /credential write failed/
    );
    assert.strictEqual(providerOwners.get("apple-subject"), "current-uid");
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.strictEqual(revokeRequests.length, 1);

    tokenResponse.refresh_token = "second-refresh-token";
    const result = await linkAppleProviderWithDatabase(
        db,
        "current-uid",
        "second-link-save",
        "second-code"
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(
        db.data.get("authCredentials/current-uid/providers/apple").refreshToken,
        "second-refresh-token"
    );
}

// account link provider 변경 실패가 교환 token을 폐기하고 다음 요청에서 완료되는지 검증합니다.
async function assertAccountLinkProviderFailureContinuesOnNextRequest() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = fakeFirestore({
        "authChallenges/first-link-attempt": challengeData(Date.now() + 60_000),
        "authChallenges/second-link-attempt": challengeData(Date.now() + 60_000)
    });
    authUpdateError = new Error("provider update failed");

    await assert.rejects(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "first-link-attempt",
            "first-code"
        ),
        /provider update failed/
    );
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);

    tokenResponse.refresh_token = "second-refresh-token";
    const result = await linkAppleProviderWithDatabase(
        db,
        "current-uid",
        "second-link-attempt",
        "second-code"
    );

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(providerOwners.get("apple-subject"), "current-uid");
    assert.strictEqual(
        db.data.get("authCredentials/current-uid/providers/apple").refreshToken,
        "second-refresh-token"
    );
}

// account link provider 연결 경합이 교환 token을 폐기하고 credential 저장을 막는지 검증합니다.
async function assertAccountLinkProviderOwnershipRaceCleansCredential() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com"));
    const db = validChallengeFirestore("account-link-race");
    authUpdateOwnerRaceUID = "other-uid";

    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "account-link-race",
            "authorization-code"
        ),
        "apple_provider_link_conflict"
    );

    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.strictEqual(providerOwners.get("apple-subject"), "other-uid");
    assert.deepStrictEqual(revokeRequests, [{
        token: "refresh-token",
        tokenTypeHint: "refresh_token"
    }]);
}

// 새 credential 우선 정책과 기존 field 삭제를 검증합니다.
async function assertCredentialMigrationPreservesNewValue() {
    resetState();
    const legacyOnlyDB = fakeFirestore({
        "users/user-1/userData/tokens": { appleRefreshToken: "legacy-refresh-token" }
    });

    const legacyResult = await refreshAppleAccessTokenWithDatabase(
        legacyOnlyDB,
        "user-1"
    );
    assert.deepStrictEqual(legacyResult, { token: "issued-access-token" });
    assert.strictEqual(
        legacyOnlyDB.data.get("authCredentials/user-1/providers/apple").refreshToken,
        "legacy-refresh-token"
    );
    assert.strictEqual(
        legacyOnlyDB.data.get("users/user-1/userData/tokens").appleRefreshToken,
        undefined
    );

    const newCredentialDB = fakeFirestore({
        "authCredentials/user-2/providers/apple": { refreshToken: "new-refresh-token" },
        "users/user-2/userData/tokens": { appleRefreshToken: "stale-refresh-token" }
    });
    await refreshAppleAccessTokenWithDatabase(newCredentialDB, "user-2");
    assert.strictEqual(tokenRequests.at(-1).refreshToken, "new-refresh-token");
    assert.strictEqual(
        newCredentialDB.data.get("authCredentials/user-2/providers/apple").refreshToken,
        "new-refresh-token"
    );
    assert.strictEqual(
        newCredentialDB.data.get("users/user-2/userData/tokens").appleRefreshToken,
        undefined
    );
}

// 무효 Apple refresh token이 재인증 가능한 오류를 반환하고 credential을 보존하는지 검증합니다.
async function assertInvalidRefreshGrantRequiresReauthentication() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/apple": { refreshToken: "invalid-refresh-token" }
    });
    tokenExchangeError = axiosError(400, { error: "invalid_grant" });

    await assert.rejects(
        () => refreshAppleAccessTokenWithDatabase(db, "user-1"),
        (error) => {
            assert.strictEqual(error.code, "unauthenticated");
            return true;
        }
    );

    assert.strictEqual(db.data.has("authCredentials/user-1/providers/apple"), true);
}

// invalid_grant가 아닌 Apple token 오류가 기존 내부 오류와 credential을 유지하는지 검증합니다.
async function assertOtherRefreshFailureRemainsInternal() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/user-1/providers/apple": { refreshToken: "stored-refresh-token" }
    });
    tokenExchangeError = axiosError(500, { error: "server_error" });

    await assert.rejects(
        () => refreshAppleAccessTokenWithDatabase(db, "user-1"),
        (error) => {
            assert.strictEqual(error.code, "internal");
            return true;
        }
    );

    assert.strictEqual(db.data.has("authCredentials/user-1/providers/apple"), true);
}

// 지원 중인 이전 iOS의 custom token과 refresh token 계약을 유지하는지 검증합니다.
async function assertLegacyAppleContractsRemainAvailable() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const db = fakeFirestore();

    const customTokenResult = await requestLegacyAppleCustomTokenWithDatabase(
        db,
        "legacy-id-token",
        "legacy-custom-token-code"
    );
    const refreshTokenResult = await requestAppleRefreshTokenWithDatabase(
        db,
        "email-uid",
        "legacy-refresh-token-code"
    );
    const revokeResult = await revokeAppleAccessTokenWithDatabase(
        fakeFirestore(),
        "email-uid",
        "legacy-access-token"
    );

    assert.deepStrictEqual(customTokenResult, {
        customToken: "custom-token:email-uid"
    });
    assert.deepStrictEqual(refreshTokenResult, {
        success: true,
        refreshToken: "refresh-token"
    });
    assert.deepStrictEqual(revokeResult, { success: true });
    assert.deepStrictEqual(revokeRequests.at(-1), {
        token: "legacy-access-token",
        tokenTypeHint: "access_token"
    });
}

// 이전 iOS 흐름의 credential 저장 실패가 token을 폐기하고 새 code 재호출로 완료되는지 검증합니다.
async function assertLegacyCredentialSaveFailureContinuesOnRetry() {
    resetState();
    users.set("email-uid", firebaseUser("email-uid", "user@example.com"));
    const customTokenDB = fakeFirestore();
    customTokenDB.failNextSet = true;

    await assert.rejects(
        () => requestLegacyAppleCustomTokenWithDatabase(
            customTokenDB,
            "legacy-id-token",
            "first-custom-token-code"
        ),
        /credential write failed/
    );
    assert.strictEqual(revokeRequests.length, 1);

    tokenResponse.refresh_token = "retry-custom-token-refresh-token";
    const customTokenResult = await requestLegacyAppleCustomTokenWithDatabase(
        customTokenDB,
        "legacy-id-token",
        "second-custom-token-code"
    );
    assert.deepStrictEqual(customTokenResult, {
        customToken: "custom-token:email-uid"
    });
    assert.strictEqual(
        customTokenDB.data.get("authCredentials/email-uid/providers/apple").refreshToken,
        "retry-custom-token-refresh-token"
    );

    resetState();
    const refreshTokenDB = fakeFirestore();
    refreshTokenDB.failNextSet = true;
    await assert.rejects(
        () => requestAppleRefreshTokenWithDatabase(
            refreshTokenDB,
            "email-uid",
            "first-refresh-token-code"
        ),
        /credential write failed/
    );
    assert.strictEqual(revokeRequests.length, 1);

    tokenResponse.refresh_token = "retry-refresh-token";
    const refreshTokenResult = await requestAppleRefreshTokenWithDatabase(
        refreshTokenDB,
        "email-uid",
        "second-refresh-token-code"
    );
    assert.deepStrictEqual(refreshTokenResult, {
        success: true,
        refreshToken: "retry-refresh-token"
    });
}

// access-token 삭제가 Apple provider를 유지하고 credential만 정리하는지 검증합니다.
async function assertAccessTokenDeletionKeepsProvider() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com", [appleProvider()]));
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });

    const result = await revokeAppleAccessTokenWithDatabase(db, "current-uid");

    assert.deepStrictEqual(result, { success: true });
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.strictEqual(authUpdates.length, 0);
    assert.strictEqual(users.get("current-uid").providerData[0].providerId, "apple.com");
}

// 이미 폐기된 grant와 없는 credential을 성공으로 정리하는지 검증합니다.
async function assertAlreadyRevokedAndMissingCredentialSucceed() {
    resetState();
    const revokedDB = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "revoked-refresh-token" }
    });
    revokeError = axiosError(400, { error: "invalid_grant" });

    const revokedResult = await revokeAppleAccessTokenWithDatabase(
        revokedDB,
        "current-uid"
    );
    revokeError = undefined;
    const missingResult = await revokeAppleAccessTokenWithDatabase(
        fakeFirestore(),
        "current-uid"
    );

    assert.deepStrictEqual(revokedResult, { success: true });
    assert.deepStrictEqual(missingResult, { success: true });
    assert.strictEqual(revokedDB.data.has("authCredentials/current-uid/providers/apple"), false);
}

// Apple revoke가 확인되지 않은 실패이면 credential을 보존하는지 검증합니다.
async function assertRevokeFailurePreservesCredential() {
    resetState();
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });
    revokeError = axiosError(500, { error: "server_error" });

    await assertAppleReason(
        () => revokeAppleAccessTokenWithDatabase(db, "current-uid"),
        "apple_revoke_failed"
    );

    assert.strictEqual(
        db.data.get("authCredentials/current-uid/providers/apple").refreshToken,
        "stored-refresh-token"
    );
}

// 마지막 Apple provider 해제가 grant와 credential을 변경하지 않는지 검증합니다.
async function assertUnlinkBlocksLastProvider() {
    resetState();
    users.set("current-uid", firebaseUser("current-uid", "user@example.com", [appleProvider()]));
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });

    await assertAppleReason(
        () => unlinkAppleProviderWithDatabase(db, "current-uid"),
        "last_provider"
    );

    assert.strictEqual(revokeRequests.length, 0);
    assert.strictEqual(authUpdates.length, 0);
    assert.ok(db.data.has("authCredentials/current-uid/providers/apple"));
}

// grant 폐기 뒤 credential 삭제 실패가 자료를 보존하고 재호출에서 정리되는지 검증합니다.
async function assertCredentialDeleteFailureContinuesOnRetry() {
    resetState();
    users.set("current-uid", firebaseUser(
        "current-uid",
        "user@example.com",
        [appleProvider(), { providerId: "google.com", uid: "google-subject" }]
    ));
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });
    db.failNextDelete = true;

    await assert.rejects(
        () => unlinkAppleProviderWithDatabase(db, "current-uid"),
        /credential delete failed/
    );
    assert.ok(db.data.has("authCredentials/current-uid/providers/apple"));
    assert.strictEqual(providerOwners.has("apple-subject"), false);
    assert.strictEqual(users.get("current-uid").providerData.length, 2);

    revokeError = axiosError(400, { error: "invalid_grant" });
    const retried = await unlinkAppleProviderWithDatabase(db, "current-uid");

    assert.deepStrictEqual(retried, { success: true });
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.deepStrictEqual(users.get("current-uid").providerData, [{
        providerId: "google.com",
        uid: "google-subject"
    }]);
}

// credential 삭제 뒤 provider 해제 실패가 재호출에서 남은 정리를 완료하는지 검증합니다.
async function assertProviderUnlinkFailureContinuesOnRetry() {
    resetState();
    users.set("current-uid", firebaseUser(
        "current-uid",
        "user@example.com",
        [appleProvider(), { providerId: "google.com", uid: "google-subject" }]
    ));
    providerOwners.set("apple-subject", "current-uid");
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });
    authUpdateError = new Error("provider unlink failed");

    await assert.rejects(
        () => unlinkAppleProviderWithDatabase(db, "current-uid"),
        /provider unlink failed/
    );
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.strictEqual(users.get("current-uid").providerData.length, 2);

    const retried = await unlinkAppleProviderWithDatabase(db, "current-uid");

    assert.deepStrictEqual(retried, { success: true });
    assert.deepStrictEqual(users.get("current-uid").providerData, [{
        providerId: "google.com",
        uid: "google-subject"
    }]);
}

// revoke와 credential 삭제 이후 재호출이 남은 provider 정리를 완료하는지 검증합니다.
async function assertUnlinkCompletesRemainingStepsOnRetry() {
    resetState();
    users.set("current-uid", firebaseUser(
        "current-uid",
        "user@example.com",
        [appleProvider(), { providerId: "google.com", uid: "google-subject" }]
    ));
    const db = fakeFirestore({
        "authCredentials/current-uid/providers/apple": { refreshToken: "stored-refresh-token" }
    });

    const result = await unlinkAppleProviderWithDatabase(db, "current-uid");
    const retried = await unlinkAppleProviderWithDatabase(db, "current-uid");

    assert.deepStrictEqual(result, { success: true });
    assert.deepStrictEqual(retried, { success: true });
    assert.strictEqual(db.data.has("authCredentials/current-uid/providers/apple"), false);
    assert.deepStrictEqual(users.get("current-uid").providerData, [{
        providerId: "google.com",
        uid: "google-subject"
    }]);
    assert.strictEqual(revokeRequests.length, 1);
}

function setAppleEnvironment() {
    process.env.APPLE_TEAM_ID = "apple-team-id";
    process.env.APPLE_CLIENT_ID = "apple-client-id";
    process.env.APPLE_KEY_ID = "apple-key-id";
    process.env.APPLE_PRIVATE_KEY = "apple-private-key";
}

// 기능 테스트 간 공유 상태를 초기화합니다.
function resetState() {
    authUpdates.length = 0;
    authCreates.length = 0;
    customTokenUIDs.length = 0;
    tokenRequests.length = 0;
    revokeRequests.length = 0;
    users.clear();
    providerOwners.clear();
    tokenResponse = {
        access_token: "access-token",
        refresh_token: "refresh-token",
        id_token: "exchange-id-token",
        token_type: "Bearer",
        expires_in: 3600
    };
    verifiedPayload = applePayload();
    tokenExchangeError = undefined;
    revokeError = undefined;
    verifyError = undefined;
    providerLookupError = undefined;
    authUpdateError = undefined;
    authProfileUpdateError = undefined;
    authUpdateOwnerRaceUID = undefined;
}

// Apple ID token payload 기본값에 테스트별 값을 덮어씁니다.
function applePayload(overrides = {}) {
    return {
        iss: "https://appleid.apple.com",
        sub: "apple-subject",
        aud: "apple-client-id",
        iat: 1,
        exp: 9_999_999_999,
        email: "user@example.com",
        email_verified: true,
        nonce: "expected-hashed-nonce",
        ...overrides
    };
}

// Firebase Auth 사용자 테스트 자료를 구성합니다.
function firebaseUser(uid, email, providerData = []) {
    return { uid, email, providerData };
}

// Apple provider 테스트 자료를 구성합니다.
function appleProvider() {
    return {
        providerId: "apple.com",
        uid: "apple-subject",
        email: "user@example.com"
    };
}

// 미사용 challenge 테스트 자료를 구성합니다.
function challengeData(expiresAtMilliseconds) {
    return {
        expectedHashedNonce: "expected-hashed-nonce",
        expiresAt: Timestamp.fromMillis(expiresAtMilliseconds),
        consumedAt: null
    };
}

// 유효한 challenge가 포함된 메모리 Firestore를 구성합니다.
function validChallengeFirestore(challengeId) {
    return fakeFirestore({
        [`authChallenges/${challengeId}`]: challengeData(Date.now() + 60_000)
    });
}

// 문서와 transaction 동작을 제공하는 메모리 Firestore를 구성합니다.
function fakeFirestore(initialData = {}) {
    const data = new Map(
        Object.entries(initialData).map(([path, value]) => [path, { ...value }])
    );
    const db = {
        data,
        failNextSet: false,
        failNextDelete: false,
        doc(path) {
            return documentReference(db, path);
        },
        collection(path) {
            return {
                doc() {
                    return documentReference(db, `${path}/challenge-1`, "challenge-1");
                }
            };
        },
        async runTransaction(operation) {
            return operation(transactionFor(db));
        }
    };
    return db;
}

// 메모리 Firestore 문서 참조를 구성합니다.
function documentReference(db, path, id = path.split("/").at(-1)) {
    return {
        path,
        id,
        async get() {
            const value = db.data.get(path);
            return {
                exists: value !== undefined,
                data: () => value
            };
        },
        async create(value) {
            assert.strictEqual(db.data.has(path), false);
            db.data.set(path, { ...value });
        }
    };
}

// 메모리 Firestore transaction을 구성합니다.
function transactionFor(db) {
    return {
        async get(reference) {
            const value = db.data.get(reference.path);
            return {
                exists: value !== undefined,
                data: () => value
            };
        },
        set(reference, value, options) {
            if (db.failNextSet) {
                db.failNextSet = false;
                throw new Error("credential write failed");
            }
            const current = options?.merge ? db.data.get(reference.path) ?? {} : {};
            db.data.set(reference.path, applyFieldValues({ ...current, ...value }));
        },
        update(reference, value) {
            const current = db.data.get(reference.path) ?? {};
            db.data.set(reference.path, applyFieldValues({ ...current, ...value }));
        },
        delete(reference) {
            if (db.failNextDelete) {
                db.failNextDelete = false;
                throw new Error("credential delete failed");
            }
            db.data.delete(reference.path);
        }
    };
}

// Firestore FieldValue 표식을 메모리 자료 변경으로 반영합니다.
function applyFieldValues(value) {
    const result = { ...value };
    for (const [key, item] of Object.entries(result)) {
        if (item?.constructor?.name === "DeleteTransform") {
            delete result[key];
        } else if (item?.constructor?.name === "ServerTimestampTransform") {
            result[key] = Timestamp.now();
        }
    }
    return result;
}

// Firebase Auth 오류 코드 형태의 예외를 구성합니다.
function firebaseAuthError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

// Axios 오류 형태의 예외를 구성합니다.
function axiosError(status, data) {
    const error = new Error(`status ${status}`);
    error.isAxiosError = true;
    error.response = { status, data };
    return error;
}

// Apple 인증 오류의 구분 사유를 검증합니다.
async function assertAppleReason(operation, reason) {
    await assert.rejects(operation, (error) => {
        assert.strictEqual(error.details?.reason, reason);
        return true;
    });
}
