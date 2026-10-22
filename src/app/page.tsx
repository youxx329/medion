import Container from '../components/layout/Container';

export default function Home() {
  return (
    <main>
      <section className="bg-surface">
        {' '}
        {/* 배경은 화면 끝까지 */}
        <Container>베스트셀러</Container> {/* 내용은 1200 안 */}
      </section>
    </main>
  );
}
