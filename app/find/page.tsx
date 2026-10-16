import type { Metadata } from "next";
import { FirebaseAccountProvider } from "@/components/firebase-account";
import { RestroomExplorer } from "@/components/finder/explorer";
import "./finder.css";

export const metadata: Metadata = {
  title: "Find a restroom in NYC",
  description: "Explore 55 NYC Open Data restroom locations around Columbia, Harlem, and northern Central Park. Read the source details and see what is still unknown.",
};

export default function FindPage() {
  return <FirebaseAccountProvider><RestroomExplorer /></FirebaseAccountProvider>;
}
