# Staging Firebase Hosting API 라우팅

## 범위

- Firebase project와 Hosting site: `devlog-staging`
- Cloud Run 서비스: `http-api`
- region: `asia-northeast3`
- Todo 경로: `/api/todos/**`
- WebPage 경로: `/api/web-pages/**`
- PushNotification 경로: `/api/push-notifications/**`
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

[Cloud Run Staging 수동 배포 절차](./cloud-run-staging.md)의 직접 호출 검증에서 다음 결과가 모두 확인되어야 합니다.

1. Token이 없는 Todo `POST`: `401`
2. Token이 있는 Todo `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
3. Token이 있는 WebPage `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
4. Token이 있는 PushNotification `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
5. 각 `DELETE` 뒤 Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태 복구

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
4. `/api/auth/github/callback` → Functions `api`
5. `/api/**` → Functions `api`

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
	--only hosting:devlog-staging
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

curl -i \
	"${HOSTING_URL}/api/auth/github/callback"

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
8. GitHub callback `GET`: Functions `api`의 redirect 응답
9. 각 `DELETE` 뒤 Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태 복구

Todo와 기존 API의 응답만으로 실행 주체를 구분하기 어려우므로 Cloud Run과 Functions 로그도 함께 확인합니다.

```bash
gcloud run services logs read http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--limit 50

firebase functions:log \
	--project devlog-staging \
	--only api \
	--lines 50
```

Todo, WebPage와 PushNotification 요청은 `http-api`, GitHub callback 요청은 Functions `api`에서 확인되어야 합니다.

## WebPage와 PushNotification 라우팅 복구

Functions `api`가 WebPage와 PushNotification route 제거가 포함된 소스로 배포되었는지 먼저 확인합니다. 배포 이력이 불분명하면 route가 제거된 상태로 판단합니다.

### 기존 Functions route가 배포된 기간

이 변경에서는 Functions를 배포하지 않으므로 WebPage와 PushNotification route 제거가 포함된 소스로 Functions `api`를 배포하기 전까지는 기존 route가 배포된 상태입니다. 이 기간에만 `firebase.json`의 `devlog-staging` 블록에서 `/api/web-pages/**`, `/api/push-notifications/**` Cloud Run rewrite를 제거해 기존 Functions로 되돌릴 수 있습니다. Todo, GitHub callback과 `/api/**` rewrite는 유지합니다.

복구 설정은 별도 변경과 커밋으로 남기고 `functions/test/firebase-hosting.test.js`의 Staging 기대값도 다음 순서에 맞게 변경합니다.

1. `/api/todos/**` → Cloud Run `http-api`
2. `/api/auth/github/callback` → Functions `api`
3. `/api/**` → Functions `api`

라우팅 계약 시험을 통과한 뒤 Staging Hosting만 다시 배포합니다.

```bash
cd functions
npm test
cd ..

firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging
```

앞 절의 WebPage와 PushNotification `POST`와 `DELETE`를 다시 실행하고 Functions `api` 로그에서 요청을 확인합니다. Cloud Run 서비스와 revision은 삭제하거나 변경하지 않습니다.

### Functions route 제거 배포 이후

Functions `api`가 WebPage와 PushNotification route 제거가 포함된 소스로 배포된 뒤에는 Cloud Run rewrite만 제거하는 복구를 사용하지 않습니다. 두 요청이 `/api/**`를 통해 Functions로 전달되어 `404`를 반환하기 때문입니다.

이때는 WebPage와 PushNotification API를 지원하는 정상 revision을 확인한 뒤 [Cloud Run revision 복구](./cloud-run-staging.md#revision-복구) 절차로 트래픽을 되돌리고 Hosting rewrite를 유지합니다. 지원하는 정상 revision이 없으면 수정한 `http-api`를 다시 배포하고 직접 호출 검증 전체를 통과한 뒤 Hosting 경로를 다시 확인합니다.
