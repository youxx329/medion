-- ============================================================
-- MEDION Database Schema
-- PostgreSQL (Supabase)
-- ============================================================
-- 실행 순서 주의: FK 의존성 때문에 아래 순서를 지켜야 함
--   의약품 → 건기식 → 회원 → 상품 → 주문 → AI → 트리거 → 인덱스 → RLS
--
-- 공통 규칙
--   PK: uuid (IDOR 방어 + Supabase Auth 타입 일치)
--   문자열: text (varchar 대비 성능 차이 없음)
--   시각: timestamptz
--   공공데이터 날짜/기간: 형식이 불확실해 text 로 수용
-- ============================================================


-- ============================================================
-- 1. 의약품 마스터 (식약처 API 수집)
-- ============================================================

-- 성분. DUR 판정의 기준 단위
create table ingredients (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,   -- DUR 성분코드(D000147). upsert 키
  name_ko     text not null,
  name_en     text,
  ori_names   text,                   
  -- ORI 원문. 해당 DUR 규칙에 관련된 성분 코드 모음이라
  -- 복합 행에는 다른 성분의 M코드도 섞여 있음 → 매칭 키로 쓰지 않는다
  created_at  timestamptz not null default now()
);

-- 의약품 (e약은요).
-- efficacy~storage 는 식약처 문항 1~7 원문을 그대로 노출
-- etc_otc_code 는 e약은요에 없어 DUR품목정보에서 item_seq 로 찾아 update 함
--   값은 "전문의약품"/"일반의약품" 한글 문자열 (코드 아님)
--   null = DUR품목정보에 없는 품목 (금기 규칙이 등재되지 않았다는 뜻)
--   성분 정보 유무와는 별개다. 성분은 주성분 상세 API 에서 따로 가져온다
--   판매 상품은 약학정보원 확인 후 수동 입력해 null 이 없다
create table medications (
  id              uuid primary key default gen_random_uuid(),
  item_seq        text not null unique,   -- 품목기준코드. upsert 키
  name            text not null,
  company         text,
  etc_otc_code    text,                   -- 전문의약품 / 일반의약품 (DUR품목정보)
  efficacy        text,                   -- 문항1 효능
  usage_info      text,                   -- 문항2 사용법. usage 는 예약어라 개명
  warning         text,                   -- 문항3 주의사항경고. null 비율 높음
  precaution      text,                   -- 문항4 주의사항
  interaction     text,                   -- 문항5 상호작용
  side_effect     text,                   -- 문항6 부작용
  storage         text,                   -- 문항7 보관법
  pill_image_url  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 의약품 ↔ 성분 (N:M)
-- 공식 매핑 API 가 없어 스크립트로 구축한다.
--   주성분 상세(getDrugPrdtMcpnDtlInq07)  품목코드 + 원료코드(M) + 함량·단위
--   DUR 원본 ORI (MIX_TYPE='단일' 행만)   원료코드(M) → DUR 성분코드(D)
--   코드로 안 붙는 건 mcode-overrides.json (사람이 검수, Git 관리)
-- 계층: 약품 > 원료(M코드) > 성분(D코드)
-- ingredient_id null = DUR 성분 체계에 없는 원료. raw_name 으로 원문 보존
-- tamt_seq: 이층정(속방/서방층)·파스 규격처럼 총량 기준이 여러 개인 품목은
--   같은 성분이 다른 함량으로 여러 행 존재한다
create table medication_ingredients (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references medications(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete restrict, -- null = DUR 성분 테이블에 없는 원료
  raw_name text not null,                                           -- 원료명 원문 (MTRAL_NM)
  amount numeric,
  unit text not null,
  tamt_seq text not null default '1',                               -- 총량 기준 순번 (이층정 층별, 파스 규격별)
  amount_basis text,                                                -- 함량 기준 원문 ("1매 10×7㎠ 약 1,150.62mg 중")
  created_at timestamptz not null default now(),
    unique nulls not distinct (medication_id, raw_name, tamt_seq, ingredient_id)
);

-- 병용금기 (성분↔성분).
-- API 응답에 A→B, B→A 가 모두 존재하므로 수집 시 작은 id 를 A 로 정규화할 것
-- level 컬럼 없음: API 에 등급 필드가 없어 데이터 출처로 코드에서 판정
-- mix_type '복합' 은 저장만 하고 검사에서는 무시 (과잉 경고는 허용, 누락은 없음)
-- del_yn ★ '삭제' 는 폐지된 고시. 검사에서 반드시 제외할 것
--   수집 시 거르지 않고 저장한 뒤 쿼리에서 제외한다 (재수집 시 상태 갱신 가능)
-- remark 는 용량 조건 부연 ("methotrexate 1週에 15mg 이상 투여시").
--   복용량을 수집하지 않아 판정에는 쓰지 않고 안내 문구로만 노출
-- ★ 조회 시 (a=X and b=Y) or (a=Y and b=X) 양방향 모두 확인할 것
--   a/b 배정은 uuid 정렬 기준이지 약리학적 방향이 아니다
create table dur_interactions (
  id                 uuid primary key default gen_random_uuid(),
  ingredient_a_id    uuid not null references ingredients(id) on delete cascade,
  ingredient_b_id    uuid not null references ingredients(id) on delete cascade,
  mix_type_a         text,   -- 단일 / 복합
  mix_type_b         text,
  mix_a              text,   -- 복합 시 상대 성분 원문 (MIX)
  mix_b              text,
  prohibit_content   text,   -- 금기 사유. AI 실패 시 폴백으로 그대로 노출
  remark             text,   -- 조건부 금기 부연. 판정 미사용, 안내에만 노출
  del_yn             text,   -- 정상 / 삭제. '삭제'는 검사 제외
  notification_date  text,
  created_at         timestamptz not null default now(),
  unique (ingredient_a_id, ingredient_b_id)
);

-- 조건 금기. 임부 / 연령 / 노인주의 3개 API 통합
-- DUR_SEQ 는 API 별 독립 번호라 condition_type 까지 묶어야 유일해짐
-- form_name: 제형 조건. 아세트아미노펜은 서방정 계열만 12세 미만 금기이므로
--            제형을 무시하면 어린이 시럽에도 경고가 뜬다
-- 용량주의/투여기간주의 API 미사용: 복용량·이력을 수집하지 않아 판정 불가
-- del_yn ★ '삭제' 는 폐지된 고시. 적재 후 확인 결과 35건(임부 27/노인 5/연령 3) 2026.08.적재기준
--   저장 후 쿼리에서 제외한다. '정상'만 골라 넣으면 이후 폐지되어도
--   upsert 가 해당 행을 갱신하지 않아 유효한 금기로 남는다
-- remark 는 API 별 의미가 다르다 (병용금기=용량 조건, 임부금기=투여 경로 "경구")
--   판정에 쓰지 않고 안내 문구로만 노출
create table dur_conditions (
  id                 uuid primary key default gen_random_uuid(),
  dur_seq            text not null,
  ingredient_id      uuid not null references ingredients(id) on delete cascade,
  condition_type     text not null,   -- pregnancy / age / elderly
  condition_value    text,            -- AGE_BASE 원문 ("12세 미만", "65세 이상")
  grade              text,            -- 1등급 / 2등급 (임부금기만)
  form_name          text,
  prohibit_content   text,
  remark             text,            -- 판정 미사용, 안내에만 노출
  del_yn             text,            -- 정상 / 삭제
  notification_date  text,
  created_at         timestamptz not null default now(),
  unique (dur_seq, condition_type)
);


-- ============================================================
-- 2. 건강기능식품 마스터
-- ============================================================
-- medications 와 분리한 이유: 품목기준코드가 없어 upsert 키가 다르고,
-- DUR 성분 체계에 건기식 원료가 없어 검사 대상이 아니다.
-- 검증된 상호작용 데이터가 없는 영역이므로 AI 추론으로 경고를 만들지 않고
-- "검사 대상 아님"을 명시한다.
-- 판매 상품 관련 원료만 선별 수집.
create table health_foods (
  id             uuid primary key default gen_random_uuid(),
  sttemnt_no     text not null unique,  -- 품목제조신고번호. upsert 키
  name           text not null,
  company        text,
  registered_at  text,
  shelf_life     text,
  appearance     text,
  intake_method  text,
  storage        text,
  intake_caution text,
  functionality  text,
  base_standard  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);


-- ============================================================
-- 3. 회원
-- ============================================================

-- 프로필. auth.users 의 uuid 를 그대로 받아쓰므로 default 없음
-- 회원가입 시 자동 생성되지 않아 handle_new_user 트리거가 필요
-- is_pregnant 는 DUR 임부금기 검사가 읽는 값이라 null 을 허용하지 않음
-- 수유 여부는 대응하는 DUR 규칙 타입이 없어 수집하지 않는다
create table users (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  name              text,
  is_pregnant       boolean not null default false,
  birth_date        date,                  -- 연령금기는 만 나이 계산으로 판정
  marketing_agreed  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- 배송지
-- is_default 유일성은 DB 로 보장 불가. 애플리케이션에서 기존 값을 false 로 갱신할 것
create table addresses (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  recipient_name  text not null,
  phone           text not null,
  zipcode         text not null,
  address1        text not null,
  address2        text,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- 복용 중인 약. 병용금기 검사의 입력값
-- 처방받은 전문의약품과 구매 예정 일반의약품의 충돌을 잡는 것이 핵심 시나리오
--   예) 메토트렉세이트 등록 → 이부프로펜 구매 시 혈액학적 독성 경고
-- medication_id / custom_name 중 하나만 채워지며, 직접 입력은 "확인 불가"로 분리
-- unique 가 둘인 이유: null 은 서로 다른 값으로 취급되어
--   medication_id null 인 직접 입력 행의 중복이 첫 unique 로 막히지 않음
create table user_medications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references users(id) on delete cascade,
  medication_id  uuid references medications(id) on delete cascade,
  custom_name    text,
  created_at     timestamptz not null default now(),
  unique (user_id, medication_id),
  unique (user_id, custom_name),
  constraint medication_source_check check (
    (medication_id is not null and custom_name is null) or
    (medication_id is null and custom_name is not null)
  )
);


-- ============================================================
-- 4. 상품
-- ============================================================

-- 카테고리. parent_id 자기참조로 계층 표현 (null 이면 대분류)
-- sort_order 는 10 단위로 부여해 중간 삽입 시 재정렬을 피함
create table categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,   -- URL 용 영문 식별자 (/products?category=iron)
  -- 대분류·중분류 전체에서 유일 → 파라미터 하나로 둘 다 처리
  parent_id   uuid references categories(id) on delete cascade,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

-- 증상. 1인칭 구어체 ("머리가 아파요")
-- categories 와 분리: 카테고리는 상품당 1개(1:N), 증상은 상품당 다수(N:M)
-- icon 은 URL 이 아닌 식별자를 저장해 경로 변경 시 DB 수정이 불필요하게 함
create table symptoms (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  icon         text,
  category_id  uuid not null references categories(id) on delete cascade,
  -- 증상이 속한 분류. 현재 화면에서는 사용하지 않는다.
  --   랜딩: 고정 8개를 직접 지정
  --   카테고리 필터: 그 카테고리 상품에 달린 증상을 역산하므로 이 값과 무관
  -- 증상 전체 목록 페이지를 만들 경우 그룹핑 기준으로 쓴다.
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

-- 판매 상품
-- on delete restrict: 상품은 독립 자산이므로 카테고리·의약품 삭제에 연쇄되면 안 됨
--   (종속적 데이터인 증상·연결 테이블은 cascade)
-- medication_id / health_food_id 는 check 로 배타 관계를 DB 가 강제
--   → 상세 페이지에서 존재 여부만으로 안전하게 분기 가능
-- image_key: 상품 이미지 파일명 (= code). 경로는 코드에서 조립
-- dosage_form: 정제 / 캡슐 / 시럽·액상 / 산제·과립 / 외용 (화면 표시·필터용)
--   DUR form_name(서방정 등) 판정에는 쓰지 않는다. 표시 분류를 바꿔도 안전 판정이 흔들리지 않게
--   제형 판정은 의약품 원본 이름으로 한다
-- child_allowed ★ default 없음. 등록 시 명시 입력을 강제한다
--   기본값을 두면 미확인 상품이 자동으로 false 가 되어 판단을 건너뛰게 됨
--   표시·필터 용도이며 안전 판정은 DUR 성분 검사가 담당
-- sales_count 는 비정규화. 목록 조회마다 order_items 를 집계하면 느림
--  초기값은 seed 가 sales-tiers.json 등급으로 채움 (top 3 = 랜딩 베스트셀러, 중 = 매대 경험 기준)
-- 이후 결제 승인 시 서버에서 sales_count = sales_count + 1 로 원자적 증가
-- is_active 는 소프트 삭제. 하드 삭제 시 order_items 참조가 깨짐
create table products (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  price           int not null,
  code            text not null unique,    
    -- 상세 URL 식별자 (/products/[code])
    --   의약품 = item_seq, 건기식 = sttemnt_no
    --   uuid 는 seed 재실행 시 바뀌므로 URL 에 쓰지 않는다
  image_key       text not null,
  label_color     text,    -- 현재 미사용. 목업+라벨 방식 폐기 후 컬럼만 유지
  category_id     uuid not null references categories(id) on delete restrict,
  medication_id   uuid references medications(id) on delete restrict,
  health_food_id  uuid references health_foods(id) on delete restrict,
  dosage_form     text not null,
  child_allowed   boolean not null,        -- 소아 연령금기(제형 조건 반영)에 해당하지 않음
  -- "어린이용"이라는 뜻이 아니다. DUR 은 금지만 등재한다
  stock           int not null default 0,
  sales_count     int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint product_source_check check (
    (medication_id is not null and health_food_id is null) or
    (medication_id is null and health_food_id is not null)
  )
);

-- 상품 ↔ 증상 (N:M)
-- 저장 대상은 연결 정보이므로 양쪽 cascade.
-- 증상 삭제 시 연결 행만 사라지고 상품은 유지된다
create table product_symptoms (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  symptom_id  uuid not null references symptoms(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (product_id, symptom_id)
);


-- ============================================================
-- 5. 주문
-- ============================================================

-- 장바구니. 1인당 1개이므로 carts 테이블 불필요
-- is_selected 는 체크박스 상태. 새로고침 후에도 유지되어야 하므로 저장
-- 결제 시 is_active·재고를 서버에서 재검증할 것
create table cart_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  product_id   uuid not null references products(id) on delete cascade,
  quantity     int not null default 1,
  is_selected  boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, product_id)
);

-- 찜
create table wishlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, product_id)
);

