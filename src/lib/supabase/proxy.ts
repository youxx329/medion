import { Database } from '@/src/types/database.types';
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// 로그인해야 들어갈 수 있는 경로 (하위 경로 포함)
const PROTECTED_PATHS = ['/mypage', '/checkout', '/cart'];

// 이미 로그인한 사람은 올 필요 없는 경로
const AUTH_PATHS = ['/login'];

// '/cart' 는 '/cart', '/cart/...' 만 걸리고 '/cartoon' 같은 건 안 걸리게
function matchesPath(pathname: string, paths: string[]) {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

// 리다이렉트 응답에도 갱신된 쿠키와 캐시 금지 헤더를 옮겨 담는다.
// 안 옮기면 방금 갱신한 토큰이 브라우저에 저장되지 않아 세션이 꼬인다.
function redirectWithSession(url: URL, sessionResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url);

  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });

  ['cache-control', 'expires', 'pragma'].forEach((key) => {
    const value = sessionResponse.headers.get(key);
    if (value) redirectResponse.headers.set(key, value);
  });

  return redirectResponse;
}

export async function updateSession(request: NextRequest) {
  // 기본 응답: "그대로 통과"
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        // 토큰이 갱신되면 라이브러리가 이 함수를 부른다
        setAll(cookiesToSet, headers) {
          // ① 요청 쪽 쿠키 교체 → 이번 요청의 서버 컴포넌트가 새 토큰을 읽음
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

          // ② 바뀐 요청으로 응답을 다시 만들고, 응답 쪽에도 쿠키 기록 → 브라우저에 저장됨
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );

          // ③ 토큰이 담긴 응답이 CDN에 캐시돼 다른 사람한테 가지 않게 막는 헤더
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          );
        },
      },
    }
  );

  // 주의: createServerClient 와 getClaims 사이에 다른 코드를 넣지 말 것.
  // getClaims 가 토큰 서명을 검증하고, 만료가 임박했으면 먼저 갱신한다(→ setAll 호출).
  const { data, error } = await supabase.auth.getClaims();

  // 세션이 아예 없으면 error 는 null. 여기 걸리는 건 토큰이 있었는데 검증·갱신이 실패한 경우
  // (위조 토큰, 이미 쓴 리프레시 토큰, Supabase 장애 등) → 원인 추적용으로 남긴다
  if (error) {
    console.error('[proxy] 세션 검증 실패:', request.nextUrl.pathname, error.message);
  }

  // 검증에 실패하면(에러 포함) 로그인 안 된 것으로 취급 → 보호 경로는 막힌다
  const isLoggedIn = !error && Boolean(data?.claims);

  const { pathname, search } = request.nextUrl;

  // 비로그인 + 보호 경로 → /login?next=원래경로
  if (!isLoggedIn && matchesPath(pathname, PROTECTED_PATHS)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${search}`);
    return redirectWithSession(loginUrl, supabaseResponse);
  }

  // 로그인 상태로 /login → 홈
  if (isLoggedIn && matchesPath(pathname, AUTH_PATHS)) {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return redirectWithSession(homeUrl, supabaseResponse);
  }

  // 통과: setAll 이 마지막으로 만든 응답을 그대로 돌려줘야 쿠키가 유지된다
  return supabaseResponse;
}
