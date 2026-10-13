# TripPlanner 개발 인수인계

최종 갱신: 2026-10-13  
프로덕션: https://tripplanner-alpha-three.vercel.app

## 1. 프로젝트 목적

TripPlanner는 사용자가 입력한 목적지·여행 기간·총 예산·여행 인원·여행 스타일·일정 밀도를 바탕으로, AI가 **현실적인 일자별 해외여행 일정과 비용 계획**을 JSON으로 생성하고 결과 화면에 렌더링하는 웹 서비스다.

핵심 원칙은 `가고 싶은 곳`과 `쓸 수 있는 돈` 사이의 균형이다. 결과에는 다음을 제공한다.

- 날짜별 시간·장소·카테고리·현지 통화·원화 비용 일정표
- 계획표 항목 합계 기반의 카테고리별 예상 경비
- 입력 예산 대비 총 예상 지출 및 예산 초과 경고
- 준비 체크리스트, 국가별 안전/비상 연락 카드, Tavily 검색 출처
- 한국수출입은행 환율 기반의 원화 환산

## 2. 현재 배포·개발 환경

- 작업 폴더: `C:\Users\user\Desktop\tripplanner`
- Vercel 팀/스코프: `cmst`
- 현재 프로덕션 별칭: `https://tripplanner-alpha-three.vercel.app`
- 마지막 배포: `npx.cmd vercel@latest --prod --yes --scope cmst`
- Windows PowerShell에서는 실행 정책 때문에 `npx` 대신 `npx.cmd`를 사용한다.
- 배포는 사용자가 명시적으로 요청한 시점에만 한다.

이 프로젝트는 정적 HTML/CSS/JS와 Vercel Serverless Functions(`api/*.js`)로 구성된다. 별도 빌드 프레임워크나 데이터베이스는 없다.

## 3. 새 계정에서 해야 할 일

### 3-1. 코드와 Vercel 연결

1. 이 폴더 전체를 새 계정에서 열거나 Git 저장소로 옮긴다.
2. PowerShell에서 프로젝트 폴더로 이동한다.
3. 새 계정으로 Vercel CLI 로그인한다.

```powershell
npx.cmd vercel@latest login
```

4. Vercel 프로젝트 연결 여부를 확인한다. 새 Vercel 계정/팀에서 이어갈 경우에는 기존 프로젝트를 직접 이전받거나 새 프로젝트로 연결해야 한다.

```powershell
npx.cmd vercel@latest link
```

5. 아래 환경변수를 새 프로젝트의 Production / Preview / Development 환경에 각각 등록한다.
6. 로컬 확인 후 사용자가 요청할 때만 프로덕션 배포한다.

```powershell
npx.cmd vercel@latest --prod --yes --scope <새_팀_슬러그>
```

### 3-2. 환경변수 등록

키 값 자체는 이 문서나 소스에 기록하지 않는다. 기존 계정의 Vercel 환경변수 또는 기존 `.env.local`에서 값을 안전하게 옮긴다.

| 변수명 | 용도 | 사용하는 API |
| --- | --- | --- |
| `OPENAI_API_KEY` | 구조화된 여행 일정·비용·체크리스트 생성 | OpenAI Chat Completions |
| `TAVILY_API_KEY` | 식당·관광지·현지 팁·안전/입국 정보 웹 검색 | Tavily Search |
| `SERPAPI_API_KEY` | Google Flights 및 Google Hotels 기반 항공·숙박 가격/시간 후보 조회 | SerpApi |
| `GOOGLE_MAPS_API_KEY` | 서버 측 목적지 자동완성·장소 좌표 보완·Routes API 호출 | Places API (New), Routes API |
| `GOOGLE_MAPS_BROWSER_API_KEY` | 결과 화면 Google 지도 표시용 공개 브라우저 키 | Maps JavaScript API |
| `EXIM_AUTH_KEY` | 기준 환율 조회 및 결과 원화 환산 | 한국수출입은행 환율 API |

Vercel 대시보드에서 `Settings → Environment Variables`에 추가하거나 CLI를 쓸 수 있다.

