const assert = require("assert");

let decodedPayload;
const fakeJWT = {
    verify(idToken, getKey, options, callback) {
        assert.strictEqual(idToken, "apple-id-token");
        assert.deepStrictEqual(options, {
            algorithms: ["RS256"],
            audience: "apple-client-id",
            issuer: "https://appleid.apple.com"
        });
        getKey({ kid: "apple-key-id" }, (error, publicKey) => {
            assert.ifError(error);
            assert.strictEqual(publicKey, "apple-public-key");
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
            assert.strictEqual(kid, "apple-key-id");
            return {
                getPublicKey: () => "apple-public-key"
            };
        }
    })
};

const { verifyAppleIdToken } = require("../lib/auth/appleIdToken");

(async () => {
    await assertExpectedNonceIsAccepted();
    await assertMismatchedNonceIsRejected();
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

// Apple ID token nonce가 저장된 hash와 일치할 때 payload를 반환하는지 검증합니다.
async function assertExpectedNonceIsAccepted() {
    decodedPayload = applePayload("expected-hashed-nonce");

    const payload = await verifyAppleIdToken(
        "apple-id-token",
        "apple-client-id",
        "expected-hashed-nonce"
    );

    assert.strictEqual(payload.sub, "apple-subject");
    assert.strictEqual(payload.nonce, "expected-hashed-nonce");
}

// Apple ID token nonce가 저장된 hash와 다르면 검증을 거부하는지 검증합니다.
async function assertMismatchedNonceIsRejected() {
    decodedPayload = applePayload("different-hashed-nonce");

    await assert.rejects(
        () => verifyAppleIdToken(
            "apple-id-token",
            "apple-client-id",
            "expected-hashed-nonce"
        ),
        /Invalid Apple ID token payload/
    );
}

// Apple ID token claim 테스트 자료를 구성합니다.
function applePayload(nonce) {
    return {
        iss: "https://appleid.apple.com",
        sub: "apple-subject",
        aud: "apple-client-id",
        iat: 1,
        exp: 9_999_999_999,
        nonce
    };
}
