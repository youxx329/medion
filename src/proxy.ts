import { updateSession } from '@/src/lib/supabase/proxy';
import { type NextRequest } from 'next/server';

// Next 16 규칙: 파일명 proxy.ts + 함수명 proxy (예전 middleware.ts / middleware)
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // 아래로 시작하거나 끝나는 경로는 proxy 를 건너뜀:
    // _next/static(빌드된 JS·CSS·폰트), _next/image(이미지 최적화), favicon.ico, 이미지 파일
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
