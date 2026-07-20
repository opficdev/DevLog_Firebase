const assert = require("assert");
const { appleConfiguration } = require("../lib/rest/apple/appleClient");

const secretName = "APPLE_AUTH_CONFIG";
const configuration = {
    teamId: "team-id",
    clientId: "client-id",
    keyId: "key-id",
    privateKey: "private\\nkey"
};
const originalEnvironment = { ...process.env };
try {
    process.env[secretName] = JSON.stringify(configuration);

    assert.deepStrictEqual(appleConfiguration(), {
        ...configuration,
        privateKey: "private\nkey"
    });

    assertRejectedConfiguration(undefined, /No value found for secret parameter/);
    assertRejectedConfiguration("{", /could not be parsed as JSON/);
    assertRejectedConfiguration(JSON.stringify([]), /Apple 인증 설정 형식/);
    assertRejectedConfiguration(JSON.stringify({
        teamId: "team-id",
        clientId: "client-id",
        keyId: "key-id"
    }), /privateKey/);
    assertRejectedConfiguration(JSON.stringify({
        ...configuration,
        teamId: " "
    }), /teamId/);
    assertRejectedConfiguration(JSON.stringify({
        ...configuration,
        privateKey: 1
    }), /privateKey/);
} finally {
    process.env = originalEnvironment;
}

// 잘못된 JSON Secret 값이 Apple 인증 설정으로 허용되지 않는지 검증합니다.
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
        () => appleConfiguration(),
        expectedMessage
    );
}
