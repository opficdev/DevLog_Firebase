# `http-api` 스테이징 수동 배포

## 범위

- 프로젝트: `devlog-staging`
- 서비스: `http-api`
- region: `asia-northeast3`
- 런타임 service account: `http-api-runtime`
- 자원: request-based billing, 1 vCPU, 512 MiB, min instances 0, max instances 3, concurrency 80, timeout 60초, port 8080
- 제외: Production, Firebase Hosting, 실제 배포 자동화

## 권한과 인증

- 런타임 service account에는 `roles/datastore.user`만 부여합니다.
- 배포 실행자에는 `roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer`, 런타임 및 build service account 각각에 대한 `roles/iam.serviceAccountUser`가 필요합니다.
- build service account에는 `roles/run.builder`가 필요합니다.
- 최초 공개 설정에는 `run.services.create`, `run.services.update`, `run.services.setIamPolicy` 권한이 필요하며 `roles/run.admin`에 포함됩니다.
- Cloud Run에서는 ADC를 사용합니다. service account key와 `GOOGLE_APPLICATION_CREDENTIALS`는 사용하지 않습니다.
- Cloud Run 주소는 공개하되 모든 업무 요청은 `FirebaseAuthGuard`가 Firebase ID Token으로 인증합니다.

## 배포 전 점검

배포 환경과 runtime 및 build service account를 확인합니다. account 주소와 명령 출력은 저장소에 기록하지 않습니다.

```bash
gcloud --version
gcloud auth list --filter=status:ACTIVE --format='value(account)'
gcloud billing projects describe devlog-staging --format='value(billingEnabled)'
gcloud services list \
	--enabled \
	--project devlog-staging \
	--format='value(config.name)' \
| grep -E '^(run|cloudbuild|artifactregistry)\.googleapis\.com$'

read -r -p "Runtime service account email: " RUNTIME_SERVICE_ACCOUNT
gcloud iam service-accounts describe "$RUNTIME_SERVICE_ACCOUNT" \
	--project devlog-staging \
	--format='value(disabled)'

read -r -p "Build service account email: " BUILD_SERVICE_ACCOUNT
gcloud iam service-accounts describe "$BUILD_SERVICE_ACCOUNT" \
	--project devlog-staging \
	--format='value(disabled)'
```

결제는 `True`, 두 service account의 비활성 상태는 각각 `False`, 필수 API 세 개는 모두 출력되어야 합니다. 실행자와 build service account에는 앞 절의 권한이 있어야 합니다.

작업 트리가 비어 있는지 확인하고 배포할 commit을 기록합니다.

```bash
git status --short
git rev-parse HEAD
```

`nestjs-api` 검증을 마칩니다.

```bash
cd nestjs-api
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run docker:build
cd ..
```

기존 서비스가 있으면 트래픽 100%를 받는 revision을 기록합니다. 첫 배포에는 복구 대상 revision이 없습니다.

```bash
gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='table(status.traffic[].revisionName,status.traffic[].percent)'
```

## 배포

앞에서 입력한 전체 runtime 및 build service account email을 사용합니다.

```bash
gcloud run deploy http-api \
	--source nestjs-api \
	--build-service-account "projects/devlog-staging/serviceAccounts/${BUILD_SERVICE_ACCOUNT}" \
	--project devlog-staging \
	--region asia-northeast3 \
	--service-account "$RUNTIME_SERVICE_ACCOUNT" \
	--cpu 1 \
	--memory 512Mi \
	--cpu-throttling \
	--min 0 \
	--max 3 \
	--concurrency 80 \
	--timeout 60s \
	--port 8080 \
	--no-invoker-iam-check

unset RUNTIME_SERVICE_ACCOUNT BUILD_SERVICE_ACCOUNT
```

배포 후 주소와 최신 revision을 확인합니다.

```bash
gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='table(status.url,status.latestReadyRevisionName,status.traffic)'
```

## 직접 호출 검증

