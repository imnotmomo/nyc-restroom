import { ArrowDown, ArrowUpRight, DoorOpen, Footprints, Droplets, Clock3, MapPin, Info, Minus, Plus } from "lucide-react";
import { Signup } from "./signup";
import { pages, pagePath, type PageKey } from "@/lib/pages";

export function Header({ landing = false }: { landing?: boolean }) {
  return <><a href="#main" className="skip-link">Skip to content</a><header className="site-header"><a href="/" className="logo-link" aria-label="Restroom Ready home"><img src="/brand/lockup.svg" width="244" height="42" alt="Restroom Ready"/></a><div className="header-right"><a className="header-cta" href="/find/">Browse the map <MapPin size={16}/></a><span className="city-label"><span className="status-dot"/> MADE FOR NEW YORK</span><a className="header-cta" href={landing ? "#join" : "/#join"}>Get early access <ArrowUpRight size={16}/></a></div></header></>;
}
const facts = [
  { key: "entry", icon: DoorOpen, title: "Entry", value: "Purchase required", note: "Code on the receipt", date: "Example visitor · observed Oct 6", unknown: false },
  { key: "route", icon: Footprints, title: "Route inside", value: "One level down", note: "Stairs to restroom: yes", date: "Example visitor · observed Oct 4", unknown: false },
  { key: "condition", icon: Droplets, title: "Conditions", value: "Soap & paper reported", note: "Floor condition: not reported", date: "Example visitor · observed Oct 6", unknown: false },
];
function MapIllustration({ focus }: { focus: PageKey }) {
  return <div className="map-card" aria-label="Illustrated NYC map and example restroom listing"><div className="map-top"><span><MapPin size={14}/> A CLOSER LOOK</span><span className="example-label">Illustrative map</span></div><div className="map-scene" aria-hidden="true"><svg viewBox="0 0 540 350" className="city-map"><defs><pattern id="blocks" width="46" height="63" patternTransform="rotate(-24)" patternUnits="userSpaceOnUse"><rect width="46" height="63" fill="#eef2f3"/><rect x="5" y="5" width="36" height="53" rx="2" fill="#dfe6e8"/></pattern></defs><rect width="540" height="350" fill="#d9e6ed"/><path d="M-50 10 L315 -75 L525 370 L80 400 Z" fill="url(#blocks)"/><path d="M167 77 L224 51 L273 164 L215 189 Z" fill="#c9d7c4"/><path d="M299 -30 L470 355" stroke="#fafcfd" strokeWidth="10"/><path d="M8 248 L431 47" stroke="#fafcfd" strokeWidth="8"/><path d="M94 315 L470 137" stroke="#fafcfd" strokeWidth="8"/><text x="168" y="123" transform="rotate(-24 168 123)" className="map-street">WEST SIDE</text><text x="432" y="216" transform="rotate(-67 432 216)" className="river-label">HUDSON RIVER</text><circle cx="278" cy="155" r="29" fill="#2b59c3" opacity=".11"/><circle cx="278" cy="155" r="17" fill="#2b59c3" stroke="white" strokeWidth="4"/><text x="278" y="161" textAnchor="middle" fill="white" fontSize="17" fontFamily="sans-serif" fontWeight="700">R</text><circle cx="148" cy="230" r="10" fill="#fff" stroke="#7b919b" strokeWidth="3"/><circle cx="369" cy="249" r="10" fill="#fff" stroke="#7b919b" strokeWidth="3"/><path d="M155 231 L210 206 L188 157 L258 165" fill="none" stroke="#2b59c3" strokeDasharray="5 5" strokeWidth="2"/></svg><div className="map-caption"><span className="map-location-dot"/> NEW YORK, NY <span>Concept preview</span></div></div><div className="listing"><div className="listing-heading"><div><span className="overline">EXAMPLE LISTING</span><h3>Corner café</h3><p>Illustrative location · Manhattan</p></div><span className="listing-r"><img src="/brand/mark.svg" width="36" height="36" alt=""/></span></div><div className="listing-facts">{facts.map(f=><div key={f.key} className={`fact-row ${focus === "entry-route" && ["entry","route"].includes(f.key) || focus === "conditions" && f.key === "condition" ? "highlight" : ""}`}><f.icon size={18}/><div><span className="fact-label">{f.title}</span><strong>{f.value}</strong><span className="fact-detail">{f.note}</span><span className="fact-source">{f.date}<br/>Submitted: same example date</span></div></div>)}</div><div className="unknown"><Info size={15}/><span>Elevator <strong>Not reported</strong></span></div><div className="listing-bottom"><Clock3 size={14}/><span>Dates belong to each fact. Details can change.</span></div></div></div>;
}
const groups = {
  home: [{icon:DoorOpen, n:"01",title:"Can I enter?",body:"Public, customers only, or a purchase first. Know the rule before the trip."},{icon:Footprints,n:"02",title:"Can I reach it?",body:"Floor, stairs, and the route after the front door. The inside matters, too."},{icon:Droplets,n:"03",title:"What was reported?",body:"Supplies, stalls, and conditions, with their source and observation date."}],
  conditions: [{icon:Droplets,n:"01",title:"The supplies",body:"Soap and toilet paper get their own fields. Missing information stays ‘Not reported.’"},{icon:DoorOpen,n:"02",title:"The space",body:"Stall and floor reports describe what a visitor saw, rather than a vague score."},{icon:Clock3,n:"03",title:"The observation",body:"See when a condition was observed. A fresh paper report doesn’t update the whole listing."}],
  "entry-route": [{icon:DoorOpen,n:"01",title:"Permission to enter",body:"Purchase, customer, guest, key, and code requirements have a place in the listing."},{icon:Footprints,n:"02",title:"The route inside",body:"Restroom floor and stairs stay separate from the building’s front entrance."},{icon:Info,n:"03",title:"What’s still unknown",body:"No elevator report? We say so. You decide what works for your particular trip."}],
  "dated-reports": [{icon:Clock3,n:"01",title:"Observed, then submitted",body:"A visit date and a posting date tell different stories. Both should stay visible."},{icon:Info,n:"02",title:"An honest blank",body:"An unreported detail is missing information, rather than a reassuring assumption."},{icon:Plus,n:"03",title:"Room for disagreement",body:"Two visitors can report different things. Keep their observations and dates together."}],
};

