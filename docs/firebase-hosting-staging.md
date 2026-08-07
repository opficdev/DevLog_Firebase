# Staging Firebase Hosting API 라우팅

## 범위

- Firebase project와 Hosting site: `devlog-staging`
- Cloud Run 서비스: `http-api`
- region: `asia-northeast3`
- Todo 경로: `/api/todos/**`
- WebPage 경로: `/api/web-pages/**`
- PushNotification 경로: `/api/push-notifications/**`
- Google 인증 경로: `/api/auth/google/**`
- Apple 인증 경로: `/api/auth/apple/**`
- GitHub 인증 경로: `/api/auth/github/**`
- 제외: `devlog-auth-prod`, Functions 배포, Firestore rules와 index, Cloud Run 배포와 revision 변경

이 문서는 Staging Hosting 단독 배포와 검증 및 복구 절차를 기록합니다.

## 선행 조건

Cloud Run 서비스가 준비된 상태인지 확인합니다.

```bash
gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='table(status.url,status.latestReadyRevisionName,status.traffic)'
```

`status.latestReadyRevisionName`의 revision이 `Ready`이고 `status.traffic`에서 100%를 받는 상태여야 합니다.

[Cloud Run Staging 수동 배포 절차](./cloud-run-staging.md)의 직접 호출 검증에서 다음 결과가 모두 확인되어야 합니다.

