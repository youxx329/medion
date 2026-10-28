import Image from 'next/image';
import Link from 'next/link';

export default function DurNotice() {
  return (
    <section
      aria-label="복약 안내"
      className="flex items-center gap-3 rounded-xl border border-line px-4 py-3"
    >
      <Image
        src="/images/icons/034-vitamins.svg"
        alt=""
        width={20}
        height={20}
        aria-hidden
        className="shrink-0"
      />
      <p className="flex-1 text-sm leading-relaxed text-muted">
        복용 중인 약을 등록하면 이 약과 함께 먹을 때 주의할 점을 알려드려요.
      </p>
      <Link
        href="/login"
        className="shrink-0 text-sm font-semibold text-ink underline underline-offset-4 hover:text-primary"
      >
        로그인 ›
      </Link>
    </section>
  );
}
