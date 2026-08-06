# DevLog_Firebase

DevLog의 Firebase Cloud Functions와 Firestore index 설정을 관리하는 저장소입니다.

## 구성

- `firebase.json`: Firebase Functions, Firestore index, emulator 설정
- `firebase.test.json`: 테스트용 Firebase emulator 설정
- `firestore.index.json`: Firestore composite index 설정
- `functions`: Cloud Functions TypeScript 소스
- `nestjs-api`: Cloud Run용 NestJS API 소스와 Docker 이미지 구성

## 백엔드 요청 구조

이 저장소는 기존 Cloud Functions와 별도로 배포할 수 있는 NestJS API를 함께 관리합니다. Firebase Hosting rewrite는 요청 경로에 따라 Cloud Run과 Cloud Functions로 HTTP 요청을 분기합니다.

```mermaid
flowchart LR
	Client["API Client"] --> Hosting["Firebase Hosting"]
	Hosting -->|"/api/todos/**<br/>/api/web-pages/**<br/>/api/push-notifications/**<br/>/api/auth/google/**<br/>/api/auth/apple/**<br/>GitHub session·callback·custom token"| CloudRun["Cloud Run<br/>http-api"]
	Hosting -->|"나머지 /api/**"| Functions["Cloud Functions<br/>api"]
	CloudRun --> Auth["Firebase Auth"]
	Functions --> Auth
	CloudRun --> Firestore["Firestore"]
	Functions --> Firestore
```

| 실행 구성 | 소스 | 책임 |
| --- | --- | --- |
| Firebase Hosting | `firebase.json` | 공개 요청 진입점과 경로별 rewrite 순서 관리 |
| Cloud Run `http-api` | `nestjs-api` | Todo, WebPage, PushNotification 요청의 Firebase ID Token 검증과 삭제, Google·Apple 인증, GitHub session·callback·custom token 관리 |
| Cloud Functions `api` | `functions` | 기존 REST API와 OAuth 처리 |
| Cloud Functions 개별 함수 | `functions` | trigger, Scheduler, Cloud Tasks, FCM 처리 |
| Firebase Auth | — | 인증이 필요한 경로에 전달된 Bearer token 검증 |
| Firestore | — | 검증된 사용자 UID 범위의 공통 데이터 저장 |

Staging Hosting에서는 `/api/todos/**`, `/api/web-pages/**`, `/api/push-notifications/**`, `/api/auth/google/**`, `/api/auth/apple/**`와 GitHub의 `/sign-in-sessions`, `/callback`, `/custom-token`, `/account-link-sessions`를 Cloud Run `http-api`가 우선 처리합니다. GitHub 계정 연결 해제·access token 제거를 포함한 나머지 `/api/**`는 기존 Functions `api`가 계속 처리합니다.

기존 Functions를 한 번에 교체하지 않고 요청 계약을 유지하면서 경로 단위로 NestJS API에 이전하는 구조입니다. 최종적으로 Cloud Functions `api`가 담당하는 HTTP API 전체를 Cloud Run 기반 `http-api`로 이전하는 것을 목표로 합니다.

Cloud Run 배포와 직접 호출 검증은 [`docs/cloud-run-staging.md`](docs/cloud-run-staging.md), Firebase Hosting 분기 배포와 복구는 [`docs/firebase-hosting-staging.md`](docs/firebase-hosting-staging.md)에서 관리합니다.

## 환경 변수

Firebase CLI의 `--project`로 staging 또는 prod Firebase project를 선택합니다. 각 project에 배포된 함수는 인자 없는 `getFirestore()`로 해당 project의 `(default)` database를 사용합니다.

일반 환경 변수를 추가하면 Firebase CLI가 `functions/.env`와 선택한 project 또는 alias에 대응하는 `functions/.env.<project or alias>`를 자동으로 읽습니다.

일반 환경 변수 파일은 로컬 전용으로 관리하며 Git에 포함하지 않습니다.

