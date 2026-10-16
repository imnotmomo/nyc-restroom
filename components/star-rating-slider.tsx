"use client";

import { useId, type CSSProperties, type KeyboardEvent } from "react";
import { Star } from "lucide-react";
import styles from "./star-rating-slider.module.css";

export function StarRatingSlider({ value, onChange, disabled = false }: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const current = value ?? 1;
  function choose(next: number) {
    if (disabled || !Number.isFinite(next)) return;
    onChange(Math.max(1, Math.min(5, Math.round(next * 2) / 2)));
  }
  function keydown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const next = event.key === "Home" ? 1 : event.key === "End" ? 5
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? current + 0.5
        : event.key === "ArrowLeft" || event.key === "ArrowDown" ? current - 0.5 : null;
    if (next === null) return;
    event.preventDefault();
    choose(next);
  }
  return <div className={`${styles.slider}${disabled ? ` ${styles.disabled}` : ""}`}>
    <label className={styles.label} htmlFor={id}>Cleanliness rating</label>
    <div className={styles.heading}>
      <div className={styles.stars} aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => {
        const fill = value === null ? 0 : Math.min(1, Math.max(0, value - star + 1));
        return <span className={styles.star} key={star}><Star size={24} strokeWidth={1.5} /><span className={styles.fill} style={{ width: `${fill * 100}%` }}><Star size={24} strokeWidth={1.5} fill="currentColor" /></span></span>;
      })}</div>
      <output id={`${id}-selection`} htmlFor={id} className={styles.value} aria-live="polite">{value === null ? "No rating selected" : `${value.toFixed(1)} / 5`}</output>
    </div>
    <input id={id} className={styles.range} type="range" min={1} max={5} step={0.5} value={current} disabled={disabled}
      aria-valuetext={value === null ? "No rating selected. Choose a rating." : `${value.toFixed(1)} out of 5 stars`}
      aria-describedby={`${id}-help ${id}-selection`}
      style={{ "--rating-progress": `${value === null ? 0 : (value - 1) / 4 * 100}%` } as CSSProperties}
      onPointerDown={(event) => { if (value === null) choose(Number(event.currentTarget.value)); }}
      onKeyDown={keydown} onChange={(event) => choose(Number(event.currentTarget.value))} />
    <div className={styles.ends} aria-hidden="true"><span>1 star</span><span>5 stars</span></div>
    <p className={styles.help} id={`${id}-help`}>Drag or use arrow keys in half-star steps.</p>
  </div>;
}
