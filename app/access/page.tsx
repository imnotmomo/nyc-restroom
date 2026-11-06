import type { Metadata } from "next";
import { FinderRedirect } from "@/components/finder-redirect";

export const metadata: Metadata = {
  title: "Open the finder",
  description: "The Restroom Ready finder is open to everyone.",
  robots: { index: false, follow: false },
};

export default function AccessPage() {
  return <main id="main" className="simple-page container">
    <meta httpEquiv="refresh" content="0;url=/find/" />
    <FinderRedirect />
    <h1>The finder is open to everyone.</h1>
    <p><a href="/find/">Open the restroom finder</a></p>
  </main>;
}
