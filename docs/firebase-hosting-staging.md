# Staging Firebase Hosting Todo 라우팅

## 범위

- Firebase project와 Hosting site: `devlog-staging`
- Cloud Run 서비스: `http-api`
- region: `asia-northeast3`
- Todo 경로: `/api/todos/**`
- 제외: `devlog-auth-prod`, Functions 배포, Firestore rules와 index, Cloud Run 배포와 revision 변경

이 문서는 Staging Hosting 단독 배포와 검증 및 복구 절차를 기록합니다. 이슈 #81의 구현 과정에서는 실제 배포를 수행하지 않습니다.

## 선행 조건

Cloud Run 서비스가 준비된 상태인지 확인합니다.

```bash
gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='table(status.url,status.latestReadyRevisionName,status.traffic)'
```

[Cloud Run Staging 수동 배포 절차](./cloud-run-staging.md)의 직접 호출 검증에서 다음 결과가 모두 확인되어야 합니다.

1. Token이 없는 `POST`: `401`
2. Token이 있는 `POST`: `200`, `{"success":true}`
3. Token이 있는 `DELETE`: `200`, `{"success":true}`

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
2. `/api/auth/github/callback` → Functions `api`
3. `/api/**` → Functions `api`

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

Staging 검증용 Todo와 Firebase ID Token을 준비합니다. Header는 표준 입력으로 전달해 Token이 process 목록에 남지 않게 합니다.

```bash
read -r -p "Staging Todo ID: " TODO_ID
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

curl -i \
	"${HOSTING_URL}/api/auth/github/callback"

unset FIREBASE_ID_TOKEN TODO_ID HOSTING_URL
```

응답을 다음 순서로 확인합니다.

1. Token이 없는 Todo `POST`: `401`
2. Token이 있는 Todo `POST`: `200`, `{"success":true}`
3. Token이 있는 Todo `DELETE`: `200`, `{"success":true}`
4. Token이 없는 Web Page `POST`: Functions `api`의 `401`
5. GitHub callback `GET`: Functions `api`의 redirect 응답
6. Todo와 연결 알림의 삭제 상태 복구

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

Todo 요청은 `http-api`, Web Page와 GitHub callback 요청은 Functions `api`에서 확인되어야 합니다.

## Functions 복구

Todo 요청을 기존 Functions `api`로 되돌릴 때는 `firebase.json`의 `devlog-staging` 블록에서 `/api/todos/**` Cloud Run rewrite만 제거합니다. GitHub callback과 `/api/**` Functions rewrite는 유지합니다.

복구 설정은 별도 변경과 커밋으로 남기고 `functions/test/firebase-hosting.test.js`의 Staging 기대값도 다음 순서에 맞게 변경합니다.

1. `/api/auth/github/callback` → Functions `api`
2. `/api/**` → Functions `api`

라우팅 계약 시험을 통과한 뒤 Staging Hosting만 다시 배포합니다.

```bash
cd functions
npm test
cd ..

firebase deploy \
	--project devlog-staging \
	--only hosting:devlog-staging
```

앞 절의 Todo `POST`와 `DELETE`를 다시 실행하고 Functions `api` 로그에서 두 요청을 확인합니다. Cloud Run 서비스와 revision은 삭제하거나 변경하지 않습니다.