-- 주문
-- user_id 만 restrict: 거래 기록은 보관 의무가 있어 탈퇴로 삭제되면 안 됨
--   (탈퇴는 users 소프트 삭제 + 개인정보 마스킹으로 처리)
-- 배송지를 복사 저장하는 이유: address_id 참조 시 배송지 수정·삭제가
--   과거 주문 내역까지 변경시킴
-- total_amount 는 항상 상품 금액만. 배송비 포함 여부를 조건부로 바꾸면
--   집계 쿼리의 의미가 깨진다
-- paid_amount 는 결제 검증 기준값. 토스 리다이렉트의 amount 는 조작 가능하므로
--   서버는 이 값과 대조하고 승인 요청도 이 값으로 보낼 것
-- dur_message 저장: AI 응답은 비결정적이라 재조회 시 문구가 달라짐
-- consent_checked 도 클라이언트를 신뢰하지 않고 서버에서 DUR 재검사 후 판단
create table orders (
  id               uuid primary key default gen_random_uuid(),
  order_number     text not null unique,   -- MD-20260813-0417
  user_id          uuid not null references users(id) on delete restrict,
  status           text not null default 'pending',
                   -- pending / paid / pharmacist_check / shipping / delivered / cancelled
  total_amount     int not null,           -- 상품 금액 합계
  shipping_fee     int not null default 0,
  paid_amount      int not null,           -- 실제 결제 금액
  recipient_name   text not null,          -- ↓ 배송지 스냅샷
  phone            text not null,
  zipcode          text not null,
  address1         text not null,
  address2         text,
  delivery_note    text,
  payment_key      text,
  dur_level        text,
  dur_message      text,
  consent_checked  boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- 주문 상품
-- product_id 가 set null 인 이유: cascade 면 주문 내역이 사라지고
--   restrict 면 상품을 영원히 삭제할 수 없다.
--   참조만 끊고 스냅샷으로 내역을 유지한다 (재주문만 비활성화)
-- 가격은 서버에서 product_id 로 재조회해 채울 것 (클라이언트 값 불신)
create table order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references orders(id) on delete cascade,
  product_id     uuid references products(id) on delete set null,
  product_name   text not null,   -- 주문 시점 스냅샷
  product_image  text,
  price          int not null,
  quantity       int not null,
  created_at     timestamptz not null default now()
);