GitHub, Google, Apple 인증 설정은 일반 환경 변수나 `.env`에 저장하지 않고 Firebase project별 Secret Manager의 `GITHUB_OAUTH_CONFIG`, `GOOGLE_OAUTH_CONFIG`, `APPLE_AUTH_CONFIG` JSON Secret에서 각각 관리합니다.

GitHub JSON에는 `clientId`, `clientSecret`, `callbackURL` 필드를 모두 포함합니다.

Google JSON에는 `clientId`, `clientSecret` 필드를 필수로 포함합니다. `callbackURL`은 사용하지 않습니다.

Google `clientSecret`은 같은 환경의 `GOOGLE_OAUTH_CONFIG.clientId`에 대응하는 Web OAuth client에서 발급된 값이어야 합니다.

iOS Google Sign-In 설정은 환경별 Firebase Secret과 다음과 같이 일치해야 합니다.

- staging `GIDServerClientID` = staging `GOOGLE_OAUTH_CONFIG.clientId`
- production `GIDServerClientID` = production `GOOGLE_OAUTH_CONFIG.clientId`

Google 인증은 서버 callback route를 사용하지 않으며 Staging에서는 `/api/auth/google/**` Hosting rewrite로 Cloud Run에 전달됩니다. Apple 인증은 Staging의 `/api/auth/apple/**` Hosting rewrite로 Cloud Run에 전달됩니다. GitHub 인증은 기존 `callbackURL`을 유지하며 Staging에서는 이전한 네 경로만 개별 Hosting rewrite로 Cloud Run에 전달됩니다.

Apple JSON에는 `teamId`, `clientId`, `keyId`, `privateKey` 필드를 모두 포함합니다.

## 로컬 검증

### Functions

```bash
cd functions
npm ci
npm run build
npm run test:run
```

### NestJS API

```bash
cd nestjs-api
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run docker:build
```

`functions/node_modules`, `functions/lib`, `nestjs-api/node_modules`, `nestjs-api/dist`는 로컬 생성물입니다. Git에는 포함하지 않습니다.

## CI

Pull Request에서만 Functions와 NestJS API 검증을 실행합니다.

Functions `build`, `test` job은 다음 명령을 확인합니다.

```bash
cd functions
npm ci
npm run build
npm run test:run
```

`nestjs-api` job은 다음 명령을 확인하고 실행 로그를 artifact로 보관합니다.

```bash
cd nestjs-api
npm ci
npm run lint
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
npm run docker:build
cd ..
git diff --check
```

Docker 이미지는 검증을 위해 build만 수행하며 실행하거나 게시하지 않습니다. `report` job은 Functions와 NestJS API 결과를 함께 확인하고 실패 원인을 Pull Request 댓글로 남깁니다.

