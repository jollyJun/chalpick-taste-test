# 찰픽 취향테스트 v19 · GitHub 업로드용

이 폴더는 **97개 파일**, 숨김 파일 없음, 개별 파일 최대 약 330KB로 구성했습니다. 전체 기능을 유지하면서 업로드할 필요가 없는 대용량 데이터와 과거 문서를 분리했습니다.

## GitHub에 올리는 방법

1. ZIP을 먼저 압축 해제합니다. ZIP 자체를 저장소에 올리지 않습니다.
2. 압축 해제한 폴더를 열어 **api, db, public, scripts, server, tests 폴더와 package.json, vercel.json, README.md, ENVIRONMENT_SETUP.txt**를 함께 선택합니다.
3. GitHub의 업로드 화면에 한 번에 끌어다 놓습니다. 내부 폴더 구조를 유지해야 합니다.
4. 저장소 최상위에 `package.json`과 `vercel.json`이 보여야 합니다. `chalpick-v19-github-upload` 같은 바깥 폴더를 한 겹 더 올리지 않습니다.
5. 이미 같은 이름의 파일을 올렸다면 이번 파일로 교체합니다. 이전에 올린 `dist`, `.env`류, 대용량 catalog 데이터는 이번 묶음에 필요하지 않습니다. 이 ZIP을 올리는 것만으로 과거 파일이 자동 삭제되지는 않습니다.

GitHub 공식 안내는 브라우저 업로드에 한 번에 최대 100개, 파일당 25MiB 제한을 명시합니다. 이 묶음은 파일당 1MiB 미만으로 더 작게 구성했습니다.
출처: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository

## 배포 설정

이 앱은 서버 API를 사용합니다. GitHub Pages 같은 정적 호스팅만으로는 취향 결과·회원 연결 API가 동작하지 않습니다. 기존 Vercel 프로젝트에서 이 저장소를 연결해 사용하세요.

- Framework: Other
- Root Directory: package.json이 있는 저장소 최상위
- Build Command: npm run build
- Output Directory: dist
- Node.js: 24.x

Vercel 프로젝트의 Settings → Environment Variables에서 다음 두 값을 먼저 설정해야 **빌드와 작품 조회**가 됩니다.

| 이름 | 넣을 값 |
|---|---|
| SUPABASE_URL | 사용하는 Supabase 프로젝트 URL |
| SUPABASE_PUBLISHABLE_KEY | 같은 프로젝트의 공개용 publishable key |

기존 anon 키는 `SUPABASE_ANON_KEY`로도 지원합니다. 서버 비밀키를 공개용 키 대신 사용하지 않습니다. 설정을 바꾼 뒤에는 재배포해야 적용됩니다.

실제 값은 GitHub 파일에 적지 않습니다. 숨김 `.env.example` 대신 **ENVIRONMENT_SETUP.txt**에 입력할 변수 이름과 용도를 정리했습니다. 안내 파일 자체를 코드가 설정으로 읽는 것은 아닙니다.

## 큰 데이터 파일은 어디로 갔나요?

기존 40MB 전체 목록, 분할된 목록, 추천용 압축 데이터는 업로드하지 않습니다. `npm run build`가 설정된 Supabase에서 읽어 아래 파일을 만듭니다.

- public/data/catalog-release.json, catalog-part.*.json, catalog-meta.*.json 및 전체 목록
- server/data/recommendation-catalog.json.gz
- 배포 결과물 dist/

작품을 줄이거나 추천 기능을 제거한 것이 아닙니다. DB에서 데이터를 읽고 필요한 형식으로 만드는 단계만 배포 시점에 수행합니다. 처음 빌드할 때는 네트워크 조회 시간이 필요합니다. DB 연결 또는 검증이 실패하면 불완전한 목록으로 성공 처리하지 않습니다.

**빌드 후 생성된 폴더를 다시 GitHub에 올리지 마세요.** 다시 업로드할 때도 처음 제공한 97개 파일을 사용하면 됩니다. `.gitignore` 없이도 이번 업로드에는 생성 데이터·개인 설정이 포함되지 않도록 준비했습니다.

## 회원가입·취향 저장 연결

화면과 비회원 테스트에 필요한 공개 설정, 계정 저장에 필요한 비밀 설정은 역할이 다릅니다. 로그인과 저장까지 사용하려면 ENVIRONMENT_SETUP.txt의 서버 설정이 필요합니다.

- 기존 v3 회원·평가 테이블과 집계 트리거가 있는 DB를 전제로 합니다.
- `db/03_취향테스트_회원연결.sql`은 취향 저장·소셜 계정 연결을 위한 추가 함수와 비공개 영수증을 준비합니다. 업로드나 빌드가 SQL을 자동 실행하지 않습니다.
- `db/02_소셜계정_감상이력.sql`은 메인의 감상 이력·마이페이지 기능용으로 역할이 다릅니다. 기존 설치 여부를 확인해 적용합니다.
- 네이버·카카오 로그인은 기존 자체 세션을 유지하며, 새 회원 연결 시 이메일 인증과 필수 회원 정보가 필요합니다. Supabase 이메일 OTP/SMTP 및 인증번호 템플릿 `{{ .Token }}`을 설정해야 합니다.
- 로그인 공급자의 콜백 URL은 각 배포 도메인에 맞춰 등록합니다. AUTH_SESSION_SECRET은 기존 사이트와 같은 값이어야 합니다.
- `/taste/`와 메인 `/`을 같은 출처로 배포해야 임시 취향을 이어받을 수 있습니다. 다른 도메인에 올린 취향테스트가 chalpick.kr의 저장소로 자동 전달되지는 않습니다.

실제 운영 회원가입·저장 검증 및 SQL 적용은 별도입니다. 이번 작업에서는 운영 사이트나 DB를 변경하지 않았습니다.

## 로컬 검증

서버 환경변수를 설정한 Node.js 24 환경에서 실행합니다.

```text
npm run build
npm run check
npm run test:taste
npm start
```

데이터가 없는 첫 빌드는 위 공개 설정 두 값이 필요합니다. 단위 테스트 20개는 tests/taste.test.mjs에 유지했습니다. 이전 SQL 시험용 fixture와 과거 버전 설명서는 업로드 대상에서 뺐습니다. 기존 미리보기 원본과 상세 전달 명세서는 별도로 보존했습니다.