-- ============================================================
-- 6. AI 상담
-- ============================================================

-- 상담 세션. product_id 가 있으면 해당 상품 컨텍스트 상담
-- title 은 첫 질문 앞부분을 잘라 저장 (목록 구분용)
-- updated_at 으로 최근 대화순 정렬
create table chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  product_id  uuid references products(id) on delete set null,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 대화 메시지. role 은 OpenAI API 형식 그대로
-- 시스템 프롬프트는 저장하지 않고 코드 상수로 관리
-- (프롬프트 수정 시 과거 대화 처리가 모호해지고, 사용자에게 보일 내용도 아님)
create table chat_messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references chat_sessions(id) on delete cascade,
  role        text not null,   -- user / assistant
  content     text not null,
  created_at  timestamptz not null default now()
);


-- ============================================================
-- 7. 함수 · 트리거
-- ============================================================

-- 회원가입 시 public.users 자동 생성
-- 앱 코드로 처리하면 소셜 로그인·대시보드 직접 추가 경로에서 누락되므로
-- DB 레벨에서 보장한다
-- security definer: RLS 우회를 위해 함수 소유자 권한으로 실행
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.users (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- updated_at 자동 갱신. before update 여야 값이 저장에 반영된다
create or replace function update_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_updated_at before update on users
  for each row execute function update_updated_at();
create trigger set_updated_at before update on addresses
  for each row execute function update_updated_at();
create trigger set_updated_at before update on medications
  for each row execute function update_updated_at();
create trigger set_updated_at before update on health_foods
  for each row execute function update_updated_at();
create trigger set_updated_at before update on products
  for each row execute function update_updated_at();
create trigger set_updated_at before update on cart_items
  for each row execute function update_updated_at();
create trigger set_updated_at before update on orders
  for each row execute function update_updated_at();
create trigger set_updated_at before update on chat_sessions
  for each row execute function update_updated_at();


-- ============================================================
-- 8. 인덱스
-- ============================================================
-- PK·UNIQUE 는 자동 생성되지만 FK 는 자동이 아니다.
-- 복합 인덱스는 선행 컬럼부터 사용되므로 후행 컬럼 단독 조회용은 별도로 생성.
-- ============================================================

create index idx_products_category on products(category_id);
create index idx_products_active on products(is_active);

create index idx_product_symptoms_symptom on product_symptoms(symptom_id);
create index idx_product_symptoms_product on product_symptoms(product_id);

create index idx_medication_ingredients_ingredient on medication_ingredients(ingredient_id);
create index idx_medication_ingredients_medication on medication_ingredients(medication_id);

create index idx_dur_interactions_a on dur_interactions(ingredient_a_id);
create index idx_dur_interactions_b on dur_interactions(ingredient_b_id);
create index idx_dur_conditions_ingredient on dur_conditions(ingredient_id);

create index idx_orders_user on orders(user_id);
create index idx_orders_created on orders(created_at desc);
create index idx_cart_items_user on cart_items(user_id);
create index idx_wishlists_user on wishlists(user_id);
create index idx_user_medications_user on user_medications(user_id);
create index idx_addresses_user on addresses(user_id);

create index idx_order_items_order on order_items(order_id);

create index idx_chat_sessions_user on chat_sessions(user_id);
create index idx_chat_messages_session on chat_messages(session_id);

create index idx_categories_parent on categories(parent_id);
create index idx_symptoms_category on symptoms(category_id);


-- ============================================================
-- 9. RLS
-- ============================================================
-- 클라이언트가 DB 를 직접 호출하는 구조이므로 DB 레벨에서 접근을 통제한다.
-- RLS 는 기본 비활성이며, 활성화 후 정책이 없으면 모든 접근이 차단된다.
--
-- using      기존 행 대상 검사
-- with check 삽입·수정될 값 대상 검사
--
-- service_role 키는 RLS 를 우회하므로 서버 코드에서는 권한 검사를 직접 수행할 것.
-- ============================================================

alter table ingredients enable row level security;
alter table medications enable row level security;
alter table medication_ingredients enable row level security;
alter table dur_interactions enable row level security;
alter table dur_conditions enable row level security;
alter table health_foods enable row level security;
alter table users enable row level security;
alter table addresses enable row level security;
alter table user_medications enable row level security;
alter table categories enable row level security;
alter table symptoms enable row level security;
alter table products enable row level security;
alter table product_symptoms enable row level security;
alter table cart_items enable row level security;
alter table wishlists enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;


-- 공개 읽기. 쓰기 정책이 없으므로 조회만 허용된다
create policy "public read" on categories             for select using (true);
create policy "public read" on symptoms               for select using (true);
create policy "public read" on products               for select using (true);
create policy "public read" on product_symptoms       for select using (true);
create policy "public read" on medications            for select using (true);
create policy "public read" on ingredients            for select using (true);
create policy "public read" on medication_ingredients for select using (true);
create policy "public read" on dur_interactions       for select using (true);
create policy "public read" on dur_conditions         for select using (true);
create policy "public read" on health_foods           for select using (true);


-- 본인 데이터
create policy "own data" on users            for all using (auth.uid() = id);
create policy "own data" on addresses        for all using (auth.uid() = user_id);
create policy "own data" on user_medications for all using (auth.uid() = user_id);
create policy "own data" on cart_items       for all using (auth.uid() = user_id);
create policy "own data" on wishlists        for all using (auth.uid() = user_id);
create policy "own data" on chat_sessions    for all using (auth.uid() = user_id);


-- 주문. 결제 기록이므로 수정·삭제 정책을 두지 않는다
-- 상태 변경은 서버에서 service_role 로 처리
create policy "own orders read" on orders
  for select using (auth.uid() = user_id);

create policy "own orders insert" on orders
  for insert with check (auth.uid() = user_id);


-- user_id 컬럼이 없는 테이블은 부모를 경유해 소유권 확인
create policy "own order items read" on order_items
  for select using (
    order_id in (select id from orders where user_id = auth.uid())
  );

create policy "own order items insert" on order_items
  for insert with check (
    order_id in (select id from orders where user_id = auth.uid())
  );

create policy "own chat messages" on chat_messages
  for all using (
    session_id in (select id from chat_sessions where user_id = auth.uid())
  );
