# Provider Subject Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google, GitHub, Apple 계정 연결에서 기존 provider와 다른 subject로 교체되는 요청을 Firebase Auth 변경 전에 거부함.

**Architecture:** 각 공급자의 기존 계정 연결 함수에서 현재 사용자의 provider uid와 새 인증 subject를 비교함. 공급자별 기존 충돌 오류를 재사용하고 공통 helper나 실패 후 복원 처리는 추가하지 않음.

**Tech Stack:** TypeScript, Firebase Admin Auth, Firebase Functions, Node.js 기능 시험

## Global Constraints

- 같은 provider가 없으면 기존 연결 처리 유지
- 같은 provider와 같은 subject이면 기존 재인증 처리 유지
- 같은 provider와 다른 subject이면 Firebase Auth 변경과 credential 저장 전에 충돌 오류 반환
- Firestore 문서 구조, 환경 변수, Secret, 인덱스 변경 없음
- Google, GitHub, Apple 변경을 각각 독립 커밋으로 구성

---

### Task 1: Google subject 교체 거부

**Files:**
- Modify: `functions/src/rest/google/googleProvider.ts:20-54`
- Test: `functions/test/google-provider.test.js:56-255`

**Interfaces:**
- Consumes: `linkGoogleProvider(uid: string, payload: GoogleTokenPayload): Promise<boolean>`
- Produces: 다른 기존 Google subject를 `google_provider_link_conflict`로 거부하는 같은 함수 계약

- [ ] **Step 1: 다른 subject 교체 거부 기능 시험 작성**

`assertExistingDifferentProviderLinkIsReported`를 다음 동작을 검증하는 `assertExistingDifferentProviderLinkIsRejected`로 변경함.

```js
await assertExistingDifferentProviderLinkIsRejected();

async function assertExistingDifferentProviderLinkIsRejected() {
    resetState();
    currentUser = userRecord(
        "current-uid",
        [{
            ...googleProvider("user@example.com"),
            uid: "previous-google-subject"
        }],
        "user@example.com"
    );

    await assert.rejects(
        () => linkGoogleProvider(
            "current-uid",
            googlePayload()
        ),
        (error) => error.details?.reason === "google_provider_link_conflict"
    );

    assert.deepStrictEqual(providerLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
}
```

- [ ] **Step 2: Google 기능 시험 실패 확인**

Run:

```sh
cd functions
npm run build
node test/google-provider.test.js
```

Expected: 다른 subject 요청이 성공하므로 `assert.rejects` 실패

- [ ] **Step 3: 기존 Google provider subject 비교 구현**

현재 사용자 조회 직후 provider를 찾고 다른 uid이면 기존 충돌 오류를 반환함.

```ts
const currentProvider = currentUser.providerData.find((provider) =>
    provider.providerId === PROVIDER_ID
);
if (currentProvider && currentProvider.uid !== payload.sub) {
    throw googleProviderLinkConflictError();
}
let didLink = !currentProvider;
```

- [ ] **Step 4: Google 대상 시험 통과 확인**

Run:

```sh
cd functions
npm run build
node test/google-provider.test.js
node test/google-auth.test.js
```

Expected: 모든 명령 성공

- [ ] **Step 5: Google 변경 커밋**

```sh
git add functions/src/rest/google/googleProvider.ts functions/test/google-provider.test.js
git commit -m "fix: Google provider subject 교체 거부"
```

### Task 2: GitHub subject 교체 거부

**Files:**
- Modify: `functions/src/rest/github/githubProvider.ts:27-165`
- Test: `functions/test/github-auth.test.js:166-555`

**Interfaces:**
- Consumes: `linkGithubProviderWithAccessToken(uid: string, accessToken: string): Promise<void>`
- Produces: 다른 기존 GitHub subject를 `github_email_changed_account_conflict`로 거부하는 같은 함수 계약

- [ ] **Step 1: 다른 GitHub uid 교체 거부 기능 시험 작성**

현재 사용자에게 `uid: "previous-github-uid"` provider를 넣고 새 `providerUID: "1"` 요청이 거부되는지 검증함.

```js
await assertGithubLinkRejectsDifferentCurrentProvider();

async function assertGithubLinkRejectsDifferentCurrentProvider() {
    resetGithubLoginState();
    currentUser = userRecord(
        "current-uid",
        [{
            ...githubProviderData("user@example.com"),
            uid: "previous-github-uid"
        }],
        "user@example.com"
    );

    await assert.rejects(
        () => linkGithubProviderWithAccessToken(
            "current-uid",
            "access-token"
        ),
        (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "github_email_changed_account_conflict"
    );

    assert.deepStrictEqual(providerLookupCalls, []);
    assert.deepStrictEqual(updatedUsers, []);
}
```

- [ ] **Step 2: GitHub 기능 시험 실패 확인**

Run:

```sh
cd functions
npm run build
node test/github-auth.test.js
```

Expected: 다른 GitHub uid 요청이 성공하므로 `assert.rejects` 실패

- [ ] **Step 3: 이메일 확인에 사용한 현재 사용자로 subject 비교 구현**

현재 사용자 조회 결과를 반환하도록 이메일 검사 함수를 변경함.

```ts
import type {
    UpdateRequest,
    UserProvider,
    UserRecord
} from "firebase-admin/auth";

async function githubUserWithMatchingEmail(
    uid: string,
    email: string
): Promise<UserRecord> {
    const user = await admin.auth().getUser(uid);
    if (user.email !== email) {
        throw new HttpsError(
            "invalid-argument",
            "이메일이 일치하지 않습니다.",
            { reason: EMAIL_MISMATCH_REASON }
        );
    }
    return user;
}
```

