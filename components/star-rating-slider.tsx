"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Star } from "lucide-react";
import styles from "./star-rating-slider.module.css";

export function StarRatingSlider({ value, onChange, disabled = false }: {
  value: number | null;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const activePointer = useRef<number | null>(null);
  const current = value ?? 1;

  function stopDragging(element: HTMLInputElement | null) {
    const pointer = activePointer.current;
    activePointer.current = null;
    if (pointer === null || !element) return;
    try { if (element.hasPointerCapture(pointer)) element.releasePointerCapture(pointer); } catch { /* The browser may already have released this pointer. */ }
  }
  useEffect(() => {
    if (disabled) stopDragging(input.current);
  }, [disabled]);
  useEffect(() => () => stopDragging(input.current), []);

  function choose(next: number) {
    if (disabled || !Number.isFinite(next)) return;
    onChange(Math.max(1, Math.min(5, Math.round(next * 2) / 2)));
  }
  function chooseAtPointer(event: PointerEvent<HTMLInputElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return;
    const position = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    const cellWidth = bounds.width / 5;
    const cell = Math.min(4, Math.floor(position / cellWidth));
    const half = position - cell * cellWidth < cellWidth / 2 ? 0.5 : 1;
    choose(cell + half);
  }
  function pointerDown(event: PointerEvent<HTMLInputElement>) {
    if (disabled || !event.isPrimary || event.button !== 0 || activePointer.current !== null) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    activePointer.current = event.pointerId;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer guards still prevent unrelated moves. */ }
    chooseAtPointer(event);
  }
  function pointerMove(event: PointerEvent<HTMLInputElement>) {
    if (disabled || activePointer.current !== event.pointerId) return;
    if (event.buttons === 0) { stopDragging(event.currentTarget); return; }
    event.preventDefault();
    chooseAtPointer(event);
  }
  function pointerUp(event: PointerEvent<HTMLInputElement>) {
    if (activePointer.current !== event.pointerId) return;
    event.preventDefault();
    if (!disabled && event.button === 0) chooseAtPointer(event);
    stopDragging(event.currentTarget);
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
    <div className={styles.control}>
      <input ref={input} id={id} className={styles.range} type="range" min={1} max={5} step={0.5} value={current} disabled={disabled}
        aria-valuetext={value === null ? "No rating selected. Choose a rating." : `${value.toFixed(1)} out of 5 stars`}
        aria-describedby={`${id}-help ${id}-selection`}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerCancel={(event) => { if (activePointer.current === event.pointerId) stopDragging(event.currentTarget); }}
        onLostPointerCapture={(event) => { if (activePointer.current === event.pointerId) activePointer.current = null; }}
        onBlur={(event) => stopDragging(event.currentTarget)} onClick={(event) => event.preventDefault()}
        onKeyDown={keydown} onChange={(event) => choose(Number(event.currentTarget.value))} />
      <div className={styles.stars} aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => {
        const fill = value === null ? 0 : Math.min(1, Math.max(0, value - star + 1));
        return <span className={styles.cell} key={star}><span className={styles.star}><Star size={32} strokeWidth={1.5} /><span className={styles.fill} style={{ width: `${fill * 100}%` }}><Star size={32} strokeWidth={1.5} fill="currentColor" /></span></span></span>;
      })}</div>
    </div>
    <output id={`${id}-selection`} htmlFor={id} className={styles.value} aria-live="polite">{value === null ? "No rating selected" : `${value.toFixed(1)} / 5`}</output>
    <p className={styles.help} id={`${id}-help`}>Slide across the stars or tap a half-star. Arrow keys adjust by half a star.</p>
  </div>;
}
