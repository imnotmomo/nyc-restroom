"use client";
import { useEffect } from "react";
import Script from "next/script";
const id = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
export function Analytics() {
  if (!id || !/^G-[A-Z0-9]+$/.test(id)) return null;
  return <><Script src={`https://www.googletagmanager.com/gtag/js?id=${id}`} strategy="afterInteractive"/><Script id="google-analytics" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());var p=new URLSearchParams(location.search),q=new URLSearchParams();['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k){var v=(p.get(k)||'').toLowerCase();if(v&&v.length<=120&&/^[a-z0-9 _-]+$/.test(v))q.set(k,v);});gtag('config','${id}',{send_page_view:true,page_location:location.origin+location.pathname+(q.toString()?'?'+q.toString():''),allow_google_signals:false});`}</Script></>;
}
export function SignupConfirmation() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const raw=sessionStorage.getItem("rr-signup");
      if(!raw)return;
      const {id:eventId,source}=JSON.parse(raw);
      if(typeof eventId!=="string"||!["home","conditions","entry-route","dated-reports"].includes(source)||sessionStorage.getItem(`rr-counted-${eventId}`))return;
      const complete=()=>{sessionStorage.setItem(`rr-counted-${eventId}`,"1");sessionStorage.removeItem("rr-signup");};
      if(!id||!/^G-[A-Z0-9]+$/.test(id)){complete();return;}
      const w=window as typeof window & {gtag?:(...args:unknown[])=>void};
      let attempts=0;
      const send=()=>{
        if(w.gtag){w.gtag("event","generate_lead",{source_page:source,method:"email_waitlist"});complete();}
        else if(++attempts<50)timer=setTimeout(send,100);
      };
      send();
    } catch { /* Storage or analytics availability does not change the saved signup. */ }
    return ()=>{if(timer)clearTimeout(timer);};
  }, []);
  return null;
}
