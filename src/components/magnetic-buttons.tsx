"use client";

import { useEffect } from "react";

/** Distance (px) around a button within which it starts to follow the cursor. */
const REACH = 56;
/** Share of the cursor offset the button follows. */
const PULL = 0.3;

/**
 * Makes every `.btn-solid` button lean towards the cursor. One shared listener, no per-button state:
 * it only writes the `--mx` / `--my` CSS variables, and the transition lives in CSS.
 * Inactive on touch screens, for disabled buttons and when the visitor prefers reduced motion.
 */
export function MagneticButtons() {
  useEffect(() => {
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!fine.matches) return;

    let frame = 0;
    let x = -9999;
    let y = -9999;
    let active = new Set<HTMLElement>();

    const release = (el: HTMLElement) => {
      el.style.removeProperty("--mx");
      el.style.removeProperty("--my");
    };
    const releaseAll = () => {
      active.forEach(release);
      active = new Set();
    };

    const update = () => {
      frame = 0;
      if (reduce.matches) return releaseAll();

      const next = new Map<HTMLElement, [number, number]>();
      document.querySelectorAll<HTMLElement>(".btn-solid").forEach((el) => {
        if (el.matches(":disabled, [aria-disabled='true']")) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.bottom < -REACH || r.top > window.innerHeight + REACH) return;

        // The box may already be mid-pull, so measure its resting centre.
        const [tx = 0, ty = 0] = getComputedStyle(el).translate.split(" ").map((v) => parseFloat(v) || 0);
        const dx = x - (r.left + r.width / 2 - tx);
        const dy = y - (r.top + r.height / 2 - ty);
        if (Math.abs(dx) > r.width / 2 + REACH || Math.abs(dy) > r.height / 2 + REACH) return;

        const maxX = r.width > 280 ? 4 : 10; // wide buttons move less so they never look jumpy
        const maxY = 6;
        next.set(el, [Math.max(-maxX, Math.min(maxX, dx * PULL)), Math.max(-maxY, Math.min(maxY, dy * PULL))]);
      });

      active.forEach((el) => {
        if (!next.has(el)) release(el);
      });
      next.forEach(([mx, my], el) => {
        el.style.setProperty("--mx", `${mx.toFixed(1)}px`);
        el.style.setProperty("--my", `${my.toFixed(1)}px`);
      });
      active = new Set(next.keys());
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      x = e.clientX;
      y = e.clientY;
      schedule();
    };
    const onLeave = () => {
      x = y = -9999;
      schedule();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", schedule);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
      releaseAll();
    };
  }, []);

  return null;
}
