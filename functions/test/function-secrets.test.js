const assert = require("assert");

process.env.GCLOUD_PROJECT = "devlog-test";

const {
    prodApi,
    stagingApi
} = require("../lib/rest/api");
const {
    cleanupExpiredOAuthSessions,
    cleanupExpiredOAuthTickets
} = require("../lib/rest/oauth/cleanup");
const {
    cleanupDeletedUserFirestoreData
} = require("../lib/user/delete");

const apiSecretKeys = [
    "GITHUB_OAUTH_CONFIG",
    "GOOGLE_OAUTH_CONFIG"
];
const githubSecretKeys = ["GITHUB_OAUTH_CONFIG"];

assert.deepStrictEqual(secretKeys(stagingApi), apiSecretKeys);
assert.deepStrictEqual(secretKeys(prodApi), apiSecretKeys);
assert.deepStrictEqual(
    secretKeys(cleanupExpiredOAuthSessions("staging")),
    githubSecretKeys
);
assert.deepStrictEqual(
    secretKeys(cleanupExpiredOAuthTickets("staging")),
    githubSecretKeys
);
assert.deepStrictEqual(
    secretKeys(cleanupDeletedUserFirestoreData),
    githubSecretKeys
);

// 배포 함수에 연결된 Secret 이름을 정렬해 반환합니다.
function secretKeys(cloudFunction) {
    return (cloudFunction.__endpoint.secretEnvironmentVariables ?? [])
        .map(({ key }) => key)
        .sort();
}