```powershell
npx.cmd vercel@latest env add OPENAI_API_KEY production
npx.cmd vercel@latest env add TAVILY_API_KEY production
npx.cmd vercel@latest env add GOOGLE_MAPS_API_KEY production
npx.cmd vercel@latest env add GOOGLE_MAPS_BROWSER_API_KEY production
npx.cmd vercel@latest env add EXIM_AUTH_KEY production
```

서버 키와 브라우저 지도 키는 분리한다. `GOOGLE_MAPS_BROWSER_API_KEY`는 브라우저에서 로드되므로 Vercel 배포 도메인과 `http://localhost:*`로 **HTTP referrer 제한**을 걸고, API 제한은 Maps JavaScript API만 허용한다. `GOOGLE_MAPS_API_KEY`는 서버용으로 유지하고 Places API (New)·Routes API만 허용한다. API 키를 공유 채널에 한 번이라도 노출했다면 해당 공급자 콘솔에서 폐기/재발급하는 편이 안전하다.

### 3-3. Google Cloud 설정 확인

현재 랜딩 화면의 목적지 자동완성은 서버의 `api/places.js`를 거쳐 Google Places API (New)를 호출한다. Google Cloud 프로젝트에서 다음을 확인한다.

- `Places API (New)` 활성화
- API 키에 결제 계정 연결
- 키 제한: Vercel 배포 도메인 및 로컬 개발 도메인을 허용하고, 가능하면 API 제한도 Places API로 제한

결과 지도/동선 기능은 구현됐으며 아래 API가 모두 필요하다.

- `Maps JavaScript API`: 결과 페이지 지도 표시
- `Routes API` 또는 `Directions API`: 이동 시간·거리·경로 계산
- 필요 시 `Geocoding API`: 장소 좌표 보완

## 4. 파일별 구조

| 파일 | 역할 |
| --- | --- |
| `index.html` | 랜딩 페이지, 여행 조건 입력, Google 목적지 자동완성, 날짜 선택, 인원/스타일/밀도 입력, 환율 미리보기, 로딩 UI |
| `trip-result.html` | 결과 화면의 기본 레이아웃, 일정/경비/체크리스트/안전 카드 영역 |
| `assets/result-enhance.js` | `localStorage`의 생성 JSON을 일정표로 렌더링, 환율 재환산, 쇼핑/비상금 비용 수정, 총계·차트·경고 처리 |
| `assets/feature-clips.js` | 랜딩 홍보 카드의 시각 요소 처리 |
| `assets/feature-clips/*.png` | 동선/예산/준비/안전 카드용 이미지 |
| `assets/balance-trip-mark.png` | TripPlanner 로고 |
| `api/plan.js` | SerpApi 항공·숙박 가격 검색 + Tavily 현지 정보 검색 → OpenAI 구조화 JSON 생성 → 일정 정규화 API |
| `api/places.js` | Google Places 자동완성 프록시 API |
| `api/exchange.js` | 한국수출입은행 환율 API 프록시 |
| `api/route.js` | Google Routes API로 일자별 실제 도로 경로·거리·예상 이동시간 계산 |
| `api/maps-config.js` | Maps JavaScript API용 브라우저 키를 결과 화면에 제공 |
| `api/exchange-proxy.example.js` | 환율 프록시 예시 파일 |
| `trip-budget-coach-design.md` | 초기 사이트 디자인 초안 |

## 5. 현재 구현된 사용자 흐름

1. 사용자가 랜딩에서 목적지를 하나 이상 선택한다. 국가/도시 다중 선택이 가능하다.
2. 여행 시작일과 종료일을 고르고, `n박 n+1일`을 표시한다.
3. KRW 총 예산을 세 자리 콤마 형식으로 입력한다.
4. 성인/어린이 인원을 각각 조정하고 여행 유형을 선택한다.
5. 여행 스타일(관광·휴양·미식·쇼핑·힐링 등)을 하나 이상 선택하고 일정 밀도를 슬라이더로 고른다.
6. 입력 검증 후 `api/plan`에 요청하고 로딩 오버레이를 보여 준다.
7. API가 반환한 구조화 JSON을 `localStorage.balanceTripPlan`에 저장한 뒤 `trip-result.html`로 이동한다.
8. 결과 화면은 JSON을 일자별 표, 비용, 체크리스트, 안전 카드, 검색 출처로 렌더링한다.
9. 결과 화면의 날짜 탭을 누르면 숙소를 출발·도착점으로 하는 일자별 실제 도로 경로, 방문 순서, 거리와 예상 이동시간을 지도에 표시한다.

