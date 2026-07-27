const assert = require("assert");

const providerLookupCalls = [];
const emailLookupCalls = [];
const userLookupCalls = [];
const createdUsers = [];
const updatedUsers = [];
let providerUIDUser;
let emailUser;
let currentUser;
let createdUserUID = "new-uid";

const fakeAuth = {
    async getUser(uid) {
        userLookupCalls.push(uid);
        if (!currentUser) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return currentUser;
    },
    async getUserByProviderUid(providerId, uid) {
        providerLookupCalls.push({ providerId, uid });
        if (!providerUIDUser) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return providerUIDUser;
    },
    async getUserByEmail(email) {
        emailLookupCalls.push(email);
        if (!emailUser) {
            throw firebaseAuthError("auth/user-not-found");
        }
        return emailUser;
    },
    async createUser(properties) {
        createdUsers.push(properties);
        return { uid: createdUserUID };
    },
    async updateUser(uid, properties) {
        updatedUsers.push({ uid, properties });
        return { uid };
    }
};

require.cache[require.resolve("firebase-admin")] = {
    exports: {
        auth: () => fakeAuth
    }
};

const {
    linkGoogleProvider,
    resolveGoogleFirebaseUID
} = require("../lib/rest/googleProvider");

(async () => {
    await assertExistingProviderKeepsUIDAfterEmailChange();
    await assertUnlinkedProviderConnectsByVerifiedEmail();
    await assertUnlinkedProviderCreatesUser();
    await assertUnverifiedEmailIsRejected();
    await assertNewProviderLinkIsReported();
    await assertExistingProviderLinkIsReported();
    await assertLinkRejectsMismatchedEmail();
    await assertLinkRejectsProviderOwnedByAnotherUser();
    await assertProviderConflictTakesPriorityOverEmailMismatch();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// 기존 Google provider는 이메일 변경과 관계없이 같은 Firebase uid를 유지하는지 검증합니다.
async function assertExistingProviderKeepsUIDAfterEmailChange() {
    resetState();
    providerUIDUser = userRecord("linked-uid", [
        googleProvider("old@example.com"),
        githubProvider()
    ]);
    emailUser = userRecord("other-uid");

    const uid = await resolveGoogleFirebaseUID(
        googlePayload({ email: "new@example.com" })
    );

    assert.strictEqual(uid, "linked-uid");
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "google.com",
        uid: "google-subject"
    }]);
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, [{
        uid: "linked-uid",
        properties: {
            displayName: "Google User",
            photoURL: "https://example.com/profile.png"
        }
    }]);
}

// 미연결 Google provider를 검증된 이메일의 기존 사용자에 연결하는지 검증합니다.
async function assertUnlinkedProviderConnectsByVerifiedEmail() {
    resetState();
    emailUser = userRecord("email-uid", [githubProvider()]);

    const uid = await resolveGoogleFirebaseUID(googlePayload());

    assert.strictEqual(uid, "email-uid");
    assert.deepStrictEqual(updatedUsers, [{
        uid: "email-uid",
        properties: {
            displayName: "Google User",
            photoURL: "https://example.com/profile.png",
            providerToLink: googleProvider("user@example.com")
        }
    }]);
}

// 검증된 이메일 계정이 없으면 Google provider가 연결된 새 사용자를 생성하는지 검증합니다.
async function assertUnlinkedProviderCreatesUser() {
    resetState();

    const uid = await resolveGoogleFirebaseUID(googlePayload());

    assert.strictEqual(uid, "new-uid");
    assert.deepStrictEqual(createdUsers, [{
        displayName: "Google User",
        email: "user@example.com",
        photoURL: "https://example.com/profile.png",
        providerToLink: googleProvider("user@example.com")
    }]);
}

// 미연결 provider의 이메일이 검증되지 않았으면 자동 연결을 거부하는지 검증합니다.
async function assertUnverifiedEmailIsRejected() {
    resetState();

    await assert.rejects(
        () => resolveGoogleFirebaseUID(
            googlePayload({ email_verified: false })
        ),
        (error) => error.details?.reason === "email_not_found"
    );
    assert.deepStrictEqual(emailLookupCalls, []);
    assert.deepStrictEqual(createdUsers, []);
}

