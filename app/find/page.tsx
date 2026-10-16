import type { Metadata } from "next";
import { FirebaseAccountProvider } from "@/components/firebase-account";
import { RestroomExplorer } from "@/components/finder/explorer";
import "./finder.css";
import { restrooms } from "@/lib/restrooms";

export const metadata: Metadata = {
  title: "Find a restroom in NYC",
  description: `Explore ${restrooms.length.toLocaleString("en-US")} city-listed restroom locations across NYC. Read the dated NYC Open Data source details and see what is still unknown.`,
};

export default function FindPage() {
  return <FirebaseAccountProvider><RestroomExplorer /></FirebaseAccountProvider>;
}