## 6. 입력 검증 규칙

- 목적지: 하나 이상 필수
- 기간: 시작일·종료일 필수
- 총 예산: 0원 초과 필수
- 인원: 총 1명 이상, 성인 최소 1명 필수 (어린이만 여행 불가)
- 여행 유형: 미선택 허용, 이 경우 `기타`로 처리
- 여행 스타일: 하나 이상 필수

## 7. AI/검색 계획 생성 로직

`api/plan.js`는 SerpApi Google Flights로 항공편, SerpApi Google Hotels로 날짜·인원별 숙소 가격을 검색한다. Google Maps는 실제 숙소 후보/지도 검증에 쓰고, Tavily는 식당·관광·현지 팁·안전/입국 정보에만 사용한다. 이 컨텍스트를 포함한 상세 프롬프트를 OpenAI에 전달한다.

생성 규칙의 중요한 부분은 다음과 같다.

- 첫날은 인천 출발(공항 이동/수속 포함)에서 시작한다.
- 마지막 날은 현지 공항 출발과 인천 귀국으로 마무리한다.
- 중간 날은 숙소 출발/숙소 복귀를 자연스럽게 포함하되, 억지로 넣지 않는다.
- 숙소 변경일에는 체크아웃/이동/체크인을 일정 흐름에 맞게 넣는다.
- 식사·숙소·관광지는 일반명 대신 가능한 한 실제 상호와 장소를 사용한다.
- 일정은 `시간순`이어야 하며, `항공편 기준 -3시간` 같은 상대 표현 대신 구체적인 시각을 사용한다.
- 왕복 항공권은 첫 출발일의 항공 항목 한 번에 반영한다.
- 숙박은 SerpApi의 도시별 check-in/check-out·인원 기준 `totalKrw`를 우선 사용하고, 이 값은 이미 전체 숙박 금액이므로 박 수를 다시 곱하지 않도록 프롬프트에 명시했다.
- 비용은 전 일행 기준이다. 인원/어린이 인원은 `trip` JSON에 포함된다.
- 응답은 JSON Schema 기반 구조화 출력이다.

Tavily 검색 출처는 결과 화면에서 상위 7개만 표시한다.

## 8. 결과 JSON에서 중요한 필드

대략적인 응답 형태는 아래와 같다.

```json
{
  "trip": {
    "destination": "도쿄",
    "dates": "2026-10-16 to 2026-10-18",
    "budgetKrw": 3000000,
    "adults": 2,
    "children": 2,
    "travelers": 4,
    "partyLabel": "성인 2명 · 어린이 2명 · 총 4명",
    "style": "관광, 힐링"
  },
  "days": [
    {
      "day": 1,
      "date": "2026-10-16",
      "theme": "출국 · 도착",
      "items": [
        {
          "startTime": "07:00",
          "place": "인천국제공항 제1여객터미널",
          "category": "항공",
          "costLocal": "₩450,000",
          "costKrw": 450000,
          "note": "왕복 항공권, 전 일행 기준"
        }
      ]
    }
  ],
  "budget": {
    "totalKrw": 0,
    "airfareKrw": 0,
    "lodgingKrw": 0,
    "foodKrw": 0,
    "transportKrw": 0,
    "shoppingKrw": 0,
    "emergencyKrw": 0
  }
}
```

`assets/result-enhance.js`가 일정표의 `costKrw`를 기준으로 최종 예산을 다시 계산하므로, AI가 임의로 배분한 예산보다 실제 일정 항목의 합계가 우선이다.

## 9. 결과 화면의 비용 처리

