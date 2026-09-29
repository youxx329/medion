import Link from 'next/link';

export default function Logo() {
  return (
    <Link href="/" aria-label="MediON 홈" className="text-h1 font-bold tracking-tight">
      <span className="text-ink">Medi</span>
      <span className="text-primary">ON</span>
    </Link>
  );
}