const cityPhotos = {
  home: {
    file: "bryant-park", width: 1280, height: 853,
    alt: "Bryant Park's lawn and tree-lined paths surrounded by Midtown buildings, photographed from above.",
    place: "Bryant Park", date: "May 26, 2022", author: "© 2022 Larry D. Moore",
    source: "https://commons.wikimedia.org/wiki/File:Bryant_Park_from_One_Vanderbilt_New_York_City_2022.jpg",
    title: "Between one stop and the next.",
    body: "A walk, a commute, an afternoon outside. Start with a place on the map, then check the details that matter for your trip.",
  },
  conditions: {
    file: "nypl-exterior", width: 1280, height: 576,
    alt: "Stone arch and entrance doors of the New York Public Library Main Branch.",
    place: "New York Public Library · Main Branch exterior", date: "July 31, 2024", author: "Kidfly182",
    source: "https://commons.wikimedia.org/wiki/File:New_York_Public_Library_Main_Branch_Exterior.jpg",
    title: "The details are on the inside.",
    body: "Soap, paper, floor, and stalls each deserve a clear report. Keep the observation date next to the detail, so you have more to go on than a building photo.",
  },
  "entry-route": {
    file: "bryant-restroom-side", width: 1280, height: 960,
    alt: "Stone exterior of the Bryant Park restroom, seen from 42nd Street with pedestrians nearby.",
    place: "Bryant Park restroom · 42nd Street view", date: "December 28, 2023", author: "SnowFire",
    source: "https://commons.wikimedia.org/wiki/File:Bryant_Park_Restroom_2023_side.jpg",
    title: "Getting there is the first step.",
    body: "A place on the map is a starting point. Entry permission, stairs, and the route inside are separate details to check before choosing where to go.",
  },
  "dated-reports": {
    file: "bryant-restroom-back", width: 1280, height: 960,
    alt: "Rear exterior of the Bryant Park restroom with Midtown buildings and pedestrians in the background.",
    place: "Bryant Park restroom · exterior", date: "December 28, 2023", author: "SnowFire",
    source: "https://commons.wikimedia.org/wiki/File:Bryant_Park_Restroom_2023_back.jpg",
    title: "Every observation has a moment.",
    body: "A photograph captures one moment. So does a visitor report. Look for when each detail was observed, as well as when it was submitted.",
  },
};