// 이번 요청에서 Google provider를 새로 연결했는지 반환하는지 검증합니다.
async function assertNewProviderLinkIsReported() {
    resetState();
    currentUser = userRecord("current-uid", [], "user@example.com");

    const didLink = await linkGoogleProvider(
        "current-uid",
        googlePayload()
    );

    assert.strictEqual(didLink, true);
    assert.deepStrictEqual(updatedUsers, [{
        uid: "current-uid",
        properties: {
            providerToLink: googleProvider("user@example.com")
        }
    }]);
}

// 같은 사용자의 기존 Google provider 갱신을 신규 연결로 반환하지 않는지 검증합니다.
async function assertExistingProviderLinkIsReported() {
    resetState();
    currentUser = userRecord(
        "current-uid",
        [googleProvider("user@example.com")],
        "user@example.com"
    );
    providerUIDUser = currentUser;

    const didLink = await linkGoogleProvider(
        "current-uid",
        googlePayload()
    );

    assert.strictEqual(didLink, false);
    assert.deepStrictEqual(updatedUsers, [{
        uid: "current-uid",
        properties: {
            providerToLink: googleProvider("user@example.com")
        }
    }]);
}

// 현재 Firebase 사용자와 Google verified email이 다르면 계정 연결을 거부하는지 검증합니다.
async function assertLinkRejectsMismatchedEmail() {
    resetState();
    currentUser = userRecord("current-uid", [], "current@example.com");

    await assert.rejects(
        () => linkGoogleProvider("current-uid", googlePayload()),
        (error) => error.details?.reason === "email_mismatch"
    );
    assert.deepStrictEqual(providerLookupCalls, [{
        providerId: "google.com",
        uid: "google-subject"
    }]);
    assert.deepStrictEqual(updatedUsers, []);
}

// 다른 Firebase uid가 소유한 Google provider 연결을 거부하는지 검증합니다.
async function assertLinkRejectsProviderOwnedByAnotherUser() {
    resetState();
    currentUser = userRecord("current-uid", [], "user@example.com");
    providerUIDUser = userRecord("other-uid", [googleProvider("user@example.com")]);

    await assert.rejects(
        () => linkGoogleProvider("current-uid", googlePayload()),
        (error) => error.details?.reason === "google_provider_link_conflict"
    );
    assert.deepStrictEqual(updatedUsers, []);
}

// provider 소유자와 이메일이 모두 다르면 provider 충돌을 우선 반환하는지 검증합니다.
async function assertProviderConflictTakesPriorityOverEmailMismatch() {
    resetState();
    currentUser = userRecord("current-uid", [], "current@example.com");
    providerUIDUser = userRecord("other-uid", [googleProvider("user@example.com")]);

    await assert.rejects(
        () => linkGoogleProvider("current-uid", googlePayload()),
        (error) => error.details?.reason === "google_provider_link_conflict"
    );
    assert.deepStrictEqual(updatedUsers, []);
}

// Google provider 기능 테스트의 공유 상태를 초기화합니다.
function resetState() {
    providerLookupCalls.length = 0;
    emailLookupCalls.length = 0;
    userLookupCalls.length = 0;
    createdUsers.length = 0;
    updatedUsers.length = 0;
    providerUIDUser = undefined;
    emailUser = undefined;
    currentUser = undefined;
    createdUserUID = "new-uid";
}

// Firebase Auth 사용자 대역을 구성합니다.
function userRecord(uid, providerData = [], email) {
    return { uid, providerData, email };
}

// Google ID token의 검증된 claim 대역을 구성합니다.
function googlePayload(overrides = {}) {
    return {
        iss: "https://accounts.google.com",
        sub: "google-subject",
        aud: "client-id",
        iat: 1,
        exp: 9_999_999_999,
        email: "user@example.com",
        email_verified: true,
        name: "Google User",
        picture: "https://example.com/profile.png",
        ...overrides
    };
}

// Firebase Auth Google provider payload 대역을 구성합니다.
function googleProvider(email) {
    return {
        providerId: "google.com",
        uid: "google-subject",
        displayName: "Google User",
        email,
        photoURL: "https://example.com/profile.png"
    };
}

// 기존 사용자의 다른 로그인 수단을 구성합니다.
function githubProvider() {
    return {
        providerId: "github.com",
        uid: "github-user"
    };
}

// Firebase Auth 오류 코드 형태의 예외를 구성합니다.
function firebaseAuthError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}
