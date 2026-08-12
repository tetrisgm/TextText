import Image from "next/image";
import Link from "next/link";

// One static response for every unavailable public path. Do not derive copy or
// links from the requested URL: doing so turns the 404 itself into a structure
// oracle for private folders and legacy route shapes.
export default function TenantNotFound() {
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
        Back to the blog
      </Link>
    </main>
  );
}