function CityPhoto({ kind }: { kind: PageKey }) {
  const photo = cityPhotos[kind];
  return <section className="city-context container" aria-labelledby="city-context-title">
    <figure className="city-context-photo">
      <div className="city-context-image"><img
        src={`/images/nyc/${photo.file}-1280.webp`}
        srcSet={`/images/nyc/${photo.file}-640.webp 640w, /images/nyc/${photo.file}-1280.webp 1280w`}
        sizes="(max-width: 719px) calc(100vw - 40px), (max-width: 1128px) calc((100vw - 80px) / 2), 500px"
        width={photo.width} height={photo.height} alt={photo.alt}
        loading="lazy" decoding="async"
      /></div>
      <figcaption><span>{photo.place} · {photo.date}</span><span>Photo: <a href={photo.source}>{photo.author} / Wikimedia Commons</a> · <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a> · resized; displayed crop.</span></figcaption>
    </figure>
    <div className="city-context-copy"><p className="eyebrow">NEW YORK CITY · CONTEXT PHOTO</p><h2 id="city-context-title">{photo.title}</h2><p>{photo.body}</p><a href="/find/" className="city-context-link">Explore the restroom map <ArrowUpRight size={16}/></a></div>
  </section>;
}
export function Footer({ explore = true }: { explore?: boolean }) { return <footer className="footer"><div><a href="/" aria-label="Restroom Ready home"><img src="/brand/lockup.svg" width="199" height="34" alt="Restroom Ready"/></a><p>A little more certainty for the city.</p></div><div className="footer-links">{explore && <><a href="/conditions/">Conditions</a><a href="/entry-route/">Entry & route</a><a href="/dated-reports/">Dated reports</a></>}<a href="/find/">Find a restroom</a><a href="/privacy/">Privacy</a><span>Five Girls · NYC</span></div></footer>; }
export function Landing({ kind }: { kind: PageKey }) {
 const p=pages[kind];
 return <><Header landing/><main id="main"><section className="hero container"><div className="hero-copy"><p className="eyebrow"><span className="eyebrow-rule"/>{p.eyebrow}</p><h1>{p.title.split("\n").map((t,i)=><span key={t} className={i===1 ? "blue" : ""}>{t}</span>)}</h1><p className="hero-description">{p.description}</p><div id="join" className="hero-signup"><Signup source={kind}/></div><div className="hero-footnote"><span className="small-plus">+</span> In development. Help shape what comes next.</div></div><div className="hero-visual"><div className="visual-index"><span>FIELD NOTES / {p.number}</span><span>NEW YORK CITY</span></div><MapIllustration focus={kind}/><div className="visual-foot"><span>{p.label}</span><span>KNOW BEFORE YOU GO.</span></div></div></section><div className="strip"><div className="container strip-inner"><span><MapPin size={16}/> Built around New York.</span><span><Minus size={18}/> Specific facts. Visible unknowns.</span><span><Clock3 size={16}/> A date for each detail.</span></div></div><CityPhoto kind={kind}/><section className="details container"><div className="section-intro"><p className="eyebrow">{p.emphasis}</p><h2>{p.section.split("\n").map(t=><span key={t}>{t}</span>)}</h2><p>{p.audience}</p></div><div className="benefit-grid">{groups[kind].map(g=><article className="benefit" key={g.n}><div className="benefit-top"><g.icon size={23}/><span>{g.n}</span></div><h3>{g.title}</h3><p>{g.body}</p></article>)}</div></section><section className="approach container"><div className="approach-label"><ArrowDown size={19}/><span>THE IDEA IS SIMPLE</span></div><div><h2>Choose with the details<br/>in front of you.</h2><p>{p.note} We’re starting small, and building around the choices people actually make. The preview above shows the information we want to make easier to find.</p><p className="approach-small">Our first version will focus on a small part of NYC. Join early to help shape the details that matter.</p></div></section><section className="closing container"><div><p className="eyebrow">THE NEXT TIME YOU NEED TO GO</p><h2>A little less guesswork.<br/><span className="blue">A little more to go on.</span></h2></div><div><p>Be among the first to try Restroom Ready when it’s ready.</p><Signup source={kind} compact/></div></section></main><Footer explore={kind==="home"}/></>;
}
