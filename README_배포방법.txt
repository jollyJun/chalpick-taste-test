찰픽 웹 데모 v10 — 배포용 폴더 구조

구성
- index.html                : 메인 화면
- css/style.css             : 화면 스타일
- js/app.js                 : 취향테스트/추천/공유 동작
- data/contents.js          : 1,000편 작품 데이터
- data/types.js             : 결과 카드 경로 정보
- assets/taste-cards/*.webp : 16종 취향 결과 카드
- vercel.json               : Vercel 정적 배포 기본 설정

배포 방법 — 가장 간단한 방법(Netlify)
1. 이 폴더 전체를 그대로 https://app.netlify.com/drop 에 드래그한다.
2. 배포가 끝나면 생성된 https://xxxx.netlify.app 주소로 접속한다.
3. 취향 결과의 공유 링크도 같은 사이트 주소를 기준으로 동작한다.

Vercel
1. 이 폴더를 GitHub 저장소 루트에 올린다.
2. Vercel에서 New Project → 해당 저장소 Import → Deploy.
   또는 이 폴더에서 `npx vercel --prod`를 실행한다.
3. 별도 빌드 명령은 필요 없다. 정적 사이트다.

로컬 확인
- index.html을 더블클릭해도 데이터가 외부 JS 파일로 분리되어 기본 동작한다.
- 브라우저 보안 정책에 따라 일부 공유/클립보드 기능은 HTTPS 배포 주소에서 더 안정적으로 동작한다.

공유 미리보기 주의
- 현재 공유 링크를 열면 해당 취향 카드 화면으로 이동하는 기능은 동작한다.
- 카카오톡/문자/SNS에서 링크 자체에 취향카드 이미지 미리보기를 자동으로 붙이려면, 실제 도메인이 정해진 뒤 카드별 Open Graph URL을 추가하는 단계가 필요하다.
