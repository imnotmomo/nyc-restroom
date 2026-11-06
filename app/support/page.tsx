import { Header, Footer } from "@/components/landing";

export const metadata = { title: "Support · Restroom Ready" };

export default function Support() {
  return <>
    <Header />
    <main id="main" className="simple-page privacy container">
      <p className="eyebrow">RESTROOM READY SUPPORT</p>
      <h1>How can we help?</h1>
      <p>For app help, inaccurate listings, inappropriate comments or account questions, email <a href="mailto:zc2856@columbia.edu">zc2856@columbia.edu</a>.</p>
      <h2>Report a problem</h2>
      <p>Include the restroom’s name and a short description of the issue. If possible, include your app version and iOS version. Please keep passwords, sign-in codes, private restroom codes and other people’s personal information out of your message.</p>
      <p>We review reports about inappropriate content and can remove comments or suspend public contributions from abusive accounts. Listings and visitor observations are dated; hours, conditions, codes and entry rules can change.</p>
      <h2>Account and data</h2>
      <p>In the iPhone app, open Account and choose Delete account to remove your account and private data. You will verify with your existing Apple or Google account. If you cannot access the app, email support for help; do not send your password.</p>
      <p>Read <a href="/privacy/">Privacy and data use</a> for the information we store, how public contributions work and what account deletion removes.</p>
      <h2>Try Restroom Ready</h2>
      <p>You can <a href="/find/">browse the NYC restroom map</a> without an account. The iPhone app is currently available through <a href="https://testflight.apple.com/join/PxWSpdJ8">TestFlight</a>.</p>
    </main>
    <Footer explore={false} />
  </>;
}
