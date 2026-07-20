const assert = require("assert");
const {
    githubConfiguration,
    githubRevocationConfiguration
} = require("../lib/rest/githubConfiguration");

const secretName = "GITHUB_OAUTH_CONFIG";
const configuration = {
    clientId: "client-id",
    clientSecret: "client-secret",
    callbackURL: "https://example.com/callback"
};
const originalEnvironment = { ...process.env };
try {
    process.env[secretName] = JSON.stringify(configuration);

    assert.deepStrictEqual(githubConfiguration(), configuration);
    assert.strictEqual(
        githubRevocationConfiguration("client-id").clientSecret,
        "client-secret"
    );
    assert.throws(
        () => githubRevocationConfiguration("unknown-client-id"),
        /GitHub credential을 발급한 OAuth App 설정을 찾을 수 없습니다/
    );

    assertRejectedConfiguration(undefined, /No value found for secret parameter/);
    assertRejectedConfiguration("{", /could not be parsed as JSON/);
    assertRejectedConfiguration(JSON.stringify([]), /GitHub OAuth App 설정 형식/);
    assertRejectedConfiguration(JSON.stringify({
        clientId: "client-id",
        clientSecret: "client-secret"
    }), /callbackURL/);
    assertRejectedConfiguration(JSON.stringify({
        ...configuration,
        clientId: " "
    }), /clientId/);
    assertRejectedConfiguration(JSON.stringify({
        ...configuration,
        clientSecret: 1
    }), /clientSecret/);
} finally {
    process.env = originalEnvironment;
}

// 잘못된 JSON Secret 값이 GitHub OAuth App 설정으로 허용되지 않는지 검증합니다.
function assertRejectedConfiguration(
    value,
    expectedMessage
) {
    if (value === undefined) {
        delete process.env[secretName];
    } else {
        process.env[secretName] = value;
    }
    assert.throws(
        () => githubConfiguration(),
        expectedMessage
    );
}
