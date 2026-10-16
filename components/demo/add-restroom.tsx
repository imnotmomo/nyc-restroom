"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { MapPin, X } from "lucide-react";
import { createDemoState, type DemoVenueInput, type DemoVisibility } from "@/lib/demo-state";

export function AddDemoRestroom({ onAdd, onClose }: { onAdd: (input: DemoVenueInput) => boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [isPublic, setPublic] = useState(false);
  const [isAccessible, setAccessible] = useState(false);
  const [code, setCode] = useState("");
  const [visibility, setVisibility] = useState<DemoVisibility>("private");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!latitude.trim() || !longitude.trim()) { setError("Enter both coordinates, or use the sample address and pin."); return; }
    if (!onAdd({ name, address, latitude: Number(latitude), longitude: Number(longitude), isPublic, isAccessible, code, visibility })) setError("Check the name, address, NYC coordinates, and optional code before adding the sample.");
  }
  return <dialog ref={dialog} className="finder-log-dialog demo-add-dialog" aria-labelledby="demo-add-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><header className="finder-log-heading"><div><span className="finder-overline">Interactive demo</span><h2 id="demo-add-title"><MapPin size={22} />Log a restroom</h2></div><button type="button" className="finder-log-close" onClick={onClose} aria-label="Close log restroom form" autoFocus><X size={20} /></button></header><div className="finder-log-body"><p className="finder-log-intro">Add a local sample to try the flow. It stays in this session.</p><form className="finder-log-form" onSubmit={submit}>
    <div className="finder-log-field"><label htmlFor="demo-add-name">Restroom or venue name <span>Required</span></label><input id="demo-add-name" value={name} maxLength={120} required onChange={(event) => setName(event.target.value)} /></div>
    <div className="finder-log-field"><label htmlFor="demo-add-address">Street address or park location <span>Required</span></label><input id="demo-add-address" value={address} maxLength={240} required onChange={(event) => setAddress(event.target.value)} /></div>
    <button type="button" className="finder-secondary-button" onClick={() => { const sample = createDemoState().venues[0]; setAddress(sample.address); setLatitude(String(sample.latitude)); setLongitude(String(sample.longitude)); setError(null); }}>Use sample address and pin</button>
    <div className="finder-log-coordinate-grid"><div className="finder-log-field"><label htmlFor="demo-add-latitude">Latitude <span>Required</span></label><input id="demo-add-latitude" type="number" step="any" min="40.49" max="40.93" required value={latitude} onChange={(event) => setLatitude(event.target.value)} /></div><div className="finder-log-field"><label htmlFor="demo-add-longitude">Longitude <span>Required</span></label><input id="demo-add-longitude" type="number" step="any" min="-74.26" max="-73.68" required value={longitude} onChange={(event) => setLongitude(event.target.value)} /></div></div>
    <div className="demo-add-flags"><label><input type="checkbox" checked={isPublic} onChange={(event) => setPublic(event.target.checked)} />Public entry · sample attribute</label><label><input type="checkbox" checked={isAccessible} onChange={(event) => setAccessible(event.target.checked)} />Accessible · sample attribute</label></div>
    <div className="finder-log-field"><label htmlFor="demo-add-code">Restroom code <span>Optional</span></label><input id="demo-add-code" value={code} maxLength={40} autoComplete="off" onChange={(event) => setCode(event.target.value)} /></div>
    {code.trim() && <fieldset className="finder-passcode-visibility"><legend>Who can see this sample code?</legend>{(["private", "public"] as const).map((value) => <label className={`finder-passcode-choice${visibility === value ? " is-selected" : ""}`} key={value}><input type="radio" name="demo-add-code-visibility" checked={visibility === value} onChange={() => setVisibility(value)} /><span><strong>{value === "private" ? "Only me" : "Everyone"}</strong><span>{value === "private" ? "Also adds the sample to Saved." : "Simulate sharing within the demo."}</span></span></label>)}</fieldset>}
    {error && <p className="finder-form-error" role="alert">{error}</p>}<div className="finder-log-actions"><button type="submit" className="finder-primary-button">Add sample restroom</button><button type="button" className="finder-secondary-button" onClick={onClose}>Cancel</button></div>
  </form></div></dialog>;
}