1. body가 빈 Google custom token `POST`: `400`, `invalid-argument`
2. 잘못된 `serverAuthCode`를 전달한 Google custom token `POST`: `401`, `invalid-google-proof`
3. Apple challenge `POST`: `200`, `challengeId`, `hashedNonce`, `expiresAt` 필드가 존재
4. Apple custom token `POST`에 `challengeId`, `idToken`가 없는 경우: `400`, `invalid-argument`
5. Token이 없는 Apple account-link `PUT`/`DELETE`, access-token `POST`/`DELETE`, refresh-token `POST`: 각각 `401`
6. Token이 없는 Google account-link와 access-token `DELETE`: 각각 `401`
7. body가 빈 GitHub 로그인 session `POST`: `400`, `invalid-argument`
8. query가 빈 GitHub callback `GET`: `302`, `devlog://oauth-callback?error=oauth-failed`
9. body가 빈 GitHub custom token `POST`: `400`, `invalid-argument`
10. Token이 없는 GitHub 계정 연결 session `POST`: `401`, `unauthenticated`
11. Token이 없는 GitHub account-link `PUT`: `401`, `unauthenticated`
12. Token이 없는 GitHub account-link `DELETE`: `401`, `unauthenticated`
13. Token이 없는 GitHub access-token `DELETE`: `401`, `unauthenticated`
14. Token이 없는 Todo `POST`: `401`
15. Token이 있는 Todo `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
16. Token이 있는 WebPage `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
17. Token이 있는 PushNotification `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
18. 각 `DELETE` 뒤 Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태 복구

하나라도 확인되지 않으면 Hosting 라우팅을 배포하지 않습니다.

## 설정 확인

라우팅 계약 시험과 Functions 전체 시험을 실행합니다.

```bash
cd functions
npm run build
npm test
cd ..
```

`firebase.json`의 `devlog-staging` rewrite가 다음 순서인지 확인합니다.

1. `/api/todos/**` → Cloud Run `http-api`
2. `/api/web-pages/**` → Cloud Run `http-api`
3. `/api/push-notifications/**` → Cloud Run `http-api`
4. `/api/auth/google/**` → Cloud Run `http-api`
5. `/api/auth/apple/**` → Cloud Run `http-api`
6. `/api/auth/github/**` → Cloud Run `http-api`
7. `/api/**` → Functions `api`

Cloud Run rewrite에는 `pinTag`가 없어야 합니다. `devlog-auth-prod` 블록은 변경하지 않습니다.

```bash
git diff -- firebase.json
```

## Staging Hosting 배포

현재 로그인 상태와 대상 project를 확인합니다. 명령 출력에 계정 정보가 포함될 수 있으므로 저장소에 기록하지 않습니다.

```bash
firebase login:list
firebase projects:list
```

`devlog-staging` Hosting만 배포합니다.

```bash
firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging \
	--non-interactive
```

Functions, Firestore rules, index, Cloud Run은 이 명령의 배포 대상이 아닙니다.

## 배포 후 요청 검증

Staging 검증용 Todo, WebPage와 PushNotification 및 Firebase ID Token을 준비합니다. 각 문서는 삭제 요청 전 활성 상태여야 합니다. Header는 표준 입력으로 전달해 Token이 process 목록에 남지 않게 합니다.

```bash
read -r -p "Staging Todo ID: " TODO_ID
read -r -p "Staging WebPage ID: " WEB_PAGE_ID
read -r -p "Staging PushNotification ID: " PUSH_NOTIFICATION_ID
read -r -s -p "Firebase ID Token: " FIREBASE_ID_TOKEN
printf '\n'

HOSTING_URL="https://devlog-staging.web.app"

curl -i -X POST \
	"${HOSTING_URL}/api/todos/${TODO_ID}/deletion-request"

curl -i -X POST \
	-H @- \
	"${HOSTING_URL}/api/todos/${TODO_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${HOSTING_URL}/api/todos/${TODO_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X POST \
	"${HOSTING_URL}/api/web-pages/route-check/deletion-request"

curl -i -X POST \
	-H @- \
	"${HOSTING_URL}/api/web-pages/${WEB_PAGE_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${HOSTING_URL}/api/web-pages/${WEB_PAGE_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X POST \
	"${HOSTING_URL}/api/push-notifications/route-check/deletion-request"

curl -i -X POST \
	-H @- \
	"${HOSTING_URL}/api/push-notifications/${PUSH_NOTIFICATION_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${HOSTING_URL}/api/push-notifications/${PUSH_NOTIFICATION_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X POST \
	"${HOSTING_URL}/api/auth/apple/challenges"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	"${HOSTING_URL}/api/auth/apple/custom-token"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	"${HOSTING_URL}/api/auth/google/authorization-code/custom-token"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{"serverAuthCode":"invalid-server-auth-code"}' \
	"${HOSTING_URL}/api/auth/google/authorization-code/custom-token"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/google/account-link"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/google/access-token"

curl -i -X PUT \
	"${HOSTING_URL}/api/auth/apple/account-link"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/apple/account-link"

curl -i -X POST \
	"${HOSTING_URL}/api/auth/apple/access-token"

curl -i -X POST \
	"${HOSTING_URL}/api/auth/apple/refresh-token"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/apple/access-token"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	"${HOSTING_URL}/api/auth/github/sign-in-sessions"

curl -i \
	"${HOSTING_URL}/api/auth/github/callback"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{}' \
	"${HOSTING_URL}/api/auth/github/custom-token"

curl -i -X POST \
	-H 'Content-Type: application/json' \
	-d '{"appChallenge":"route-check"}' \
	"${HOSTING_URL}/api/auth/github/account-link-sessions"

curl -i -X PUT \
	"${HOSTING_URL}/api/auth/github/account-link"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/github/account-link"

curl -i -X DELETE \
	"${HOSTING_URL}/api/auth/github/access-token"

unset FIREBASE_ID_TOKEN TODO_ID WEB_PAGE_ID PUSH_NOTIFICATION_ID HOSTING_URL
```

응답을 다음 순서로 확인합니다.

1. Token이 없는 Todo `POST`: `401`
2. Token이 있는 Todo `POST`: `200`, `{"success":true}`
3. Token이 있는 Todo `DELETE`: `200`, `{"success":true}`
4. Token이 없는 WebPage `POST`: Cloud Run `http-api`의 `401`
5. Token이 있는 WebPage `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
6. Token이 없는 PushNotification `POST`: Cloud Run `http-api`의 `401`
7. Token이 있는 PushNotification `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
8. `/api/auth/apple/challenges` `POST`: Cloud Run `http-api`의 `200`, `challengeId`, `hashedNonce`, `expiresAt` 필드가 존재
9. `/api/auth/apple/custom-token` `POST`: Cloud Run `http-api`의 `400`, `invalid-argument`
10. body가 빈 Google custom token `POST`: Cloud Run `http-api`의 `400`, `invalid-argument`
11. 잘못된 `serverAuthCode`를 전달한 Google custom token `POST`: Cloud Run `http-api`의 `401`, `invalid-google-proof`
12. Token이 없는 Google account-link와 access-token `DELETE`: Cloud Run `http-api`의 `401`
13. Token이 없는 Apple account-link `PUT`/`DELETE`, access-token `POST`/`DELETE`, refresh-token `POST`: Cloud Run `http-api`의 `401`
14. body가 빈 GitHub 로그인 session `POST`: Cloud Run `http-api`의 `400`, `invalid-argument`
15. query가 빈 GitHub callback `GET`: Cloud Run `http-api`의 `302`, `devlog://oauth-callback?error=oauth-failed`
16. body가 빈 GitHub custom token `POST`: Cloud Run `http-api`의 `400`, `invalid-argument`
17. Token이 없는 GitHub 계정 연결 session `POST`: Cloud Run `http-api`의 `401`, `unauthenticated`
18. Token이 없는 GitHub account-link `PUT`: Cloud Run `http-api`의 `401`, `unauthenticated`
19. Token이 없는 GitHub account-link `DELETE`: Cloud Run `http-api`의 `401`, `unauthenticated`
20. Token이 없는 GitHub access-token `DELETE`: Cloud Run `http-api`의 `401`, `unauthenticated`
21. 각 `DELETE` 뒤 Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태 복구

유효한 일회용 인증 값이 필요한 Apple challenge, custom token, account-link, account-link 해제, access-token 갱신·폐기 및 refresh-token 성공 경로와 GitHub 로그인·계정 연결·연결 해제·grant 폐기 성공 경로는 Staging 앱에서 확인합니다. 성공 응답과 최신 `http-api` revision 로그를 함께 확인하며 Token과 인증 코드는 로그와 shell history에 남기지 않습니다.

Todo와 기존 API의 응답만으로 실행 주체를 구분하기 어려우므로 Cloud Run과 Functions 로그도 함께 확인합니다.

```bash
LATEST_REVISION="$(gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='value(status.latestReadyRevisionName)')"

gcloud logging read \
	"resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"http-api\" AND resource.labels.revision_name=\"${LATEST_REVISION}\"" \
	--project devlog-staging \
	--freshness=10m \
	--limit=50 \
	--format=json

firebase functions:log \
	--project devlog-staging \
	--only api \
	--lines 50

unset LATEST_REVISION
```

Todo, WebPage, PushNotification과 Google·Apple·GitHub 인증 요청은 최신 `http-api` revision에서 확인되어야 합니다. 알려지지 않은 나머지 `/api/**` 요청은 Functions `api`의 `404` 응답으로 확인되어야 합니다.

## GitHub 인증 라우팅 복구

Functions `api`가 GitHub account-link `PUT`/`DELETE`와 access-token `DELETE` route 제거가 포함된 소스로 배포되었는지 먼저 확인합니다. 배포 이력이 불분명하면 route가 제거된 상태로 판단합니다.

### 기존 Functions route가 배포된 기간

이 변경에서는 Functions를 배포하지 않으므로 GitHub 계정 관리 route 제거가 포함된 소스로 Functions `api`를 배포하기 전까지는 기존 route가 배포된 상태입니다. 이 기간에만 `firebase.json`의 `devlog-staging` 블록에서 `/api/auth/github/**` rewrite를 다음 네 개의 Cloud Run rewrite로 되돌릴 수 있습니다.

1. `/api/auth/github/sign-in-sessions` → Cloud Run `http-api`
2. `/api/auth/github/callback` → Cloud Run `http-api`
3. `/api/auth/github/custom-token` → Cloud Run `http-api`
4. `/api/auth/github/account-link-sessions` → Cloud Run `http-api`

이 설정에서는 GitHub account-link `PUT`/`DELETE`와 access-token `DELETE`가 `/api/**`를 통해 기존 Functions `api`로 전달됩니다. `devlog-auth-prod` 블록은 변경하지 않습니다.

복구 설정과 `functions/test/firebase-hosting.test.js`의 Staging 기대값을 함께 변경해 별도 commit으로 남깁니다. `functions`의 build와 전체 시험을 통과한 뒤 Staging Hosting만 다시 배포합니다.

```bash
cd functions
npm run build
npm run test:run
cd ..

firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging \
	--non-interactive
```

GitHub session·callback·custom token·계정 연결 session 요청은 Cloud Run 로그에서 확인하고, account-link `PUT`/`DELETE`와 access-token `DELETE`는 Functions `api` 로그에서 확인합니다. Cloud Run 서비스와 revision은 삭제하거나 변경하지 않습니다.

### Functions route 제거 배포 이후

Functions `api`가 GitHub 계정 관리 route 제거가 포함된 소스로 배포된 뒤에는 `/api/auth/github/**` rewrite를 네 개의 개별 rewrite로 되돌리는 복구를 사용하지 않습니다. account-link `PUT`/`DELETE`와 access-token `DELETE`가 `/api/**`를 통해 Functions로 전달되어 `404`를 반환하기 때문입니다.

이때는 GitHub 인증을 지원하는 정상 revision을 확인한 뒤 [Cloud Run revision 복구](./cloud-run-staging.md#revision-복구) 절차로 트래픽을 되돌리고 Hosting rewrite를 유지합니다. 지원하는 정상 revision이 없으면 수정한 `http-api`를 다시 배포하고 직접 호출 검증 전체를 통과한 뒤 Hosting 경로를 다시 확인합니다.

## Apple 인증 라우팅 복구

Functions `api`가 Apple 인증 route 제거가 포함된 소스로 배포되었는지 먼저 확인합니다. 배포 이력이 불분명하면 route가 제거된 상태로 판단합니다.

### 기존 Functions route가 배포된 기간

이 변경에서는 Functions를 배포하지 않으므로 Apple 인증 route 제거가 포함된 소스로 Functions `api`를 배포하기 전까지는 기존 route가 배포된 상태입니다. 이 기간에만 `firebase.json`의 `devlog-staging` 블록에서 `/api/auth/apple/**` Cloud Run rewrite를 제거해 기존 Functions로 되돌릴 수 있습니다. 다른 rewrite는 유지합니다.

복구 설정과 `functions/test/firebase-hosting.test.js`의 Staging 기대값을 함께 변경해 별도 commit으로 남깁니다. `functions`의 build와 전체 시험을 통과한 뒤 Staging Hosting만 다시 배포합니다.

```bash
cd functions
npm run build
npm run test:run
cd ..

firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging \
	--non-interactive
```

앞 절의 Apple 인증 요청을 다시 실행하고 Functions `api` 로그에서 확인합니다. Cloud Run 서비스와 revision은 삭제하거나 변경하지 않습니다.

### Functions route 제거 배포 이후

Functions `api`가 Apple 인증 route 제거가 포함된 소스로 배포된 뒤에는 Apple Cloud Run rewrite만 제거하는 복구를 사용하지 않습니다. 요청이 `/api/**`를 통해 Functions로 전달되어 `404`를 반환하기 때문입니다.

이때는 Apple 인증을 지원하는 정상 revision을 확인한 뒤 [Cloud Run revision 복구](./cloud-run-staging.md#revision-복구) 절차로 트래픽을 되돌리고 Hosting rewrite를 유지합니다. 지원하는 정상 revision이 없으면 수정한 `http-api`를 다시 배포하고 직접 호출 검증 전체를 통과한 뒤 Hosting 경로를 다시 확인합니다.

## WebPage와 PushNotification 라우팅 복구

Functions `api`가 WebPage와 PushNotification route 제거가 포함된 소스로 배포되었는지 먼저 확인합니다. 배포 이력이 불분명하면 route가 제거된 상태로 판단합니다.

### 기존 Functions route가 배포된 기간

이 변경에서는 Functions를 배포하지 않으므로 WebPage와 PushNotification route 제거가 포함된 소스로 Functions `api`를 배포하기 전까지는 기존 route가 배포된 상태입니다. 이 기간에만 `firebase.json`의 `devlog-staging` 블록에서 `/api/web-pages/**`, `/api/push-notifications/**` Cloud Run rewrite를 제거해 기존 Functions로 되돌릴 수 있습니다. Todo, Google·Apple·GitHub 인증과 `/api/**` rewrite는 유지합니다.

복구 설정은 별도 변경과 커밋으로 남기고 `functions/test/firebase-hosting.test.js`의 Staging 기대값도 다음 순서에 맞게 변경합니다.

1. `/api/todos/**` → Cloud Run `http-api`
2. `/api/auth/google/**` → Cloud Run `http-api`
3. `/api/auth/apple/**` → Cloud Run `http-api`
4. `/api/auth/github/**` → Cloud Run `http-api`
5. `/api/**` → Functions `api`

라우팅 계약 시험을 통과한 뒤 Staging Hosting만 다시 배포합니다.

```bash
cd functions
npm test
cd ..

firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging \
	--non-interactive
```

앞 절의 WebPage와 PushNotification `POST`와 `DELETE`를 다시 실행하고 Functions `api` 로그에서 요청을 확인합니다. Cloud Run 서비스와 revision은 삭제하거나 변경하지 않습니다.

### Functions route 제거 배포 이후

Functions `api`가 WebPage와 PushNotification route 제거가 포함된 소스로 배포된 뒤에는 Cloud Run rewrite만 제거하는 복구를 사용하지 않습니다. 두 요청이 `/api/**`를 통해 Functions로 전달되어 `404`를 반환하기 때문입니다.

이때는 WebPage와 PushNotification API를 지원하는 정상 revision을 확인한 뒤 [Cloud Run revision 복구](./cloud-run-staging.md#revision-복구) 절차로 트래픽을 되돌리고 Hosting rewrite를 유지합니다. 지원하는 정상 revision이 없으면 수정한 `http-api`를 다시 배포하고 직접 호출 검증 전체를 통과한 뒤 Hosting 경로를 다시 확인합니다.
