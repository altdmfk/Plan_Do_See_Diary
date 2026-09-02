# 플랜두씨 다이어리 (Plan/Do/See Diary) v2.0.0

## 1. 프로젝트 개요 및 버전 정보

플랜두씨 다이어리 v2.0.0은 기존 로컬 스토리지 기반의 단일 사용자 클라이언트 구조에서 클라우드 데이터베이스 및 멀티테넌트 사용자 인증, 그리고 엄격한 데이터 격리가 적용된 웹 서비스 아키텍처로 전면 개편된 버전입니다. 

- **프로젝트명**: 플랜두씨 다이어리 (Plan/Do/See Diary)
- **버전**: v2.0.0
- **GitHub 저장소**: [https://github.com/altdmfk/Plan_Do_See_Diary](https://github.com/altdmfk/Plan_Do_See_Diary)
- **라이브 서비스 (GitHub Pages)**: [https://altdmfk.github.io/Plan_Do_See_Diary/](https://altdmfk.github.io/Plan_Do_See_Diary/)
- **핵심 기술 스택**:
  - **프론트엔드**: Vanilla JavaScript (ES6+ Modules), HTML5, CSS3
  - **인증 및 클라우드 서비스**: Supabase Auth (`@supabase/supabase-js v2.x`), REST API
  - **데이터베이스 및 보안**: PostgreSQL, Row Level Security (RLS)
  - **서버 환경**: Node.js (정적 파일 서빙 및 HTTP 보안 헤더 제어)

---

## 2. 주요 아키텍처 변경 사항 (v1.0 -> v2.0)

| 구분 | v1.0 (레거시) | v2.0 (현재) |
| :--- | :--- | :--- |
| **데이터 스토리지** | 브라우저 LocalStorage 단일 저장 | PostgreSQL 원격 DB 및 사용자별 테이블 관리 |
| **사용자 인증** | 미적용 (단일 로컬 클라이언트) | Supabase Auth 기반 이메일/비밀번호 인증 |
| **접근 제어 및 격리** | 클라이언트 상태 필터링 의존 | PostgreSQL RLS(`auth.uid() = user_id`) 기반 원천 격리 |
| **세션 관리** | 무기한 로컬 영속화 | 만료 기한이 존재하는 JWT 토큰 및 자동 갱신 |
| **데이터 이관** | 수동 JSON 백업/복원 | 가입 시 로컬 데이터를 클라우드 계정으로 자동 마이그레이션 |

### 세부 변경 내역
- **인증 계층 통합**: Supabase Auth를 연동하여 회원가입, 로그인, 로그아웃 기능을 구현하고, 미인증 사용자가 메인 보드에 직접 접근할 경우 인증 오버레이로 차단하는 라우트 가드를 적용함.
- **데이터베이스 수준 격리**: 애플리케이션 코드가 아닌 PostgreSQL RLS 정책을 통해 데이터베이스 엔진 수준에서 `auth.uid() = user_id` 조건을 강제하여, 클라이언트 쿼리 변조와 무관하게 인가된 레코드만 조회/조작 가능하도록 구현함.
- **세션 생명주기 관리**: 유효 기간이 제한된 JWT Access Token을 사용하며, 브라우저 세션 스토리지 기반 격리를 적용함. 로그아웃 시 클라이언트 토큰을 즉시 무효화하여 비인가 재요청을 차단함.
- **로컬 데이터 마이그레이션**: v1.0 환경에서 브라우저 LocalStorage에 저장되어 있던 기존 작업 데이터를 탐지하여, v2.0 계정 생성 후 최초 로그인 시 클라우드 데이터베이스로 정합성을 검증하며 자동 이관함.

---

## 3. 보안 및 접근 제어 모델

### 3.1 무노출 원칙 (Zero Secret Exposure)
- **환경변수 분리**: 클라이언트 코드 및 저장소 커밋 내에 Supabase Service Role Key나 비공개 API 시크릿을 하드코딩하지 않음. 공개 식별용 Anon Key만 클라이언트에 주입함.
- **토큰 전송 경로**: 인증 토큰은 URL Query Parameter에 절대 노출하지 않으며, 오직 `Authorization: Bearer <TOKEN>` HTTP 헤더를 통해서만 전달함.
- **콘솔 로그 보호**: 클라이언트 자바스크립트 및 서버 로깅 전반에서 비밀번호 및 민감 세션 정보가 콘솔에 출력되지 않도록 정적/동적 검증을 완료함.

### 3.2 비밀번호 암호화 및 무결성
- **해싱 알고리즘**: Supabase Auth 내부 암호화 엔진을 통해 사용자별 고유 솔트(Salt)가 적용된 Argon2id / bcrypt 해시 알고리즘을 사용함.
- **다형성 보장**: 동일한 비밀번호를 사용하는 사용자라 하더라도 데이터베이스 저장 시 생성되는 해시 문자열이 완전히 상이하도록 처리되어 레인보우 테이블 공격을 방어함.
- **오류 메시지 단일화**: 로그인 실패 시 존재하지 않는 계정과 비밀번호 불일치 케이스 모두 동일한 단일 오류 메시지(`"아이디 또는 비밀번호가 올바르지 않습니다."`, API 표준: `invalid_credentials` / `Invalid login credentials`)를 반환하여 사용자 열거(User Enumeration) 공격을 차단함.

### 3.3 양방향 데이터 격리 (Two-Way RLS Enforcement)
- **조회/수정/삭제 차단**: 사용자 A가 사용자 B의 고유 식별자(`user_id` 또는 대상 레코드 `id`)를 임의로 지정하여 조회를 시도하면 빈 배열(`[]`)이 반환되며, 수정(PATCH) 및 삭제(DELETE) 요청은 변경 행 수 0건(HTTP 204/403)으로 처리되어 상대방 데이터에 영향을 줄 수 없음.
- **연계 삭제(Cascade Deletion)**: 계정 탈퇴 실행 시 PostgreSQL 외래키 제약조건(`ON DELETE CASCADE`) 및 데이터베이스 트리거를 통해 해당 사용자의 모든 하위 데이터(계획, 할 일, 실행 로그, 회고)를 즉시 영구 삭제함.

---

## 4. 디렉터리 구조

프로젝트 소스코드는 역할 및 도메인에 따라 레이어드 아키텍처 구조로 모듈화되어 있다.

```text
plan-do-see-diary/
├── index.html                 # 애플리케이션 진입점 HTML 및 UI 템플릿
├── server.mjs                 # CSP 및 보안 헤더가 적용된 정적 웹 서버
├── schema.sql                 # PostgreSQL DDL, 외래키, 트리거 및 RLS 보안 정책
├── package.json               # 프로젝트 설정 및 테스트 러너 스크립트 정의
├── .gitignore                 # 임시 검증 파일 및 환경변수 제외 규칙
├── AUDIT.md                   # 아키텍처 리팩토링 및 안티패턴 제거 감사 보고서
├── DOCS_AUTH.md               # 인증 구조 및 보안 레퍼런스 문서
├── SUBMISSION_REPORT.md       # T07 최종 평가 및 검증 보고서
│
├── src/                       # 리팩토링된 모듈별 소스코드
│   ├── api/                   # 백엔드/클라우드 통신 계층
│   │   ├── api.js             # 비즈니스 데이터 연동 및 레거시 마이그레이션 파사드
│   │   └── supabaseClient.js  # 저수준 REST 클라이언트 및 인증 헤더 인터셉터
│   ├── auth/                  # 사용자 인증 계층
│   │   └── auth.js            # 세션 스토리지 제어 및 로그인/회원가입 처리
│   ├── core/                  # 앱 부트스트랩 및 공통 설정
│   │   ├── app.js             # 메인 컨트롤러 및 DOM 이벤트 바인딩
│   │   └── config.js          # 전역 상수, 엔드포인트 및 설정 값
│   ├── state/                 # 애플리케이션 상태 관리
│   │   └── state.js           # 옵저버 패턴 단일 상태 저장소 및 KST 메트릭 계산기
│   ├── styles/                # 스타일시트
│   │   ├── main.css           # 레이아웃, 칸반 보드, 모달 스타일
│   │   └── themes.css         # 테마별 CSS Custom Properties 정의
│   ├── ui/                    # 뷰 렌더링 계층
│   │   └── ui.js              # DOM 조작, 컴포넌트 렌더러, XSS 이스케이프 유틸
│   └── utils/                 # 공통 유틸리티
│       ├── crypto.js          # 클라이언트 데이터 암/복호화 유틸
│       ├── dateUtils.js       # Asia/Seoul (KST) 기준 날짜/시간 및 주차 계산기
│       ├── i18n.js            # 다국어(한국어/영어) 메시지 사전
│       └── validators.js      # 입력값 검증, 스키마 바운더리 체크 유틸
│
└── tests/                     # 자동화 테스트 스위트
    ├── test-phase1-auth-schema.mjs  # RLS 격리, 스키마, 연계 삭제 검증
    ├── test-phase2-auth-ui.mjs      # 인증 UI, 세션 만료, 에러 규격 검증
    ├── test-regression.mjs          # 엔드투엔드 통합 데이터 흐름 회귀 테스트
    └── test-verify.mjs              # 모듈 의존성 그래프 및 경로 정합성 검증
```

---

## 5. 실행 및 테스트 검증 가이드

### 5.1 배포 환경 및 라이브 서비스 접속
- **GitHub 저장소**: [https://github.com/altdmfk/Plan_Do_See_Diary](https://github.com/altdmfk/Plan_Do_See_Diary)
- **라이브 서비스 (GitHub Pages)**: [https://altdmfk.github.io/Plan_Do_See_Diary/](https://altdmfk.github.io/Plan_Do_See_Diary/)
- GitHub Pages 환경에서 빌드나 의존성 설치 없이 즉시 브라우저에서 동작하며, 새 시크릿 창에서도 인증 및 격리 기능이 정상 작동함.

### 5.2 사전 요구사항
- Node.js v18.0.0 이상
- `.env` 환경변수 설정 (필요 시 로컬 환경에 구성)

```bash
# .env 설정 예시
SUPABASE_URL=https://[YOUR-PROJECT-REF].supabase.co
SUPABASE_ANON_KEY=[YOUR-SUPABASE-ANON-KEY]
```

### 5.3 로컬 개발 서버 실행
```bash
# 의존성 설치가 필요 없는 순수 Vanilla JS 환경
# 정적 웹 서버 구동 (포트 3000)
npm start
# 또는 node server.mjs
```
서버 실행 후 브라우저에서 `http://localhost:3000`으로 접속한다.

### 5.3 테스트 스위트 실행
본 프로젝트는 데이터베이스 RLS 보안 정책과 클라이언트 인증 인터페이스를 검증하기 위한 자동화 테스트 스위트를 포함하고 있다.

```bash
# Phase 1: DB 스키마 무결성, RLS 교차 격리 및 연계 삭제 검증 (41개 항목)
npm run test:phase1

# Phase 2: 인증 UI 라이프사이클, 세션 만료 및 비밀번호 마스킹 검증 (51개 항목)
npm run test:phase2

# 회귀 검증: 전체 통합 시나리오 테스트
node tests/test-regression.mjs
```
