import type { Metadata } from "next";
import { DemoExplorer } from "@/components/demo/explorer";
import "../find/finder.css";
import "./demo.css";

export const metadata: Metadata = { title: "Interactive demo", description: "Try the Restroom Ready sample map. Save, rate, edit codes, and add a local example. Changes stay in your demo session.", robots: { index: false, follow: false } };

export default function DemoPage() { return <DemoExplorer />; }
