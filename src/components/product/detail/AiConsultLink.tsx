import Image from 'next/image';
import Link from 'next/link';

type AiConsultLinkProps = {
  code: string;
  isDrug: boolean;
};

export default function AiConsultLink({ code, isDrug }: AiConsultLinkProps) {
  const subject = isDrug ? '이 약' : '이 제품';
  const scope = isDrug ? '복용법' : '섭취 방법';

  return (
    <section aria-label="AI 약사 상담" className="flex items-start gap-3">
      <Image
        src="/images/icons/124-message-1.svg"
        alt=""
        width={60}
        height={60}
        aria-hidden
        className="shrink-0"
      />
      <div className="flex flex-1 flex-col gap-3 rounded-lg rounded-tl-sm border border-line bg-white px-4 py-3.5 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm leading-relaxed text-ink/80">
          {subject}, 더 자세히 알고 싶으면 물어보세요.
          <br />
          식약처 정보를 바탕으로 {scope}부터 주의사항까지 쉽게 알려드릴게요.
        </p>
        <Link
          href={`/consult?product=${code}`}
          className="shrink-0 self-start rounded-sm bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ink/90 sm:self-auto"
        >
          물어보기
        </Link>
      </div>
    </section>
  );
}
