# 우리 가족 비상연락

전쟁, 자연재해, 전염병 같은 비상 상황에서 가족이 서로의 안전을 확인하고 다시 모이기 위한 웹사이트입니다.
휴대폰으로 열어 **"나 무사해요"** 버튼 하나로 생존신고를 하고, 미리 정한 집합장소로 모입니다.

- 화면: GitHub Pages (무료)
- 데이터·로그인: Firebase 무료 요금제(Spark)
- 비상 알림·관리자 작업: Cloudflare Workers 무료

설계와 결정 사항은 [docs/design.md](docs/design.md)에 있습니다.

## 기능

| 기능 | 누가 |
|---|---|
| "나 무사해요" / "도움 필요" 생존신고 (GPS 위치 + 시간 기록) | 가족 모두 |
| 현재 위치 확인, 체크포인트 저장 (이동 경로) | 가족 모두 |
| 문자로 알리기 (데이터가 끊기고 문자만 될 때) | 가족 모두 |
| 집합장소 1~10순위, 지금 갈 곳과 남은 시간, 길찾기, 집합장소 기록 | 가족 모두 |
| 상황별 대처법·체크리스트 (전쟁, 화생방, 지진, 홍수, 화재, 감염병, 정전 등) | 가족 모두 |
| 비상선언 → 알림 + 경보음 | 관리자 (무제한), 일반 가족 (1회) |
| 가족 추가·수정·삭제, 비밀번호 초기화 | 관리자 |
| 모든 가족의 위치 기록·이동 경로·개인정보·준비 상태 | 관리자 |
| 집합장소·대처법 편집 | 관리자 |
| 인쇄용 비상카드 | 가족 모두 |
| 오프라인 동작 (한 번 열어 본 휴대폰) | 가족 모두 |

### 누가 무엇을 볼 수 있나

| 정보 | 본인 | 다른 가족 | 관리자 |
|---|---|---|---|
| 이름, 전화번호, 마지막 생존신고(상태·시간·위치) | ✅ | ✅ | ✅ |
| 성별, 생년월일·나이, 혈액형, 이메일, 집주소, 의료 메모 | ✅ | ❌ | ✅ |
| 전체 위치 기록 | ✅ | ❌ | ✅ |
| 체크리스트 진행 | ✅ | ❌ | ✅ |

## 설치 순서

처음 한 번만 하면 됩니다. 30~40분 정도 걸립니다.

### 1. Firebase 프로젝트 만들기

1. <https://console.firebase.google.com> 에서 **프로젝트 추가**. Google 애널리틱스는 꺼도 됩니다.
2. **빌드 → Authentication → 시작하기 → 로그인 방법 → 이메일/비밀번호** 사용 설정.
3. **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치: `asia-northeast3 (서울)`
   - **프로덕션 모드**로 시작
4. **보안 규칙 올리기** — 둘 중 하나:
   - 콘솔: Firestore → 규칙 탭에 [firestore.rules](firestore.rules) 내용을 통째로 붙여 넣고 게시. 색인 탭에서 `checkins` 컬렉션에 `uid 오름차순, clientAt 내림차순` 복합 색인 추가.
   - 명령어: `npx firebase-tools login` 후 `npx firebase-tools deploy --only firestore --project 내프로젝트id`
5. **프로젝트 설정(톱니바퀴) → 일반 → 내 앱 → 웹(</>) 앱 추가**. 나온 `firebaseConfig` 값을 [web/js/config.js](web/js/config.js)의 `firebase` 에 넣습니다. 이 값은 공개돼도 괜찮습니다.
6. **프로젝트 설정 → 클라우드 메시징 → 웹 구성 → 웹 푸시 인증서 → 키 쌍 생성**. 나온 키를 `config.js`의 `vapidKey` 에 넣습니다.
7. **Authentication → 설정 → 승인된 도메인**에 `devmh1003.github.io` 추가.

### 2. Cloudflare Worker (알림 서버)