현재 CI는 검증만 담당합니다. Cloud Run 배포와 Docker 이미지 게시 자동화는 [이슈 #65](https://github.com/opficdev/DevLog_Firebase/issues/65)에서 별도로 다룹니다.

GitHub Actions의 action 런타임은 Node 24 대응 버전을 사용하고 Functions와 NestJS API 검증용 Node 버전은 각 `package.json`의 `engines.node`와 맞춘 Node 22를 사용합니다.

## 배포

현재 CD workflow는 없습니다. 배포는 필요한 시점에 수동으로 진행합니다.

이 저장소에는 `.firebaserc`를 커밋하지 않습니다.

배포할 Firebase project는 명령에서 명시합니다.

```bash
firebase deploy --project <staging-project-id> --only functions:<functionName>
firebase deploy --project <prod-project-id> --only functions:<functionName>
```

양쪽 project에는 같은 함수 이름을 배포하며 각 함수는 해당 project의 `(default)` database만 사용합니다.

기존 prod named database의 데이터를 prod project의 `(default)`로 이전하기 전에는 이 변경을 prod project에 배포하지 않습니다.

여러 함수를 배포해야 할 때도 전체 일괄 배포보다 필요한 함수 단위로 나누어 배포합니다.

GitHub OAuth 전환 배포 전에는 staging과 prod 모두 `oauthSessions.expiresAt`, `oauthTickets.expiresAt` TTL 설정을 먼저 반영합니다.

## AI 역할 분리

```mermaid
flowchart LR
	subgraph Primary["Primary"]
		Planner["Planner"]
		Implementer["Implementer"]
		Integrator["Final Integration"]
	end

	subgraph ConnectedSideTasks["현재 task 연결형 사이드 작업<br/>spawn_agent / Option-Command-S"]
		FirebaseOperationsReviewer["Firebase Operations Reviewer<br/>firebase_operations_reviewer"]
		CodeReviewer["Code Reviewer<br/>code_reviewer"]
		VerificationRunner["Verification Runner<br/>verification_runner"]
		GitHubCIAnalyst["GitHub/CI Analyst<br/>github_ci_analyst"]
		DocumentationWriter["Documentation Writer<br/>documentation_writer"]
	end

	subgraph Gate["Gate"]
		TaskPacket["Task Packet"]
		OperationsGate["Operations Gate"]
		ReviewGate["Review Gate"]
		VerificationGate["Verification Gate"]
	end

	TaskPacket --> Planner
	Planner -->|"No operations risk"| Implementer
	Planner -->|"Operations risk<br/>task_name 선택"| FirebaseOperationsReviewer
	FirebaseOperationsReviewer -->|Pass| OperationsGate
	FirebaseOperationsReviewer -->|Block / Decision| Integrator
	OperationsGate --> Implementer
	Implementer --> CodeReviewer
	CodeReviewer --> ReviewGate
	ReviewGate --> VerificationRunner
	VerificationRunner --> VerificationGate
	GitHubCIAnalyst -->|"현재 task로 결과 반환"| Planner
	DocumentationWriter -->|"현재 task로 결과 반환"| Integrator
	VerificationGate --> Integrator
```

| 역할 | 정확한 `task_name` / Custom Agent | 모델 | 담당 | 다음 흐름 |
| --- | --- | --- | --- | --- |
| Planner | active main agent | Primary | 이슈, 요청, 변경 범위, role routing 정리 | Implementer / Firebase Operations Reviewer |
| Implementer | active main agent | Primary | task packet 기준 코드 또는 문서 수정 | Code Reviewer |
| Firebase Operations Reviewer | `firebase_operations_reviewer` | `gpt-5.3-codex-spark` (`Lightweight`) | deploy scope, env, Firestore database, index, data-shape, migration 위험 검토 | Implementer / Final Integration |
| Code Reviewer | `code_reviewer` | `gpt-5.3-codex-spark` (`Lightweight`) | diff 기준 버그, 회귀, 테스트 누락, scope drift 검토 | Verification Runner |
| Verification Runner | `verification_runner` | `gpt-5.3-codex-spark` (`Lightweight`) | build, test, docs check 결과 기록 | Final Integration |
| GitHub/CI Analyst | `github_ci_analyst` | `gpt-5.3-codex-spark` (`Lightweight`) | issue, PR thread, review comment, workflow run, CI log 분석 | Planner |
| Documentation Writer | `documentation_writer` | `gpt-5.3-codex-spark` (`Lightweight`) | PR 본문, release note, README, issue/comment 문안 작성 | Final Integration |

`Lightweight`와 `Fast` 역할은 현재 main task에 연결되는 사이드 작업으로 실행합니다. 도구에서는 `spawn_agent`, UI에서는 `Option-Command-S`를 사용하며 역할 결과는 현재 main task로 돌아와 `Primary`가 검토하고 통합합니다.

`spawn_agent.task_name`은 표의 이름, `.codex/agents/<name>.toml` 파일명, TOML의 `name`과 정확히 일치해야 합니다. 임의의 접두어나 접미사를 붙인 이름은 configured custom agent 위임으로 인정하지 않습니다.

같은 역할에 후속 작업을 맡길 때는 새 이름의 agent를 만들지 않고 기존 agent에 `followup_task`를 전달합니다. 외부 `codex exec`, 별도의 사용자 소유 `create_thread`, 임의 이름의 일반 sub-agent는 저장소 역할 위임 수단이 아닙니다. 이러한 실행 경로의 실패만으로 configured custom agent나 고정 모델을 사용할 수 없다고 판단하지 않습니다.
