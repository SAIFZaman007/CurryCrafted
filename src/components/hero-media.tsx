"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useDataSaver, useMediaQuery, useReducedMotion } from "@/lib/use-media";
import { cx } from "./ui";

/*
 * "Living photograph" hero: one still (the LCP image), brought to life with
 *   - a slow camera push,
 *   - a masked duplicate layer that lets the spices float while the bowl stays put,
 *   - canvas steam and drifting golden sparks (screen-blended),
 *   - an optional cinematic video that fades in on capable devices,
 *   - film grain and a vignette.
 * Everything pauses off-screen, in a hidden tab, under reduced motion, or from the visible control (WCAG 2.2.2).
 */

const STILL = "/images/hero-living.jpg";
const ALT = "A bowl of butter chicken steaming, surrounded by floating spices on a deep green background";

/* ---------------------------------------------------------------- canvas FX */

function sprite(size: number, stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) r.addColorStop(at, color);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  return c;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

type Puff = { x: number; y: number; r: number; vy: number; ph: number; sw: number; life: number; t: number; a: number };
const newPuff = (t = 0): Puff => ({ x: rnd(0.62, 0.8), y: rnd(0.25, 0.3), r: rnd(0.025, 0.045), vy: rnd(0.012, 0.02), ph: rnd(0, 6.28), sw: rnd(0.006, 0.016), life: rnd(9, 15), t, a: rnd(0.5, 1) });

function HeroFx({ running, steam }: { running: boolean; steam: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const steamRef = useRef(steam);
  useEffect(() => {
    steamRef.current = steam;
  }, [steam]);

  useEffect(() => {
    const cv = canvas.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;

    const puff = sprite(128, [[0, "rgba(255,255,255,.55)"], [0.4, "rgba(255,248,240,.22)"], [1, "rgba(255,255,255,0)"]]);
    const dot = sprite(32, [[0, "rgba(255,225,170,1)"], [0.3, "rgba(255,190,110,.5)"], [1, "rgba(255,190,110,0)"]]);
    let W = 0;
    let H = 0;
    const resize = () => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.width = Math.round(cv.offsetWidth * d);
      H = cv.height = Math.round(cv.offsetHeight * d);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const small = cv.offsetWidth < 900; // fewer sprites on phones
    const puffs = Array.from({ length: small ? 24 : 46 }, () => {
      const p = newPuff();
      p.t = rnd(0, p.life);
      return p;
    });
    const sparks = Array.from({ length: small ? 24 : 42 }, () => ({ x: rnd(0, 1), y: rnd(0, 1), r: rnd(0.0018, 0.005), vx: rnd(-0.004, 0.004), vy: rnd(-0.008, -0.002), ph: rnd(0, 6.28), sp: rnd(0.4, 1.2) }));

    let raf = 0;
    let last = performance.now();
    let clock = 0;
    let steamAlpha = steamRef.current ? 1 : 0;
    let visible = true;
    let tabVisible = !document.hidden;

    const draw = (dt: number) => {
      ctx.clearRect(0, 0, W, H);
      steamAlpha += ((steamRef.current ? 1 : 0) - steamAlpha) * Math.min(1, dt * 2.5);
      if (steamAlpha > 0.01) {
        for (let i = 0; i < puffs.length; i++) {
          let s = puffs[i];
          s.t += dt;
          if (s.t > s.life) puffs[i] = s = newPuff();
          const k = s.t / s.life;
          const fade = Math.sin(Math.PI * Math.min(k, 1));
          const x = s.x + Math.sin(s.ph + s.t * 0.5) * s.sw * (1 + k * 3) + k * 0.01;
          const y = s.y - s.vy * s.t;
          const r = s.r * (1 + k * 2.6) * W;
          ctx.globalAlpha = Math.pow(fade, 1.4) * s.a * 0.55 * steamAlpha;
          ctx.drawImage(puff, x * W - r, y * H - r, r * 2, r * 2);
        }
      }
      for (const p of sparks) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y < -0.02) p.y = 1.02;
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(clock * p.sp + p.ph));
        const r = p.r * W;
        ctx.globalAlpha = tw * 0.8;
        ctx.drawImage(dot, p.x * W - r, p.y * H - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
    };

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      clock += dt;
      draw(dt);
      raf = requestAnimationFrame(frame);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (running && visible && tabVisible) {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };

    if (!running) draw(0); // a single still frame of sparks
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    io.observe(cv);
    const onVis = () => {
      tabVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVis);
    sync();

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [running]);

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen" />;
}

/* ------------------------------------------------------------------- stage */

export function HeroMedia() {
  const reduced = useReducedMotion();
  const saver = useDataSaver();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [paused, setPaused] = useState(false);
  const running = !reduced && !paused;

  // The film is an enhancement: fetched after the page is idle, and only where motion, width and data allow.
  const [armed, setArmed] = useState(false);
  const [filmOn, setFilmOn] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const filmAllowed = wide && !reduced && !saver;
  useEffect(() => {
    if (!filmAllowed) return;
    type Idle = { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (n: number) => void };
    const w: Idle = window;
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => setArmed(true), { timeout: 2500 }) : window.setTimeout(() => setArmed(true), 1200);
    return () => {
      if (w.requestIdleCallback) w.cancelIdleCallback?.(id);
      else window.clearTimeout(id);
    };
  }, [filmAllowed]);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (running) void v.play().catch(() => {});
    else v.pause();
  }, [running, armed]);

  return (
    <div className={cx("hero-stage", !running && "is-paused")} data-paused={!running}>
      <div className="hero-cam">
        <Image src={STILL} alt={ALT} fill priority loading="eager" sizes="(min-width: 1024px) 100vw, 160vw" className="hero-layer" />
        <Image src={STILL} alt="" aria-hidden="true" fill loading="eager" sizes="(min-width: 1024px) 100vw, 160vw" className="hero-layer hero-float" />
        {filmAllowed && armed && (
          <video
            ref={video}
            src="/videos/hero-cinematic.mp4"
            poster="/videos/hero-cinematic-poster.jpg"
            muted
            loop
            playsInline
            preload="auto"
            aria-hidden="true"
            tabIndex={-1}
            onPlaying={() => setFilmOn(true)}
            className={cx("hero-layer hero-film", filmOn && running && "is-on")}
          />
        )}
        <HeroFx running={running} steam={!(filmOn && running)} />
      </div>
      <div className="hero-grain" aria-hidden="true" />
      <div className="hero-vignette" aria-hidden="true" />
      <div className="hero-scrim" aria-hidden="true" />

      {!reduced && (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          className="absolute bottom-24 right-4 z-20 inline-flex h-10 items-center gap-2 rounded-full border border-cream/25 bg-forest/60 px-4 text-xs font-semibold tracking-wide text-cream backdrop-blur transition-colors hover:border-gold hover:text-gold focus-visible:outline-gold lg:bottom-32 lg:right-8"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
            {paused ? <path d="M4 2.5v11l9-5.5z" /> : <path d="M3.500 2h3.200v12H3.500zM9.300 2h3.200v12H9.300z" />}
          </svg>
          {paused ? "Play motion" : "Pause motion"}
        </button>
      )}
    </div>
  );
}
