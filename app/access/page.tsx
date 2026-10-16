import type { Metadata } from "next";
import { ArrowUpRight, LockKeyhole } from "lucide-react";
import { Header, Footer } from "@/components/landing";
import { FinderAccessForm } from "@/components/finder-access";
import "./access.css";

export const metadata: Metadata = {
  title: "Team access",
  description: "Enter the shared passcode to open the live Restroom Ready finder, or try the public interactive demo.",
  robots: { index: false, follow: false },
};

export default function AccessPage() {
  return <><Header/><main id="main" className="simple-page container finder-access-page">
    <section className="finder-access-card" aria-labelledby="finder-access-title">
      <p className="eyebrow"><LockKeyhole size={16}/> LIVE FINDER · PROTECTED ACCESS</p>
      <h1 id="finder-access-title">Team access<span className="blue">.</span></h1>
      <p>Enter the shared passcode to open the live finder.</p>
      <FinderAccessForm/>
      <div className="finder-access-demo"><p>Want to try it first?</p><a href="/demo/">Try the interactive demo <ArrowUpRight size={17}/></a><span>One example location. No account needed.</span></div>
    </section>
  </main><Footer explore={false}/></>;
}
