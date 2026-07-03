# DevLog_Firebase

DevLog의 Firebase Cloud Functions와 Firestore index 설정을 관리하는 저장소입니다.

## 구성

- `firebase.json`: Firebase Functions, Firestore index, emulator 설정
- `firebase.test.json`: 테스트용 Firebase emulator 설정
- `firestore.index.json`: Firestore composite index 설정
- `functions`: Cloud Functions TypeScript 소스
- `functions/.env.example`: 로컬 환경 변수 key 목록

## 환경 변수

실제 값이 들어간 `functions/.env`는 로컬 전용 파일입니다. Git에는 포함하지 않습니다.

새 환경을 구성할 때는 `functions/.env.example`의 key를 기준으로 `functions/.env`를 만듭니다.

```text
APPLE_CLIENT_ID
APPLE_KEY_ID
APPLE_PRIVATE_KEY
APPLE_TEAM_ID
FIRESTORE_DBS
GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET
```

## 로컬 빌드

```bash
cd functions
npm ci
npm run build
```

`functions/node_modules`와 `functions/lib`는 로컬 생성물입니다. Git에는 포함하지 않습니다.

## CI

Pull Request에서만 build 검증을 실행합니다.

CI는 `functions`에서 다음 명령만 확인합니다.

```bash
npm ci
npm run build
```

GitHub Actions의 action 런타임은 Node 24 대응 버전을 사용하고, Functions 빌드 Node 버전은 `functions/package.json`의 `engines.node`와 맞춘 Node 22를 사용합니다.

## 배포

현재 CD workflow는 없습니다. 배포는 필요한 시점에 수동으로 진행합니다.

이 저장소에는 `.firebaserc`를 커밋하지 않습니다.

여러 함수를 배포해야 할 때도 전체 일괄 배포보다 필요한 함수 단위로 나누어 배포합니다.
