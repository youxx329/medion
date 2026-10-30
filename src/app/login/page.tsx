import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '로그인',
};

// 3-1 리다이렉트 확인용 임시 페이지. 3-2 회원가입·로그인에서 교체.
export default function LoginPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 py-20 text-center">
      <h1 className="text-2xl font-bold">로그인</h1>
      <p className="mt-2 text-muted">준비 중이에요.</p>
    </main>
  );
}
