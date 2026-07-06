import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <Image
        className="not-found-gif"
        src="/travolta-looking-around.gif"
        alt="John Travolta as Vincent Vega looking around a room, finding nothing"
        width={480}
        height={204}
        priority
        unoptimized
      />
      <h1 className="not-found-title">This page does not exist.</h1>
      <Link className="not-found-home-link" href="/">
        Go to the home page
      </Link>
    </main>
  );
}
