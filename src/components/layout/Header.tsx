import { ChevronDown, Search, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import Logo from './Logo';

export default function Header() {
  return (
    <header>
      <div className="mx-auto flex h-20 w-full max-w-content items-center px-6 justify-between">
        <Logo />

        <nav className="ml-auto flex items-center gap-9 text-body text-ink">
          <button
            type="button"
            className="flex items-center gap-1 hover:text-primary cursor-pointer"
          >
            카테고리
            <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button type="button" className="hover:text-primary">
            AI 약사 상담
          </button>

          <label className="flex h-9 w-60 items-center gap-2 rounded-full bg-surface px-4">
            <Search className="size-4 text-muted" strokeWidth={1.5} aria-hidden />
            <input
              type="search"
              placeholder="약 이름·증상 검색"
              aria-label="상품 검색"
              className="w-full bg-transparent outline-none placeholder:text-muted"
            />
          </label>

          <Link href="/login" className="hover:text-primary">
            로그인
          </Link>
          <Link href="/cart" aria-label="장바구니" className="hover:text-primary">
            <ShoppingBag className="size-5" strokeWidth={1.5} />
          </Link>
        </nav>
      </div>
    </header>
  );
}
