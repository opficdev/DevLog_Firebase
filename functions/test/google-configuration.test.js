const assert = require("assert");
const { googleConfiguration } = require("../lib/rest/googleConfiguration");

const originalEnvironment = { ...process.env };
try {
    process.env.GOOGLE_STAGING_CLIENT_ID = "staging-client-id";
    process.env.GOOGLE_STAGING_CLIENT_SECRET = "staging-client-secret";
    process.env.GOOGLE_STAGING_CALLBACK_URL = "https://example.com/staging/callback";
    process.env.GOOGLE_PROD_CLIENT_ID = "prod-client-id";
    process.env.GOOGLE_PROD_CLIENT_SECRET = "prod-client-secret";
    process.env.GOOGLE_PROD_CALLBACK_URL = "https://example.com/prod/callback";

    assert.deepStrictEqual(googleConfiguration("staging"), {
        clientId: "staging-client-id",
        clientSecret: "staging-client-secret",
        callbackURL: "https://example.com/staging/callback"
    });
    assert.deepStrictEqual(googleConfiguration("prod"), {
        clientId: "prod-client-id",
        clientSecret: "prod-client-secret",
        callbackURL: "https://example.com/prod/callback"
    });
    delete process.env.GOOGLE_STAGING_CLIENT_ID;
    assertRejectedConfiguration();
} finally {
    process.env = originalEnvironment;
}

// 환경별 Google OAuth client 설정이 없을 때 다른 환경 값으로 대체하지 않는지 검증합니다.
function assertRejectedConfiguration() {
    assert.throws(
        () => googleConfiguration("staging"),
        /Google staging OAuth client 설정이 누락되었습니다/
    );
}