검증 뒤 폐기할 수 있는 Staging Todo, WebPage와 PushNotification ID를 준비합니다. 각 문서는 삭제 요청 전 활성 상태여야 합니다. Firebase ID Token은 화면, shell history, 명령 인자에 남기지 않습니다.

```bash
read -r -p "Staging Todo ID: " TODO_ID
read -r -p "Staging WebPage ID: " WEB_PAGE_ID
read -r -p "Staging PushNotification ID: " PUSH_NOTIFICATION_ID
read -r -s -p "Firebase ID Token: " FIREBASE_ID_TOKEN
printf '\n'

SERVICE_URL="$(gcloud run services describe http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--format='value(status.url)')"

curl -i -X POST \
	"${SERVICE_URL}/api/todos/${TODO_ID}/deletion-request"

curl -i -X POST \
	-H @- \
	"${SERVICE_URL}/api/todos/${TODO_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${SERVICE_URL}/api/todos/${TODO_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X POST \
	-H @- \
	"${SERVICE_URL}/api/web-pages/${WEB_PAGE_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${SERVICE_URL}/api/web-pages/${WEB_PAGE_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X POST \
	-H @- \
	"${SERVICE_URL}/api/push-notifications/${PUSH_NOTIFICATION_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

curl -i -X DELETE \
	-H @- \
	"${SERVICE_URL}/api/push-notifications/${PUSH_NOTIFICATION_ID}/deletion-request" \
	<<<"Authorization: Bearer ${FIREBASE_ID_TOKEN}"

unset FIREBASE_ID_TOKEN TODO_ID WEB_PAGE_ID PUSH_NOTIFICATION_ID SERVICE_URL
```

응답을 다음 순서로 확인합니다.

1. Token이 없는 Todo `POST`: `401`
2. Token이 있는 Todo `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
3. Token이 있는 WebPage `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
4. Token이 있는 PushNotification `POST`와 `DELETE`: 각각 `200`, `{"success":true}`
5. 각 `DELETE` 뒤 Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태 복구

하나라도 실패하면 Firebase Hosting 라우팅을 진행하지 않습니다. 첫 배포에서 Token이 없는 Todo `POST`가 `401`이 아니면 Cloud Run Invoker IAM 검사를 즉시 다시 활성화해 직접 주소의 무인증 호출을 차단합니다.

```bash
gcloud run services update http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--invoker-iam-check
```

Token이 없는 요청이 `403`이면 Cloud Run 공개 설정이 적용되지 않은 상태입니다. 원인을 수정한 뒤 배포 명령을 다시 실행해 공개 설정을 적용하고 직접 호출 검증 전체를 반복합니다. 인증된 `POST` 성공 뒤 `DELETE`가 실패한 첫 배포는 수정본을 다시 배포한 뒤 실패한 경로의 `DELETE`부터 실행합니다. 이후 배포에서는 해당 API를 지원하는 이전 revision으로 복구한 뒤 같은 `DELETE`를 실행합니다. Todo와 연결 알림, WebPage 및 PushNotification의 삭제 상태가 복구됐는지 확인한 뒤 직접 호출 검증을 다시 수행합니다.

## revision 복구

첫 배포에서 Token이 없는 `POST`의 인증 검증에 실패하면 앞 절의 비공개 전환을 마친 뒤 수정본을 다시 배포합니다. 다른 첫 배포 검증에 실패하면 수정본을 다시 배포합니다. 이후 배포 검증에 실패하면 기록한 revision으로 트래픽을 되돌립니다.

```bash
read -r -p "Previous revision: " PREVIOUS_REVISION

gcloud run services update-traffic http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--to-revisions "${PREVIOUS_REVISION}=100"

unset PREVIOUS_REVISION
```

rollback 뒤 수정본을 배포하면 이전 트래픽 정책이 유지될 수 있습니다. 수정본 배포가 끝나면 최신 revision으로 트래픽을 명시적으로 전환하고 직접 호출 검증을 다시 수행합니다.

```bash
gcloud run services update-traffic http-api \
	--project devlog-staging \
	--region asia-northeast3 \
	--to-latest
```