`linkGithubProviderWithAccessToken`에서 현재 provider를 확인한 뒤 기존 연결 함수를 호출함.

```ts
const user = await githubUserWithMatchingEmail(uid, email);
const currentProvider = user.providerData.find((provider) =>
    provider.providerId === PROVIDER_ID
);
if (currentProvider && currentProvider.uid !== providerUID) {
    throw githubProviderLinkConflictError();
}
await linkGitHubProvider(
    uid,
    providerUID,
    providerToLink
);
```

- [ ] **Step 4: GitHub 대상 시험 통과 확인**

Run:

```sh
cd functions
npm run build
node test/github-auth.test.js
node test/github-oauth.test.js
```

Expected: 모든 명령 성공

- [ ] **Step 5: GitHub 변경 커밋**

```sh
git add functions/src/rest/github/githubProvider.ts functions/test/github-auth.test.js
git commit -m "fix: GitHub provider subject 교체 거부"
```

### Task 3: Apple subject 교체 거부

**Files:**
- Modify: `functions/src/rest/apple/FirebaseAuthUser.ts:1-16`
- Modify: `functions/src/rest/apple/provider.ts:20-92`
- Test: `functions/test/apple-auth.test.js:882-1023`

**Interfaces:**
- Consumes: `linkAppleProviderWithDatabase(db, uid, challengeId, authorizationCode, credentialEmail?): Promise<{ success: true }>`
- Produces: 다른 기존 Apple subject를 `apple_provider_link_conflict`로 거부하는 같은 함수 계약

- [ ] **Step 1: 다른 Apple subject 교체 거부 기능 시험 작성**

현재 사용자에게 다른 Apple subject를 넣고 새 인증 subject 요청이 거부되는지 검증함.

```js
await assertLinkRejectsDifferentCurrentProvider();

async function assertLinkRejectsDifferentCurrentProvider() {
    resetState();
    users.set("current-uid", firebaseUser(
        "current-uid",
        "user@example.com",
        [{
            ...appleProvider(),
            uid: "previous-apple-subject"
        }]
    ));
    const db = validChallengeFirestore("different-current-provider");

    await assertAppleReason(
        () => linkAppleProviderWithDatabase(
            db,
            "current-uid",
            "different-current-provider",
            "authorization-code"
        ),
        "apple_provider_link_conflict"
    );

    assert.strictEqual(authUpdates.length, 0);
    assert.strictEqual(
        db.data.has("authCredentials/current-uid/providers/apple"),
        false
    );
}
```

- [ ] **Step 2: Apple 기능 시험 실패 확인**

Run:

```sh
cd functions
npm run build
node test/apple-auth.test.js
```

Expected: 다른 Apple subject 요청이 성공하므로 `assertAppleReason` 실패

- [ ] **Step 3: Apple 사용자 provider uid 타입과 subject 비교 구현**

`FirebaseAuthUser.providerData` 요소에 실제 Firebase Auth 응답이 제공하는 uid를 추가함.

```ts
providerData?: Array<{
    // 연결된 provider id를 저장합니다.
    providerId: string;
    // 연결된 provider 사용자 uid를 저장합니다.
    uid: string;
}>;
```

이메일 일치 확인 뒤 기존 Apple provider의 uid가 다르면 교환 token을 폐기하고 기존 충돌 오류를 반환함.

```ts
const currentProvider = user.providerData?.find((provider) =>
    provider.providerId === APPLE_PROVIDER_ID
);
if (currentProvider && currentProvider.uid !== proof.payload.sub) {
    await revokeExchangedTokens(proof.tokens);
    throw appleAuthError(
        "failed-precondition",
        "apple_provider_link_conflict",
        "Apple provider가 다른 계정에 연결되어 있습니다."
    );
}
```

- [ ] **Step 4: Apple 대상 시험 통과 확인**

Run:

```sh
cd functions
npm run build
node test/apple-auth.test.js
```

Expected: 모든 명령 성공

- [ ] **Step 5: Apple 변경 커밋**

```sh
git add functions/src/rest/apple/FirebaseAuthUser.ts functions/src/rest/apple/provider.ts functions/test/apple-auth.test.js
git commit -m "fix: Apple provider subject 교체 거부"
```

### Task 4: 전체 검증

**Files:**
- Verify: `functions/src/rest/google/googleProvider.ts`
- Verify: `functions/src/rest/github/githubProvider.ts`
- Verify: `functions/src/rest/apple/FirebaseAuthUser.ts`
- Verify: `functions/src/rest/apple/provider.ts`
- Verify: `functions/test/google-provider.test.js`
- Verify: `functions/test/github-auth.test.js`
- Verify: `functions/test/apple-auth.test.js`

**Interfaces:**
- Consumes: Task 1부터 Task 3까지의 공급자별 계정 연결 계약
- Produces: 전체 Functions build와 test 통과 증거

- [ ] **Step 1: 전체 Functions 검증**

Run:

```sh
cd functions
npm run build
npm test
```

Expected: 모든 명령 성공

- [ ] **Step 2: 최종 diff와 작업 트리 확인**

Run:

```sh
git diff --check
git status --short --branch
git log -5 --oneline
```

Expected: 작업 트리 변경 없음, Google·GitHub·Apple 구현 커밋이 각각 분리됨
