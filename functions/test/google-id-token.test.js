const assert = require("assert");

let decodedPayload;
const fakeJWT = {
    verify(idToken, getKey, options, callback) {
        assert.strictEqual(idToken, "google-id-token");
        assert.deepStrictEqual(options, {
            algorithms: ["RS256"],
            audience: "google-client-id",
            issuer: ["https://accounts.google.com", "accounts.google.com"]
        });
        getKey({ kid: "google-key-id" }, (error, publicKey) => {
            assert.ifError(error);
            assert.strictEqual(publicKey, "google-public-key");
            callback(null, decodedPayload);
        });
    }
};

require.cache[require.resolve("jsonwebtoken")] = {
    exports: fakeJWT
};
require.cache[require.resolve("jwks-rsa")] = {
    exports: () => ({
        async getSigningKey(kid) {
            assert.strictEqual(kid, "google-key-id");
            return {
                getPublicKey: () => "google-public-key"
            };
        }
    })
};

const { verifyGoogleIdToken } = require("../lib/auth/googleIdToken");

(async () => {
    await assertVerifiedPayloadIsAccepted();
    await assertMissingSubjectIsRejected();
    await assertUnknownIssuerIsRejected();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// Google 서명과 필수 claim을 검증한 payload를 반환하는지 검증합니다.
async function assertVerifiedPayloadIsAccepted() {
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
    decodedPayload = googlePayload();
    delete decodedPayload.sub;

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        /Invalid Google ID token payload/
    );
}

// 허용되지 않은 issuer의 ID token을 거부하는지 검증합니다.
async function assertUnknownIssuerIsRejected() {
    decodedPayload = googlePayload();
    decodedPayload.iss = "https://example.com";

    await assert.rejects(
        () => verifyGoogleIdToken("google-id-token", "google-client-id"),
        /Invalid Google ID token payload/
    );
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
