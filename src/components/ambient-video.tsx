"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useDataSaver, useReducedMotion } from "@/lib/use-media";
import { cx } from "./ui";

/**
 * Decorative looping video (muted, no audio track).
 *
 * - The poster is a real next/image, so the section looks finished immediately and costs nothing extra.
 * - The video downloads only when it nears the viewport, plays only while visible, and pauses when scrolled away.
 * - It stays a still image for visitors who prefer reduced motion or are saving data.
 */
export function AmbientVideo({
  src,
  poster,
  alt = "",
  sizes,
  className,
  objectPosition = "center",
  priority = false,
}: {
  src: string;
  poster: string;
  alt?: string;
  sizes: string;
  className?: string;
  objectPosition?: string;
  priority?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const saver = useDataSaver();
  const allowed = !reduced && !saver;
  const [near, setNear] = useState(false);
  const [armed, setArmed] = useState(false); // once the video has been near the viewport its file stays attached
  const [playing, setPlaying] = useState(false);

  // Start fetching shortly before the video scrolls into view.
  useEffect(() => {
    const el = wrap.current;
    if (!el || !allowed) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setNear(entry.isIntersecting);
        if (entry.isIntersecting) setArmed(true);
      },
      { rootMargin: "200px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [allowed]);

  // Play only while on screen.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (near && allowed) void v.play().catch(() => {});
    else v.pause();
  }, [near, allowed]);

  return (
    <div ref={wrap} className={cx("absolute inset-0 overflow-hidden", className)}>
      <Image src={poster} alt={alt} fill priority={priority} sizes={sizes} className="object-cover" style={{ objectPosition }} />
      {allowed && (
        <video
          ref={video}
          src={armed ? src : undefined}
          muted
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          tabIndex={-1}
          onPlaying={() => setPlaying(true)}
          className={cx("absolute inset-0 h-full w-full object-cover transition-opacity duration-1000", playing ? "opacity-100" : "opacity-0")}
          style={{ objectPosition }}
        />
      )}
    </div>
  );
}
