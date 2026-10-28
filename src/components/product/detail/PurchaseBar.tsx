'use client';

import { Minus, Plus } from 'lucide-react';
import { useState } from 'react';

type PurchaseBarProps = {
  stock: number;
  price: number;
};

export default function PurchaseBar({ stock, price }: PurchaseBarProps) {
  const [qty, setQty] = useState(1);

  const soldOut = stock === 0;
  const canDecrease = !soldOut && qty > 1;
  const canIncrease = !soldOut && qty < stock;
  const total = (price * (soldOut ? 0 : qty)).toLocaleString();

  const decrease = () => setQty((q) => Math.max(q - 1, 1));
  // 줄이기: 지금 값에서 1 빼는데, 1보다 작아지면 1로
  const increase = () => setQty((q) => Math.min(q + 1, stock));
  // 늘리기: 지금 값에 1 더하는데, 재고보다 커지면 재고로

  const handleAddToCart = () => {
    // 장바구니 카드에서 연결
  };
  const handleBuyNow = () => {
    // 주문서 카드에서 연결
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-3 border-t border-line bg-white px-4 pt-3 pb-3 md:static md:z-auto md:mt-4 md:border-0 md:p-0 lg:static lg:z-auto lg:mt-4 lg:border-0 lg:p-0">
      {/* 수량: 모바일은 [수량조절 ... 총액], 데스크톱은 회색 박스 [수량 ... 수량조절] */}
      <div className="flex items-center justify-between md:rounded-md lg:rounded-md lg:bg-[#F2F7F6] md:bg-[#F2F7F6] md:p-4 lg:p-4">
        <span className="hidden text-[15px] md:inline lg:inline">수량</span>

        <div className="flex items-center rounded-lg border border-line	 bg-white">
          <button
            type="button"
            onClick={decrease}
            disabled={!canDecrease}
            aria-label="수량 빼기"
            className="flex size-11 items-center justify-center border-r border-line	 text-ink disabled:cursor-not-allowed disabled:text-disabled"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <span aria-live="polite" className="min-w-11 text-center font-semibold tabular-nums">
            {soldOut ? 0 : qty}
          </span>
          <button
            type="button"
            onClick={increase}
            disabled={!canIncrease}
            aria-label="수량 더하기"
            className="flex size-11 items-center justify-center border-l border-line text-ink disabled:cursor-not-allowed disabled:text-disabled"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>

        <p className="text-lg font-bold tabular-nums md:hidden lg:hidden">{total}원</p>
      </div>

      {/* 총 상품금액: 데스크톱만 */}
      <div className="hidden items-baseline justify-between px-0.5 md:flex lg:flex">
        <span className="text-[15px] text-muted">총 상품금액</span>
        <span className="text-[22px] font-bold tabular-nums">{total}원</span>
      </div>

      {/* 버튼 */}
      {soldOut ? (
        <button
          type="button"
          disabled
          className="h-14 rounded-xl bg-skeleton font-semibold text-muted"
        >
          품절
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleAddToCart}
            className="h-14 rounded-md border border-ink bg-white font-semibold text-ink transition-colors hover:bg-surface"
          >
            장바구니
          </button>
          <button
            type="button"
            onClick={handleBuyNow}
            className="h-14 rounded-md bg-ink font-semibold text-white transition-colors hover:bg-ink/90"
          >
            바로 구매
          </button>
        </div>
      )}
    </div>
  );
}
