import { Header, Footer } from "@/components/landing";
import { SignupConfirmation } from "@/components/analytics";
import { ArrowUpRight } from "lucide-react";
export const metadata={title:"Thanks for your interest",robots:{index:false,follow:false}};
export default function ThankYou(){return <><Header/><main id="main" className="simple-page container"><p className="eyebrow">RESTROOM READY · NYC</p><h1>Thanks for being<br/><span className="blue">part of the beginning.</span></h1><p>We’re building a more useful way to choose a restroom. If you just joined the waitlist, your email has been saved. We’ll be in touch when there’s something to try.</p><a href="/" className="text-link">Back to Restroom Ready <ArrowUpRight size={18}/></a><SignupConfirmation/></main><Footer explore={false}/></>;}