- 총 예상 지출과 사용자가 입력한 예산을 나란히 보여 준다.
- 항공·숙박·식비·교통·쇼핑·비상금으로 비용을 집계한다.
- 카테고리 비중은 도넛(파이) 차트로 표시한다.
- 입력 예산을 초과하면 한 번 경고를 띄운다.
- 쇼핑 및 일정 속 `비상금` 항목은 현지 통화 숫자를 입력해 비용을 수정할 수 있다.
- 경비 패널에는 일정과 별도로 비상금 예상 비용 입력/수정 버튼이 있다.
- 원화 예상값은 사용자가 별도 입력하지 않는다. 현지 통화 입력값을 환율로 환산한다.
- 수정값은 `localStorage.balanceTripPlan`에 저장돼 같은 브라우저 세션에서 유지된다.

### 환율 지원 통화

`api/exchange.js`와 결과 환산 로직은 현재 아래 통화를 사용한다.

- USD
- EUR
- JPY(100)
- GBP
- THB
- SGD

JPY는 한국수출입은행 API가 `JPY(100)` 단위로 반환하므로, 화면에서 입력한 엔화 금액은 환산할 때 100으로 나눠 처리한다.

## 10. 꼭 테스트할 시나리오

새 계정에서 환경변수를 등록한 뒤 아래를 한 번씩 확인한다.

1. 랜딩의 EUR/USD/JPY 환율이 로드되는지
2. 도시 입력 시 자동완성 결과가 열리고 여러 도시가 칩으로 추가되는지
3. 필수값 누락 시 올바른 오류가 표시되는지
4. 계획 생성 시 로딩 오버레이 후 결과 페이지로 이동하는지
5. 결과 일정표의 순서가 시간 오름차순인지
6. 첫날 인천 출국, 마지막 날 인천 귀국 흐름인지
7. 실제 식당/숙소/관광지가 구체적인 상호로 제시되는지
8. 현지 통화가 한국수출입은행 환율 기준으로 올바르게 환산되는지
9. 쇼핑과 비상금의 현지 통화 숫자 수정이 원화·총계·도넛 차트에 즉시 반영되는지
10. 총 예상 지출이 입력 예산보다 높을 경우 경고가 한 번 뜨는지
11. 검색 출처가 최대 7개만 표시되는지

## 11. 알려진 한계와 다음 개발 우선순위

현재 구현은 동작 가능한 MVP이지만, 여행 데이터 품질은 검색 결과와 LLM 생성 품질에 좌우된다. 다음을 우선 고려하면 좋다.

1. **실제 지도 동선**: 결과 일정에 장소 좌표를 저장하고 Maps JavaScript API + Routes API로 일자별 선/마커/이동시간을 표시한다.
2. **항공·숙소 가격 품질**: SerpApi 결과의 가격/날짜/인원 조건과 검색 시각을 계획 JSON에 더 엄격하게 남긴다. 장기적으로는 제휴/공식 예약 데이터 공급자를 추가할 수 있다.
3. **일정 검증 단계**: LLM 응답 직후 시간 순서, 도착/출발 흐름, 중복 장소, 숙소 체크인/체크아웃, 비용 누락을 코드로 검사하고 재요청한다.
4. **다도시 이동**: 도시 간 항공·철도·버스 이동을 별도 비용/시간 항목으로 더 명확하게 모델링한다.
5. **비용 편집 UI**: 현재 `prompt()` 기반 입력을 인라인 모달/숫자 필드로 교체하면 사용성이 좋아진다.
6. **저장 기능**: `localStorage`만 쓰므로 브라우저/기기 변경 시 계획이 사라진다. 로그인 및 DB 저장을 붙이기 전까지는 JSON 내보내기 기능이 유용하다.

## 12. 작업 방식 메모

- 사용자가 요청한 범위만 수정한다.
- 배포는 사용자가 “재배포/배포해줘”처럼 명시적으로 요청했을 때만 한다.
- 코드 수정은 `apply_patch`로 한다.
- 작업 후에는 최소한 아래 문법 검사를 실행한다.

```powershell
node --check assets/result-enhance.js
node --check api/plan.js
node --check api/exchange.js
```

- API 키나 인증키의 실제 값은 채팅, 코드, 문서, Git 커밋에 남기지 않는다.
