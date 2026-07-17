import Link from "next/link";

export default function Home() {
  return (
    <main className="home">
      {/* Decorative floating shapes behind the hero (aria-hidden, non-interactive). */}
      <div className="home__shapes" aria-hidden="true">
        <span className="home__shape home__shape--1" />
        <span className="home__shape home__shape--2" />
        <span className="home__shape home__shape--3" />
      </div>
      <div className="home__hero">
        <h1>
          <span className="home__brand">BUZZR</span>
        </h1>
        <p className="home__tag">Live, AI-generated multiplayer trivia.</p>
        <ul className="home__cta">
          <li>
            <Link className="cta-primary" href="/setup">
              🎤 Host a game
            </Link>
          </li>
          <li>
            <Link className="cta-secondary" href="/join">
              🏃 Join a game
            </Link>
          </li>
        </ul>
      </div>
    </main>
  );
}
