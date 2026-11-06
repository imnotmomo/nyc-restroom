import type { Metadata } from "next";
import { FirebaseAccountProvider } from "@/components/firebase-account";
import { ModerationDashboard } from "@/components/admin/moderation-dashboard";
import "./admin.css";

export const metadata: Metadata = {
  title: "Moderation",
  description: "Restricted contribution review for Restroom Ready moderators.",
  robots: { index: false, follow: false },
};

export default function AdminPage() {
  return <FirebaseAccountProvider trackSignups={false}><ModerationDashboard /></FirebaseAccountProvider>;
}
