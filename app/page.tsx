import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>AI Trivia</h1>
      <p>Live, AI-generated multiplayer trivia.</p>
      <ul>
        <li>
          <Link href="/setup">Host a game</Link>
        </li>
        <li>
          <Link href="/join">Join a game</Link>
        </li>
      </ul>
    </main>
  );
}
