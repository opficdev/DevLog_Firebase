const assert = require("assert");
const {
    githubConfiguration,
    githubRevocationConfiguration
} = require("../lib/rest/githubConfiguration");

const originalEnvironment = { ...process.env };
try {
    process.env.GITHUB_STAGING_CLIENT_ID = "staging-client-id";
    process.env.GITHUB_STAGING_CLIENT_SECRET = "staging-client-secret";
    process.env.GITHUB_STAGING_CALLBACK_URL = "https://example.com/staging/callback";
    process.env.GITHUB_PROD_CLIENT_ID = "prod-client-id";
    process.env.GITHUB_PROD_CLIENT_SECRET = "prod-client-secret";
    process.env.GITHUB_PROD_CALLBACK_URL = "https://example.com/prod/callback";

    assert.deepStrictEqual(githubConfiguration("staging"), {
        clientId: "staging-client-id",
        clientSecret: "staging-client-secret",
        callbackURL: "https://example.com/staging/callback"
    });
    assert.deepStrictEqual(githubConfiguration("prod"), {
        clientId: "prod-client-id",
        clientSecret: "prod-client-secret",
        callbackURL: "https://example.com/prod/callback"
    });
    assert.strictEqual(
        githubRevocationConfiguration("staging", "staging-client-id").clientSecret,
        "staging-client-secret"
    );
    assert.throws(
        () => githubRevocationConfiguration("staging", "unknown-client-id"),
        /GitHub credential을 발급한 OAuth App 설정을 찾을 수 없습니다/
    );

    delete process.env.GITHUB_STAGING_CLIENT_ID;
    awaitRejectedConfiguration();
} finally {
    process.env = originalEnvironment;
}

// 환경별 OAuth App 설정이 없을 때 기존 공통 값으로 대체하지 않는지 검증합니다.
function awaitRejectedConfiguration() {
    assert.throws(
        () => githubConfiguration("staging"),
        /GitHub staging OAuth App 설정이 누락되었습니다/
    );
}