1. **서비스 계정 키 만들기**: Firebase 프로젝트 설정 → 서비스 계정 → **새 비공개 키 생성** → JSON 파일 다운로드.
   - 이 파일은 비밀번호와 같습니다. 저장소에 절대 올리지 말고, Worker에 등록한 뒤 지우세요.
   - 권한을 줄이려면 [Google Cloud IAM](https://console.cloud.google.com/iam-admin/iam)에서 이 서비스 계정의 역할을 `Cloud Datastore 사용자`, `Firebase Cloud Messaging API 관리자`, `Firebase 인증 관리자` 세 개로 바꿉니다.
2. <https://dash.cloudflare.com> 가입 (무료, 카드 불필요).
3. [worker/wrangler.toml](worker/wrangler.toml)의 `FIREBASE_PROJECT_ID` 를 내 프로젝트 id로 바꿉니다.
4. 터미널에서:
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT
   ```
   마지막 명령에서 서비스 계정 JSON 파일 내용을 통째로 붙여 넣습니다. 그다음:
   ```bash
   npx wrangler deploy
   ```
5. 나온 주소(`https://family-emergency.○○○.workers.dev`)를 `config.js`의 `workerUrl` 에 넣습니다.

### 3. GitHub Pages

1. 저장소 **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. `config.js` 변경을 `main` 에 올리면 자동으로 배포됩니다. 주소: <https://devmh1003.github.io/emergency/>

### 4. 첫 관리자 등록 (배포 직후 바로)

1. 사이트를 열고 로그인 화면 아래 **"처음 설치하셨나요? 초기 설정"**.
2. 이름, 전화번호, 이메일, 비밀번호를 넣으면 첫 관리자가 됩니다. 이 경로는 한 번 쓰면 영구히 닫힙니다.
3. 혹시 내가 아닌 사람이 먼저 등록했다면: Firestore 콘솔에서 `config/setup`, 그 사람의 `members` 문서를 지우고 다시 하세요.

### 5. 마무리 (권장)

- **API 키 제한**: [Google Cloud 사용자 인증 정보](https://console.cloud.google.com/apis/credentials)에서 "Browser key"를 열고 **웹사이트 제한**에 `https://devmh1003.github.io/*` 추가 (로컬 개발 시 `http://localhost:5500/*` 도).
- **가족 추가**: 가족 탭 → `+ 가족 추가`. 이메일과 첫 비밀번호를 정해 알려 주면 됩니다.
- **집합장소 정하기**: 가족 탭 → 관리자 메뉴 → 집합장소 설정.
- **대처법 불러오기**: 가족 탭 → 관리자 메뉴 → 대처법 관리 → 기본 프로토콜 불러오기 (수정하고 싶을 때만).

## 가족에게 알려 줄 것

1. 휴대폰으로 사이트를 열고 로그인 → **설정 → 비밀번호 바꾸기**.
2. **홈 화면에 추가** (아이폰은 Safari 공유 버튼 → 홈 화면에 추가). 그래야 알림이 오고 인터넷 없이도 열립니다.
3. 홈 화면 아이콘으로 열어 **설정 → 알림 켜기 → 테스트 알림**.
4. **설정 → 인쇄용 비상카드**를 출력해 지갑과 배낭에.
5. 비상 시: 열자마자 **"나 무사해요"**. 연락이 안 돼도 **1순위 집합장소**로.

## 비상 시 안정성

- 화면은 GitHub(전 세계 CDN), 데이터는 Google, 알림은 Cloudflare로 나뉘어 있습니다.
- 한 번 열어 본 휴대폰은 앱 화면, 대처법, 집합장소, 가족 연락처, 본 지도를 저장해 둡니다.
- 인터넷 없이 누른 생존신고는 휴대폰에 보관됐다가 연결되면 자동 전송됩니다.
- 데이터는 끊기고 문자만 될 때: **문자로 알리기** 버튼.
- 휴대폰이 꺼졌을 때: **인쇄용 비상카드**.

## 보안

[SECURITY.md](SECURITY.md)를 참고하세요. 요약:

- 모든 권한은 서버(Firestore 보안 규칙)에서 검사합니다. 화면 코드를 고쳐도 남의 정보를 볼 수 없습니다.
- 아무나 가입할 수 없습니다. 관리자가 만든 계정만 데이터에 접근합니다.
- 비밀 키는 Cloudflare 비밀 변수에만 있고, 저장소에는 없습니다.
- GitHub CodeQL, Dependabot, 비밀 스캔, OpenSSF Scorecard로 자동 점검합니다.

## 개발

```bash
npm test
```

로직, Worker, 서비스 워커 테스트 (설치 불필요).

```bash
npm install
npm run test:rules
```

Firestore 보안 규칙 테스트 (Java 21 이상 필요). GitHub Actions에서도 자동으로 돌아갑니다.

```bash
npm run serve
```

<http://localhost:5500> 에서 사이트 확인.

`web/` 에 파일을 추가하면 `web/sw.js` 의 `APP_FILES` 에도 추가하세요 (`npm test` 가 검사합니다).
