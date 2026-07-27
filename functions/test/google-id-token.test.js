const assert = require("assert");

let decodedPayload;
let signingKeyError;

// JWKS에 일치하는 signing key가 없음을 나타내는 시험 오류를 구성합니다.
class SigningKeyNotFoundError extends Error {}

const fakeJWT = {
    verify(idToken, getKey, options, callback) {
        assert.strictEqual(idToken, "google-id-token");
        assert.deepStrictEqual(options, {
            algorithms: ["RS256"],
            audience: "google-client-id",
            issuer: ["https://accounts.google.com", "accounts.google.com"]
        });
        getKey({ kid: "google-key-id" }, (error, publicKey) => {
            if (error) {
                callback(new Error(`public key callback failed: ${error.message}`));
                return;
            }
            assert.strictEqual(publicKey, "google-public-key");
            callback(null, decodedPayload);
        });
    }
};

require.cache[require.resolve("jsonwebtoken")] = {
    exports: fakeJWT
};
const fakeJwksClient = () => ({
    async getSigningKey(kid) {
        assert.strictEqual(kid, "google-key-id");
        if (signingKeyError) {
            throw signingKeyError;
        }
        return {
            getPublicKey: () => "google-public-key"
        };
    }
});
fakeJwksClient.SigningKeyNotFoundError = SigningKeyNotFoundError;
require.cache[require.resolve("jwks-rsa")] = {
    exports: fakeJwksClient
};

const {
    GoogleJwksLookupError,
    verifyGoogleIdToken
} = require("../lib/auth/googleIdToken");

(async () => {
    await assertVerifiedPayloadIsAccepted();
    await assertMissingSubjectIsRejected();
    await assertUnknownIssuerIsRejected();
    await assertJwksLookupFailureIsDistinguished();
    await assertMissingSigningKeyIsRejectedAsInvalidProof();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// Google 서명과 필수 claim을 검증한 payload를 반환하는지 검증합니다.
async function assertVerifiedPayloadIsAccepted() {
    resetState();
    decodedPayload = googlePayload();

    const payload = await verifyGoogleIdToken(
        "google-id-token",
        "google-client-id"
    );

    assert.strictEqual(payload.sub, "google-subject");
    assert.strictEqual(payload.email, "user@example.com");
    assert.strictEqual(payload.email_verified, true);
}

// 변경되지 않는 사용자 식별자인 sub가 없으면 검증을 거부하는지 검증합니다.
async function assertMissingSubjectIsRejected() {
    resetState();
    decodedPayload = googlePayload();
    delete decodedPayload.sub;

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        /Invalid Google ID token payload/
    );
}

// 허용되지 않은 issuer의 ID token을 거부하는지 검증합니다.
async function assertUnknownIssuerIsRejected() {
    resetState();
    decodedPayload = googlePayload();
    decodedPayload.iss = "https://example.com";

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        /Invalid Google ID token payload/
    );
}

// Google JWKS 조회 실패를 token 검증 실패와 구분하는지 검증합니다.
async function assertJwksLookupFailureIsDistinguished() {
    resetState();
    signingKeyError = new Error("jwks unavailable");

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        (error) => error instanceof GoogleJwksLookupError
    );
}

// 일치하는 Google signing key가 없으면 token 검증 실패로 유지하는지 검증합니다.
async function assertMissingSigningKeyIsRejectedAsInvalidProof() {
    resetState();
    signingKeyError = new SigningKeyNotFoundError("signing key not found");

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        (error) => !(error instanceof GoogleJwksLookupError)
    );
}

// Google ID token 시험 상태를 초기화합니다.
function resetState() {
    decodedPayload = undefined;
    signingKeyError = undefined;
}

// Google ID token 테스트 payload를 구성합니다.
function googlePayload() {
    return {
        iss: "https://accounts.google.com",
        sub: "google-subject",
        aud: "google-client-id",
        iat: 1,
        exp: 9_999_999_999,
        email: "user@example.com",
        email_verified: true,
        name: "Google User",
        picture: "https://example.com/profile.png"
    };
}
