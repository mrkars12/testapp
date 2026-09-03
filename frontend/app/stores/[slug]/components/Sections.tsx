"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Play, Pause } from "lucide-react";

// ════════════════════════════════════════════════════════════════════════════
// SLIDER KEYFRAMES — injected per slider instance via <style>
//
// ROOT CAUSE of black flash:
//   CSS `transition` animates FROM the previous computed value.
//   When a slide appears from display:none there is no previous value,
//   so the browser starts the animation from 0% → flash.
//   CSS @keyframes ALWAYS start from the explicit `from` value regardless
//   of DOM state → zero black flash, no flicker.
// ════════════════════════════════════════════════════════════════════════════
const SLIDER_KEYFRAMES = `
  @keyframes sliderEnterRight { from{transform:translateX(100%)} to{transform:translateX(0)} }
  @keyframes sliderEnterLeft  { from{transform:translateX(-100%)} to{transform:translateX(0)} }
  @keyframes sliderExitLeft   { from{transform:translateX(0)} to{transform:translateX(-100%)} }
  @keyframes sliderExitRight  { from{transform:translateX(0)} to{transform:translateX(100%)} }
  @keyframes sliderProgress   { from{width:0%} to{width:100%} }
  @keyframes sliderProgressV  { from{height:0%} to{height:100%} }
  @keyframes kenBurns         { from{transform:scale(1) translate(0,0)} to{transform:scale(1.08) translate(-1%,-1%)} }
  @keyframes fadeInUp         { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
  @keyframes spotEnterRight   { from{transform:translateX(calc(-50% + 120%))} to{transform:translateX(-50%)} }
  @keyframes spotEnterLeft    { from{transform:translateX(calc(-50% - 120%))} to{transform:translateX(-50%)} }
  @keyframes spotExitLeft     { from{transform:translateX(-50%)} to{transform:translateX(calc(-50% - 120%))} }
  @keyframes spotExitRight    { from{transform:translateX(-50%)} to{transform:translateX(calc(-50% + 120%))} }
  @keyframes spotFadeIn       { from{opacity:0} to{opacity:1} }
  @keyframes spotFadeOut      { from{opacity:1} to{opacity:0} }
`;

// ════════════════════════════════════════════════════════════════════════════
// HEIGHT MAP
// ════════════════════════════════════════════════════════════════════════════
const SLIDESHOW_HEIGHT_MAP: Record<string, { desktop: string; mobile: string }> = {
  small:      { desktop: "h-64",      mobile: "h-56" },
  medium:     { desktop: "h-96",      mobile: "h-72" },
  large:      { desktop: "h-[500px]", mobile: "h-80" },
  fullscreen: { desktop: "h-screen",  mobile: "h-[85vh]" },
};

function getHeight(key: string, isMobile: boolean) {
  const map = SLIDESHOW_HEIGHT_MAP[key] || SLIDESHOW_HEIGHT_MAP.large;
  return isMobile ? map.mobile : map.desktop;
}

// ════════════════════════════════════════════════════════════════════════════
// useSwipe — unified touch/pointer drag hook
// ════════════════════════════════════════════════════════════════════════════
function useSwipe({
  total,
  onNext,
  onPrev,
  onTap,
}: {
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onTap?: () => void;
}) {
  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const delta  = useRef(0);
  const moved  = useRef(false);
  const ignore = useRef(false);
  const [offset, setOffset] = useState(0);

  const onStart = useCallback((e: React.PointerEvent | React.TouchEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && typeof el.closest === "function" && el.closest("a,button")) {
      ignore.current = true;
      startX.current = null;
      return;
    }
    ignore.current = false;
    const t = "touches" in e ? e.touches[0] : e;
    startX.current = t.clientX;
    startY.current = t.clientY;
    delta.current  = 0;
    moved.current  = false;
  }, []);

  const onMove = useCallback((e: React.PointerEvent | React.TouchEvent) => {
    if (startX.current === null) return;
    const t = "touches" in e ? e.touches[0] : e;
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) moved.current = true;
    delta.current = dx;
    setOffset(dx);
  }, []);

  const onEnd = useCallback(() => {
    if (ignore.current) { ignore.current = false; return; }
    if (startX.current === null) return;
    if (moved.current && total > 1) {
      if (delta.current < -60) onNext();
      else if (delta.current > 60) onPrev();
    } else if (!moved.current) {
      onTap?.();
    }
    startX.current = null;
    delta.current  = 0;
    moved.current  = false;
    setOffset(0);
  }, [total, onNext, onPrev, onTap]);

  const onCancel = useCallback(() => {
    ignore.current = false;
    startX.current = null;
    delta.current  = 0;
    moved.current  = false;
    setOffset(0);
  }, []);

  return { offset, onStart, onMove, onEnd, onCancel };
}

// ════════════════════════════════════════════════════════════════════════════
// Arrow button — FIX #1: icon direction corrected, FIX #2: position corrected
// ════════════════════════════════════════════════════════════════════════════
function Arrow({
  dir,
  style,
  onClick,
}: {
  dir: "prev" | "next";
  style?: string;
  onClick: () => void;
}) {
  const cls =
    style === "minimal"
      ? "text-white hover:text-white/70 p-2"
      : style === "square"
        ? "bg-white/20 backdrop-blur-sm border border-white/30 hover:bg-white/30 text-white p-3 rounded-lg"
        : "bg-white/20 backdrop-blur-sm border border-white/30 hover:bg-white/30 text-white p-3 rounded-full";
  const sz = style === "minimal" ? 32 : 22;

  // ✅ FIX #1: prev arrow on the LEFT, next arrow on the RIGHT (RTL layout)
  // ✅ FIX #2: prev shows ChevronRight (→ go back in RTL), next shows ChevronLeft (← go forward in RTL)
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={dir === "prev" ? "Previous" : "Next"}
      className={`absolute ${dir === "prev" ? "right-4" : "left-4"} top-1/2 -translate-y-1/2 z-20 flex items-center justify-center transition-all duration-200 hover:scale-110 ${cls}`}
    >
      {dir === "prev"
        ? <ChevronRight size={sz} strokeWidth={2.5} />
        : <ChevronLeft  size={sz} strokeWidth={2.5} />}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SlideIndicators — UNIFIED navigation indicator used by EVERY slider style.
// ════════════════════════════════════════════════════════════════════════════
function SlideIndicators({
  slides,
  current,
  go,
  settings,
  orientation = "horizontal",
  className = "",
  paused = false,
  inline = false,
}: {
  slides: any[];
  current: number;
  go: (i: number) => void;
  settings: any;
  orientation?: "horizontal" | "vertical";
  className?: string;
  paused?: boolean;
  inline?: boolean;
}) {
  const total = slides.length;
  if (settings.showDots === false || total <= 1) return null;

  const style    = settings.dotStyle || "circle";
  const autoPlay = settings.autoPlay ?? true;
  const speed    = settings.autoPlaySpeed || 4000;
  const vertical = orientation === "vertical";

  if (inline && (style === "bar" || style === "segments")) return null;

  // ── RECTANGULAR LOAD #1 — single continuous progress bar ──
  if (style === "bar") {
    const bw = settings.barWidth || "medium";
    const barCls = bw === "narrow"
      ? "absolute bottom-2 left-1/2 -translate-x-1/2 z-20 h-1 w-[40%] rounded-full overflow-hidden bg-white/25"
      : "absolute bottom-2 left-1/2 -translate-x-1/2 z-20 h-1.5 w-[70%] rounded-full overflow-hidden bg-white/25";
    return (
      <div className={barCls}>
        <div
          key={`bar-${current}`}
          className="h-full bg-white"
          style={
            autoPlay
              ? { animation: `sliderProgress ${speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }
              : { width: `${((current + 1) / total) * 100}%`, transition: "width 0.4s ease" }
          }
        />
      </div>
    );
  }

  // ── RECTANGULAR LOAD #2 — segmented "stories" bars ──
  if (style === "segments") {
    const segW = ({ narrow: "w-[35%]", medium: "w-[60%]", wide: "w-[80%]", full: "w-full" } as Record<string,string>)[settings.segmentsWidth || "medium"] ?? "w-[60%]";
    return (
      <div className={`absolute ${className || "bottom-5"} left-1/2 -translate-x-1/2 z-20 flex gap-1.5 ${segW}`}>
        {slides.map((_: any, i: number) => (
          <button
            key={i}
            onClick={(e) => { e.stopPropagation(); go(i); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Go to slide ${i + 1}`}
            className="relative overflow-hidden rounded-sm bg-white/30 h-1.5 flex-1"
          >
            {i < current && <span className="absolute inset-0 bg-white" />}
            {i === current && (
              <span
                key={`seg-${current}`}
                className="absolute inset-y-0 left-0 w-full bg-white"
                style={autoPlay ? { animation: `sliderProgress ${speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" } : undefined}
              />
            )}
          </button>
        ))}
      </div>
    );
  }

  // ── DOT-BASED variants (circle / line / number / thumbnail) ──
  const containerCls = vertical
    ? "absolute right-5 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-2.5"
    : inline
      ? "flex items-center gap-2"
      : `absolute ${className || "bottom-5"} left-1/2 -translate-x-1/2 z-20 flex items-center gap-2`;

  return (
    <div className={containerCls}>
      {slides.map((_: any, i: number) => {
        const active = i === current;

        if (style === "number")
          return (
            <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
              className={`w-7 h-7 rounded-full text-xs font-bold transition-all ${active ? "bg-white text-gray-900 scale-110" : "bg-white/40 text-white hover:bg-white/60"}`}>
              {i + 1}
            </button>
          );

        if (style === "line") {
          const linesAnim = settings.linesAnim || "none";
          if (linesAnim === "animated") {
            const filled = i < current;
            return (
              <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Go to slide ${i + 1}`}
                className={`relative overflow-hidden rounded-full bg-white/30 ${vertical ? "w-1 h-8" : "h-1 w-8"}`}>
                {filled && <span className="absolute inset-0 bg-white" />}
                {active && (
                  vertical
                    ? <span key={`lv-${current}`} className="absolute inset-x-0 bottom-0 w-full bg-white"
                        style={autoPlay ? { animation: `sliderProgressV ${speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" } : { height: "100%" }} />
                    : <span key={`lh-${current}`} className="absolute inset-y-0 left-0 h-full bg-white"
                        style={autoPlay ? { animation: `sliderProgress ${speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" } : { width: "100%" }} />
                )}
              </button>
            );
          }
          if (linesAnim === "static") {
            return (
              <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
                className={`rounded-full transition-all duration-300 ${
                  vertical
                    ? (i <= current ? "w-1 h-8 bg-white" : "w-1 h-8 bg-white/30 hover:bg-white/50")
                    : (i <= current ? "h-1 w-8 bg-white" : "h-1 w-8 bg-white/30 hover:bg-white/50")
                }`} />
            );
          }
          return (
            <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
              className={`rounded-full transition-all duration-300 ${
                vertical
                  ? (active ? "w-1 h-8 bg-white" : "w-1 h-4 bg-white/50 hover:bg-white/70")
                  : (active ? "h-1 w-8 bg-white" : "h-1 w-4 bg-white/50 hover:bg-white/70")
              }`} />
          );
        }

        if (style === "thumbnail")
          return (
            <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
              className={`rounded overflow-hidden border-2 transition-all duration-300 ${active ? "border-white w-12 h-8 opacity-100" : "border-transparent w-9 h-6 opacity-50 hover:opacity-80"}`}>
              {slides[i]?.imageUrl && (
                <img src={slides[i].imageUrl} alt="" className="w-full h-full object-cover" draggable={false} />
              )}
            </button>
          );

        // default → circle
        return (
          <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
            className={`rounded-full transition-all duration-300 ${active ? "w-3 h-3 bg-white scale-110 shadow-lg" : "w-2.5 h-2.5 bg-white/50 hover:bg-white/70"}`} />
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PlayPauseButton
// ════════════════════════════════════════════════════════════════════════════
function PlayPauseButton({
  paused,
  onToggle,
  className = "",
  size = 16,
}: {
  paused: boolean;
  onToggle: () => void;
  className?: string;
  size?: number;
}) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      onPointerDown={(e) => e.stopPropagation()}
      aria-label={paused ? "Play slideshow" : "Pause slideshow"}
      className={`z-20 text-white/80 hover:text-white transition-colors ${className}`}
    >
      {paused ? <Play size={size} /> : <Pause size={size} />}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// AutoplayBar
// ════════════════════════════════════════════════════════════════════════════
function AutoplayBar({
  current,
  speed,
  autoPlay,
  paused,
}: {
  current: number;
  speed: number;
  autoPlay: boolean;
  paused: boolean;
}) {
  if (!autoPlay) return null;
  return (
    <div className="absolute bottom-0 left-0 right-0 h-1 z-20 bg-white/25">
      <div
        key={`ab-${current}`}
        className="h-full bg-white"
        style={{
          animation: `sliderProgress ${speed}ms linear forwards`,
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Content style helpers
// ════════════════════════════════════════════════════════════════════════════
function getBtnRadius(shape?: string): string {
  if (shape === "pill")   return "rounded-full";
  if (shape === "square") return "rounded-none";
  return "rounded";
}

function getVerticalJustify(pos?: string): string {
  if (pos === "top")    return "justify-start";
  if (pos === "bottom") return "justify-end";
  return "justify-center";
}

function getVInset(pos: string | undefined, bottomClamp: string): string {
  return (pos === "top" || pos === "bottom") ? `top-0 ${bottomClamp}` : "inset-y-0";
}

function getAlignX(a?: string): string {
  if (a === "right") return "items-start text-right";
  if (a === "left")  return "items-end text-left";
  return "items-center text-center";
}

function getSelfBtn(a?: string): string {
  if (a === "right") return "self-start";
  if (a === "left")  return "self-end";
  return "self-center";
}

function hasButton(s: { buttonText?: string; buttonLink?: string }): boolean {
  return Boolean(s.buttonText || s.buttonLink);
}

function ButtonContent({ text }: { text?: string }) {
  if (text) return <>{text}</>;
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className="inline-block align-middle">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 5 5 12 12 19" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SlideCTA
// ════════════════════════════════════════════════════════════════════════════
function SlideCTA({
  slide,
  className,
  style,
}: {
  slide: { buttonText?: string; buttonLink?: string; buttonStyle?: string };
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!hasButton(slide)) return null;
  const label = slide.buttonText || "فتح الرابط";
  // w-fit + pointer-events-auto ensure the button only captures clicks on its
  // own visible area — never on the empty space below/around it.
  const base = `w-fit pointer-events-auto ${className ?? ""}`;
  if (slide.buttonLink) {
    return (
      <Link href={slide.buttonLink} aria-label={label} className={base} style={style}
        onClick={(e) => e.stopPropagation()}>
        <ButtonContent text={slide.buttonText} />
      </Link>
    );
  }
  return (
    <button type="button" aria-label={label} className={base} style={style}
      onClick={(e) => e.stopPropagation()}>
      <ButtonContent text={slide.buttonText} />
    </button>
  );
}

const TITLE_SIZES: Record<string, Record<string, string>> = {
  classic:   { sm: "text-xl md:text-3xl",   md: "text-2xl md:text-5xl",  lg: "text-3xl md:text-6xl",  xl: "text-4xl md:text-8xl" },
  cinematic: { sm: "text-base md:text-2xl", md: "text-lg md:text-4xl",   lg: "text-xl md:text-5xl",   xl: "text-3xl md:text-7xl" },
  split:     { sm: "text-base md:text-xl",  md: "text-lg md:text-2xl",   lg: "text-xl md:text-4xl",   xl: "text-2xl md:text-5xl" },
  kenburns:  { sm: "text-lg md:text-3xl",   md: "text-xl md:text-4xl",   lg: "text-2xl md:text-5xl",  xl: "text-3xl md:text-7xl" },
  thumbnail: { sm: "text-base md:text-xl",  md: "text-lg md:text-2xl",   lg: "text-xl md:text-4xl",   xl: "text-2xl md:text-5xl" },
  spotlight: { sm: "text-lg md:text-3xl",   md: "text-xl md:text-4xl",   lg: "text-2xl md:text-5xl",  xl: "text-3xl md:text-7xl" },
};
const SUBTITLE_SIZES: Record<string, Record<string, string>> = {
  classic:   { sm: "text-xs",            md: "text-sm md:text-base",  lg: "text-base md:text-lg"  },
  cinematic: { sm: "text-[10px]",         md: "text-xs md:text-sm",   lg: "text-sm md:text-base"  },
  split:     { sm: "text-xs md:text-sm",  md: "text-sm md:text-base", lg: "text-base md:text-lg"  },
  kenburns:  { sm: "text-sm",             md: "text-base md:text-lg", lg: "text-lg md:text-xl"    },
  thumbnail: { sm: "text-xs",             md: "text-sm",              lg: "text-sm md:text-base"  },
  spotlight: { sm: "text-xs",             md: "text-sm md:text-base", lg: "text-base md:text-lg"  },
};

function getTitleClass(sliderStyle: string, titleSize?: string): string {
  const row = TITLE_SIZES[sliderStyle] ?? TITLE_SIZES.classic;
  return row[titleSize ?? "lg"] ?? row.lg;
}
function getSubtitleClass(sliderStyle: string, subtitleSize?: string): string {
  const row = SUBTITLE_SIZES[sliderStyle] ?? SUBTITLE_SIZES.classic;
  return row[subtitleSize ?? "md"] ?? row.md;
}
function getBtnBgStyle(settings: any, slide: any): React.CSSProperties | undefined {
  if (slide.buttonStyle === "outline") return undefined;
  return { backgroundColor: settings.btnColor || "var(--color-primary, #2563eb)" };
}

// ════════════════════════════════════════════════════════════════════════════
// getSlideStyle — CSS-keyframe-based (NO black flash)
// ════════════════════════════════════════════════════════════════════════════
function getSlideStyle(
  idx: number,
  current: number,
  prev: number | null,
  animating: boolean,
  direction: "next" | "prev",
  effect: "slide" | "fade" = "slide",
  reverse: boolean = false,
): React.CSSProperties {
  const isActive = idx === current;
  const isPrev   = idx === prev;
  const dir: "next" | "prev" = reverse
    ? (direction === "next" ? "prev" : "next")
    : direction;

  if (effect === "fade") {
    return {
      position: "absolute",
      inset: 0,
      opacity: isActive ? 1 : 0,
      transition: "opacity 0.5s ease",
      zIndex: isActive ? 2 : isPrev ? 1 : 0,
      pointerEvents: isActive ? "auto" : "none",
    };
  }

  if (animating) {
    if (isActive) {
      const anim = dir === "next" ? "sliderEnterRight" : "sliderEnterLeft";
      return { position: "absolute", inset: 0, animation: `${anim} 0.45s cubic-bezier(0.25,0.46,0.45,0.94) forwards`, zIndex: 2 };
    }
    if (isPrev) {
      const anim = dir === "next" ? "sliderExitLeft" : "sliderExitRight";
      return { position: "absolute", inset: 0, animation: `${anim} 0.45s cubic-bezier(0.25,0.46,0.45,0.94) forwards`, zIndex: 1 };
    }
  }
  if (isActive) return { position: "absolute", inset: 0, zIndex: 1 };
  return { position: "absolute", inset: 0, opacity: 0, zIndex: 0, pointerEvents: "none" };
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 1 — Classic Hero
// ════════════════════════════════════════════════════════════════════════════
function ClassicSlider({ slides, current, prev, animating, direction, settings, go, goNext, goPrev, paused, togglePlay, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const heightClass = getHeight(settings.height || "large", isMobile);
  const total       = slides.length;
  const autoPlay    = settings.autoPlay ?? true;
  const speed       = settings.autoPlaySpeed || 4000;
  const effect      = settings.transitionEffect || "slide";
  const reverse     = settings.slideDirection === "ltr";
  const alignX      = getAlignX(settings.textAlignment);
  const selfBtn     = getSelfBtn(settings.textAlignment);

  return (
    <div
      className={`relative overflow-hidden bg-gray-950 select-none cursor-grab active:cursor-grabbing ${heightClass}`}
      onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
    >
      {slides.map((s: any, idx: number) => {
        const img = isMobile && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl;
        return (
          <div key={s.id} style={getSlideStyle(idx, current, prev, animating, direction, effect, reverse)}>
            {img && (
              <img src={img} alt={s.title || ""} draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
            )}
            <div className="absolute inset-0"
              style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity ?? 0.25})` }} />
            <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none" />

            <div className={`absolute inset-x-0 ${getVInset(settings.verticalPosition, "bottom-14")} flex flex-col ${getVerticalJustify(settings.verticalPosition)} px-5 md:px-14 pb-5 ${alignX}`}>
              <div className={`flex flex-col max-w-[88%] md:max-w-[55%] ${alignX}`}>
                {s.title && (
                  <h2
                    className={`${getTitleClass("classic", settings.titleSize)} font-extrabold text-white leading-[0.92] tracking-tight mb-3`}
                    style={{ fontFamily: "var(--font-heading)", textShadow: "0 2px 20px rgba(0,0,0,0.55)" }}>
                    {s.title}
                  </h2>
                )}
                {s.subtitle && (
                  <p className={`${getSubtitleClass("classic", settings.subtitleSize)} text-white/85 mb-5 leading-relaxed drop-shadow`}>
                    {s.subtitle}
                  </p>
                )}
                <SlideCTA slide={s}
                  className={`${selfBtn} inline-block px-7 py-2.5 ${getBtnRadius(settings.btnShape)} font-bold text-sm tracking-wide transition-all duration-200 hover:scale-105 ${
                    s.buttonStyle === "outline"
                      ? "border-2 border-white text-white hover:bg-white hover:text-gray-900"
                      : "text-white shadow-lg hover:opacity-90"
                  }`}
                  style={getBtnBgStyle(settings, s)} />
              </div>
            </div>
          </div>
        );
      })}

      {settings.showArrows !== false && total > 1 && !isMobile && (
        <>
          <Arrow dir="prev" style={settings.arrowStyle} onClick={goPrev} />
          <Arrow dir="next" style={settings.arrowStyle} onClick={goNext} />
        </>
      )}

      <SlideIndicators slides={slides} current={current} go={go} settings={settings} paused={paused} />

      {autoPlay && total > 1 && (
        <PlayPauseButton paused={paused} onToggle={togglePlay}
          className="absolute bottom-3 right-4 z-20" />
      )}

      {settings.dotStyle !== "bar" && settings.dotStyle !== "segments" && (
        <AutoplayBar current={current} speed={speed} autoPlay={autoPlay && total > 1} paused={paused} />
      )}

      <style>{SLIDER_KEYFRAMES}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 2 — Cinematic Fade
// ════════════════════════════════════════════════════════════════════════════
function CinematicFadeSlider({ slides, current, prev, animating, direction, settings, go, goNext, goPrev, paused, togglePlay, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const heightClass = getHeight(settings.height || "large", isMobile);
  const total       = slides.length;
  const autoPlay    = settings.autoPlay ?? true;
  const speed       = settings.autoPlaySpeed || 4000;
  const effect      = settings.transitionEffect || "fade";
  const reverse     = settings.slideDirection === "ltr";

  const isSegments    = settings.dotStyle === "segments";
  const ctrlBottom    = isSegments ? "bottom-14" : "bottom-6";
  const contentClamp  = isSegments ? "bottom-28" : "bottom-20";

  const alignX  = getAlignX(settings.textAlignment);
  const selfBtn = getSelfBtn(settings.textAlignment);

  return (
    <div
      className={`relative overflow-hidden bg-black select-none cursor-grab active:cursor-grabbing ${heightClass}`}
      onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
    >
      {slides.map((s: any, idx: number) => {
        const img = isMobile && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl;
        const isActive = idx === current;
        return (
          <div key={s.id} style={getSlideStyle(idx, current, prev, animating, direction, effect, reverse)}>
            {img && (
              <img src={img} alt="" draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
            )}
            <div className="absolute inset-0"
              style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity ?? 0.45})` }} />
            <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 via-black/10 to-transparent pointer-events-none" />

            <div className={`absolute inset-x-0 ${getVInset(settings.verticalPosition, contentClamp)} flex flex-col ${getVerticalJustify(settings.verticalPosition)} px-5 md:px-16 pb-4 ${alignX}`}>
              <div className={`flex flex-col max-w-[88%] md:max-w-[55%] ${alignX}`}>
                {s.title && (
                  <h2
                    key={`ct-${current}`}
                    className={`${getTitleClass("cinematic", settings.titleSize)} font-light text-white mb-3 uppercase leading-tight`}
                    style={{
                      fontFamily: "var(--font-heading)",
                      letterSpacing: "0.12em",
                      animation: isActive ? "fadeInUp 0.7s ease forwards" : "none",
                    }}>
                    {s.title}
                  </h2>
                )}
                {s.subtitle && (
                  <p
                    key={`cs-${current}`}
                    className={`${getSubtitleClass("cinematic", settings.subtitleSize)} text-white/60 mb-5 tracking-widest`}
                    style={{ animation: isActive ? "fadeInUp 0.7s 0.1s ease both" : "none" }}>
                    {s.subtitle}
                  </p>
                )}
                <SlideCTA slide={s}
                  key={`cb-${current}`}
                  className={`${selfBtn} inline-block border border-white/50 text-white text-[11px] tracking-[0.2em] uppercase px-8 py-3 ${getBtnRadius(settings.btnShape)} hover:bg-white hover:text-black transition-all duration-300`}
                  style={{ animation: isActive ? "fadeInUp 0.7s 0.2s ease both" : "none" }} />
              </div>
            </div>
          </div>
        );
      })}

      {total > 1 && (
        <div className="absolute top-6 left-8 z-20 flex items-baseline gap-1 select-none pointer-events-none">
          <span className="text-white text-2xl font-extralight tabular-nums tracking-widest leading-none">
            {String(current + 1).padStart(2, "0")}
          </span>
          <span className="text-white/35 text-xs mx-1.5">/</span>
          <span className="text-white/35 text-sm tabular-nums">
            {String(total).padStart(2, "0")}
          </span>
        </div>
      )}

      <SlideIndicators slides={slides} current={current} go={go}
        settings={settings} orientation="vertical" paused={paused} />

      {total > 1 && (
        <div className={`absolute ${ctrlBottom} left-8 z-20 flex items-center gap-3`}>
          <button onClick={goPrev} onPointerDown={(e) => e.stopPropagation()} aria-label="Previous"
            className="w-9 h-9 flex items-center justify-center border border-white/25 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/10 transition-all duration-200 rounded-sm">
            <ChevronRight size={15} />
          </button>
          <button onClick={goNext} onPointerDown={(e) => e.stopPropagation()} aria-label="Next"
            className="w-9 h-9 flex items-center justify-center border border-white/25 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/10 transition-all duration-200 rounded-sm">
            <ChevronLeft size={15} />
          </button>
          {autoPlay && (
            <PlayPauseButton paused={paused} onToggle={togglePlay} size={14}
              className="w-9 h-9 flex items-center justify-center border border-white/25 text-white/70 hover:text-white hover:border-white/50 hover:bg-white/10 transition-all duration-200 rounded-sm" />
          )}
        </div>
      )}

      {settings.dotStyle !== "bar" && settings.dotStyle !== "segments" && (
        <AutoplayBar current={current} speed={speed} autoPlay={autoPlay && total > 1} paused={paused} />
      )}

      <style>{SLIDER_KEYFRAMES}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 3 — Split Screen
// ════════════════════════════════════════════════════════════════════════════
function SplitSlider({ slides, current, prev, animating, direction, settings, go, goNext, goPrev, paused, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const s        = slides[current] || {};
  const total    = slides.length;
  const hKey     = settings.height || "large";
  const bgColor  = settings.splitBgColor   || "var(--color-surface, #f9f9f9)";
  const txColor  = settings.splitTextColor || "var(--color-text-primary, #111)";
  const effect   = settings.transitionEffect || "fade";
  const reverse  = settings.slideDirection === "ltr";
  const alignX   = getAlignX(settings.textAlignment);
  const selfBtn  = getSelfBtn(settings.textAlignment);

  return (
    <div
      className={`relative select-none overflow-hidden cursor-grab active:cursor-grabbing ${
        isMobile ? "flex flex-col" : `flex flex-row-reverse ${getHeight(hKey, false)}`
      }`}
      onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
    >
      {/* Image half */}
      <div className={`relative overflow-hidden ${isMobile ? "h-60 w-full" : "w-1/2 h-full"}`}>
        {slides.map((sl: any, idx: number) => {
          const slImg = isMobile && sl.mobileImageUrl ? sl.mobileImageUrl : sl.imageUrl;
          return (
            <div key={sl.id} style={getSlideStyle(idx, current, prev, animating, direction, effect, reverse)}>
              {slImg && (
                <img src={slImg} alt={sl.title || ""} draggable={false}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              )}
            </div>
          );
        })}
        {(settings.dotStyle === "bar" || settings.dotStyle === "segments") && (
          <SlideIndicators slides={slides} current={current} go={go} settings={settings} paused={paused} />
        )}

        {total > 1 && (
          <div className="absolute bottom-4 right-4 z-20 flex items-center gap-3">
            <SlideIndicators slides={slides} current={current} go={go} settings={settings} paused={paused} inline />
            {!isMobile && (
              <div className="flex items-center gap-2">
                <button onClick={goPrev} onPointerDown={(e) => e.stopPropagation()} aria-label="Previous"
                  className="bg-white/80 backdrop-blur-sm text-gray-800 p-2 rounded-full hover:bg-white shadow transition-colors">
                  <ChevronRight size={16} />
                </button>
                <button onClick={goNext} onPointerDown={(e) => e.stopPropagation()} aria-label="Next"
                  className="bg-white/80 backdrop-blur-sm text-gray-800 p-2 rounded-full hover:bg-white shadow transition-colors">
                  <ChevronLeft size={16} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Text half */}
      <div
        className={`flex flex-col ${getVerticalJustify(settings.verticalPosition)} ${isMobile ? "px-6 py-10" : "w-1/2 h-full px-12 py-10"} ${alignX}`}
        style={{ backgroundColor: bgColor }}
      >
        {total > 1 && (
          <p className="text-xs font-medium tracking-widest mb-6 uppercase" style={{ color: "var(--color-primary, #2563eb)" }}>
            {String(current + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
          </p>
        )}
        {s.title && (
          <h2 className={`${getTitleClass("split", settings.titleSize)} font-bold mb-4 leading-tight`}
            style={{ color: txColor, fontFamily: "var(--font-heading)", animation: "fadeInUp 0.4s ease forwards" }}>
            {s.title}
          </h2>
        )}
        {s.subtitle && (
          <p className={`${getSubtitleClass("split", settings.subtitleSize)} mb-8 leading-relaxed`}
            style={{ color: txColor, opacity: 0.7, animation: "fadeInUp 0.4s 0.05s ease both" }}>
            {s.subtitle}
          </p>
        )}
        <SlideCTA slide={s}
          className={`${selfBtn} inline-block px-8 py-3 ${getBtnRadius(settings.btnShape)} font-semibold text-sm transition-all duration-200 hover:scale-105 ${
            s.buttonStyle === "outline" ? "border-2 hover:opacity-80" : "text-white hover:opacity-90"
          }`}
          style={s.buttonStyle === "outline"
            ? { borderColor: txColor, color: txColor }
            : { backgroundColor: settings.btnColor || "var(--color-primary, #2563eb)" }} />
      </div>
      <style>{SLIDER_KEYFRAMES}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 4 — Ken Burns
// ════════════════════════════════════════════════════════════════════════════
function KenBurnsSlider({ slides, current, prev, animating, direction, settings, go, goNext, goPrev, paused, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const heightClass = getHeight(settings.height || "large", isMobile);
  const total       = slides.length;
  const s           = slides[current] || {};
  const speed       = settings.autoPlaySpeed || 5000;
  const effect      = settings.transitionEffect || "fade";
  const reverse     = settings.slideDirection === "ltr";
  const alignClass  = getAlignX(settings.textAlignment);
  const selfBtnKB   = getSelfBtn(settings.textAlignment);

  return (
    <div
      className={`relative select-none overflow-hidden bg-black cursor-grab active:cursor-grabbing ${heightClass}`}
      onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
    >
      {slides.map((sl: any, idx: number) => {
        const slImg    = isMobile && sl.mobileImageUrl ? sl.mobileImageUrl : sl.imageUrl;
        const isActive = idx === current;
        return (
          <div key={sl.id} style={getSlideStyle(idx, current, prev, animating, direction, effect, reverse)}>
            {slImg && (
              <img
                key={`${sl.id}-${isActive}`}
                src={slImg}
                alt=""
                draggable={false}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ animation: isActive ? `kenBurns ${speed + 1000}ms ease-out forwards` : "none" }}
              />
            )}
            <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity ?? 0.4})` }} />
          </div>
        );
      })}

      <div className={`relative z-10 h-full flex flex-col ${getVerticalJustify(settings.verticalPosition)} px-5 md:px-16 ${alignClass}`}>
        <div className={`flex flex-col max-w-[88%] md:max-w-[55%] ${alignClass}`}>
          {s.title && (
            <h2 key={`kt-${current}`}
              className={`${getTitleClass("kenburns", settings.titleSize)} font-bold text-white mb-4`}
              style={{ fontFamily: "var(--font-heading)", textShadow: "0 2px 16px rgba(0,0,0,0.6)", animation: "fadeInUp 0.7s ease forwards" }}>
              {s.title}
            </h2>
          )}
          {s.subtitle && (
            <p key={`ks-${current}`} className={`${getSubtitleClass("kenburns", settings.subtitleSize)} text-white/80 mb-8`}
              style={{ animation: "fadeInUp 0.7s 0.1s ease both" }}>
              {s.subtitle}
            </p>
          )}
          <SlideCTA slide={s}
            className={`${selfBtnKB} inline-block px-8 py-3 text-white font-semibold ${getBtnRadius(settings.btnShape)} hover:scale-105 transition-transform`}
            style={{ backgroundColor: settings.btnColor || "var(--color-primary, #2563eb)", animation: "fadeInUp 0.7s 0.2s ease both" }} />
        </div>
      </div>

      {settings.showArrows !== false && total > 1 && !isMobile && (
        <>
          <Arrow dir="prev" style={settings.arrowStyle} onClick={goPrev} />
          <Arrow dir="next" style={settings.arrowStyle} onClick={goNext} />
        </>
      )}

      {settings.showDots !== false && settings.dotStyle === "thumbnail" && total > 1 ? (
        <div className="absolute bottom-0 left-0 right-0 z-20 flex gap-1.5 p-2 bg-gradient-to-t from-black/70 to-transparent">
          {slides.map((sl: any, i: number) => {
            const tImg = isMobile && sl.mobileImageUrl ? sl.mobileImageUrl : sl.imageUrl;
            return (
              <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
                className={`relative flex-1 rounded overflow-hidden transition-all duration-300 ${
                  i === current ? "ring-2 ring-white opacity-100 h-14" : "opacity-40 hover:opacity-75 h-10"
                }`}>
                {tImg
                  ? <img src={tImg} alt="" className="w-full h-full object-cover" draggable={false} />
                  : <div className="w-full h-full bg-white/20" />}
                {i === current && <div className="absolute inset-0 ring-inset ring-2 ring-white/60 rounded" />}
              </button>
            );
          })}
        </div>
      ) : (
        <SlideIndicators slides={slides} current={current} go={go} settings={settings} paused={paused} />
      )}
      <style>{SLIDER_KEYFRAMES}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 5 — Thumbnail Strip
// ════════════════════════════════════════════════════════════════════════════
function ThumbnailStripSlider({ slides, current, prev, animating, direction, settings, go, goNext, goPrev, paused, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const total    = slides.length;
  const thumbRef = useRef<HTMLDivElement>(null);
  const effect   = settings.transitionEffect || "slide";
  const reverse  = settings.slideDirection === "ltr";
  const alignX   = getAlignX(settings.textAlignment);
  const selfBtn  = getSelfBtn(settings.textAlignment);

  useEffect(() => {
    if (!thumbRef.current) return;
    const active = thumbRef.current.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [current]);

  const mainHeight = getHeight(settings.height || "large", isMobile);

  return (
    <div
      className="select-none cursor-grab active:cursor-grabbing"
      style={{ backgroundColor: "#111" }}
      onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
      onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
    >
      <div className={`relative overflow-hidden ${mainHeight}`}>
        {slides.map((s: any, idx: number) => {
          const img = isMobile && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl;
          return (
            <div key={s.id} style={getSlideStyle(idx, current, prev, animating, direction, effect, reverse)}>
              {img && (
                <img src={img} alt={s.title || ""} draggable={false}
                  className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
              )}
              <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity ?? 0.35})` }} />
              <div className={`absolute inset-x-0 ${getVInset(settings.verticalPosition, "bottom-12")} flex flex-col ${getVerticalJustify(settings.verticalPosition)} px-5 md:px-8 pb-5 ${alignX}`}>
                <div className={`flex flex-col max-w-[88%] md:max-w-[55%] ${alignX}`}>
                  {s.title && (
                    <h2 className={`${getTitleClass("thumbnail", settings.titleSize)} font-bold text-white mb-2`}
                      style={{ fontFamily: "var(--font-heading)", textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>
                      {s.title}
                    </h2>
                  )}
                  {s.subtitle && (
                    <p className={`${getSubtitleClass("thumbnail", settings.subtitleSize)} text-white/80 mb-4`}>
                      {s.subtitle}
                    </p>
                  )}
                  <SlideCTA slide={s}
                    className={`${selfBtn} inline-block px-6 py-2.5 text-sm font-semibold text-white ${getBtnRadius(settings.btnShape)} hover:opacity-90 transition-opacity`}
                    style={getBtnBgStyle(settings, s)} />
                </div>
              </div>
            </div>
          );
        })}

        {settings.showArrows !== false && total > 1 && !isMobile && (
          <>
            <Arrow dir="prev" style={settings.arrowStyle} onClick={goPrev} />
            <Arrow dir="next" style={settings.arrowStyle} onClick={goNext} />
          </>
        )}

        <style>{SLIDER_KEYFRAMES}</style>
      </div>

      {/* ✅ FIX #3: thumbnail strip alignment corrected (right=justify-end, left=justify-start) */}
      {total > 1 && (
        <div
          ref={thumbRef}
          className={`flex gap-2 p-2 bg-black/80 backdrop-blur-sm overflow-x-auto ${
            settings.thumbnailStripAlign === "right"  ? "justify-end"
            : settings.thumbnailStripAlign === "left" ? "justify-start"
            : "justify-center"
          }`}
          style={{ scrollbarWidth: "none" }}
        >
          {slides.map((s: any, i: number) => {
            const tImg     = isMobile && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl;
            const isActive = i === current;
            return (
              <button
                key={i}
                data-active={isActive ? "true" : "false"}
                onClick={(e) => { e.stopPropagation(); go(i); }}
                onPointerDown={(e) => e.stopPropagation()}
                className={`shrink-0 rounded overflow-hidden transition-all duration-300 ${
                  isActive
                    ? "ring-2 ring-white ring-offset-1 ring-offset-black opacity-100 w-20 h-12"
                    : "opacity-50 hover:opacity-80 w-16 h-10"
                }`}
              >
                {tImg
                  ? <img src={tImg} alt="" className="w-full h-full object-cover" draggable={false} />
                  : <div className="w-full h-full bg-gray-700 flex items-center justify-center text-gray-500 text-xs">{i + 1}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STYLE 6 — Spotlight Carousel
// ════════════════════════════════════════════════════════════════════════════
function SpotlightSlider({ slides, current, prev: prevSlide, animating, direction, settings, go, goNext, goPrev, paused, onStart, onMove, onEnd, onCancel, isMobile }: any) {
  const heightClass = getHeight(settings.height || "large", isMobile);
  const total   = slides.length;
  const alignX  = getAlignX(settings.textAlignment);
  const selfBtn = getSelfBtn(settings.textAlignment);

  const overlay = settings.overlayOpacity ?? 0.25;
  const effect  = (settings.transitionEffect || "slide") as "slide" | "fade";
  const reverse = settings.slideDirection === "ltr";

  const stepPct = 103;

  const prevSlots = useRef<Record<string, number>>({});
  const wrap = (raw: number) => {
    let o = raw;
    if (o > total / 2) o -= total;
    else if (o < -total / 2) o += total;
    return o;
  };
  const items: { key: string; slide: any; idx: number; slot: number }[] =
    slides.map((s: any, idx: number) => ({ key: String(s.id ?? idx), slide: s, idx, slot: wrap(idx - current) }));
  if (total === 2) {
    const otherIdx = current === 0 ? 1 : 0;
    const natural  = wrap(otherIdx - current);
    items.push({ key: "__spotlight_clone__", slide: slides[otherIdx], idx: otherIdx, slot: -natural });
  }

  const slotSnapshot: Record<string, number> = {};
  items.forEach((it) => { slotSnapshot[it.key] = it.slot; });
  useEffect(() => { prevSlots.current = slotSnapshot; });

  const cardInner = (s: any, img: string | undefined, isActive: boolean) => (
    <div className="relative w-full h-full rounded-3xl overflow-hidden bg-gray-900">
      {img && (
        <img src={img} alt={s.title || ""} draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
      )}
      {overlay > 0 && (
        <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${overlay})` }} />
      )}
      {isActive && (
        <div className={`absolute inset-x-0 ${getVInset(settings.verticalPosition, "bottom-10")} flex flex-col ${getVerticalJustify(settings.verticalPosition)} px-5 md:px-10 pb-5 ${alignX}`}>
          <div className={`flex flex-col max-w-[88%] md:max-w-[60%] ${alignX}`}>
            {s.title && (
              <h2 key={`spt-${current}`}
                className={`${getTitleClass("spotlight", settings.titleSize)} font-extrabold text-white mb-3 leading-tight`}
                style={{ fontFamily: "var(--font-heading)", textShadow: "0 2px 14px rgba(0,0,0,0.55)", animation: "fadeInUp 0.6s ease forwards" }}>
                {s.title}
              </h2>
            )}
            {s.subtitle && (
              <p key={`sps-${current}`} className={`${getSubtitleClass("spotlight", settings.subtitleSize)} text-white/85 mb-5`}
                style={{ animation: "fadeInUp 0.6s 0.1s ease both" }}>
                {s.subtitle}
              </p>
            )}
            <SlideCTA slide={s}
              className={`${selfBtn} inline-block px-7 py-2.5 ${getBtnRadius(settings.btnShape)} font-bold text-sm text-white shadow-lg hover:opacity-90 transition-opacity`}
              style={getBtnBgStyle(settings, s)} />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div
      className="relative select-none"
      style={{ backgroundColor: "var(--color-background, #ffffff)" }}
    >
      <div
        className={`relative overflow-hidden cursor-grab active:cursor-grabbing ${heightClass}`}
        onPointerDown={onStart} onPointerMove={onMove} onPointerUp={onEnd} onPointerLeave={onEnd} onPointerCancel={onCancel}
        onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onCancel}
      >
        {items.map(({ key, slide: s, idx, slot }) => {
          const img      = isMobile && s.mobileImageUrl ? s.mobileImageUrl : s.imageUrl;
          const isActive = slot === 0;
          const isPrev   = idx === prevSlide && prevSlide !== null && animating;
          const hidden   = Math.abs(slot) > 1;
          const prevSlot = prevSlots.current[key];
          const seam     = prevSlot !== undefined && Math.abs(slot - prevSlot) > 1;

          const cardWidth = total === 1 ? "w-full" : "w-[80%] md:w-[60%]";
          const cls = `absolute top-3 bottom-3 left-1/2 ${cardWidth}`;

          const EASE = "cubic-bezier(0.25,0.46,0.45,0.94)";
          const DUR  = "0.45s";

          if (total === 1) {
            const singleStyle: React.CSSProperties = {
              transform: "translateX(-50%)",
              opacity: 1,
              zIndex: 2,
              pointerEvents: "auto",
              transition: "none",
            };
            return (
              <div key={key} className={cls} style={singleStyle}>
                {cardInner(s, img, true)}
              </div>
            );
          }

          let cardAnimation: string | undefined;
          let cardTransition: string | undefined;
          let cardTransform: string;
          let cardOpacity: number;
          let cardZIndex: number;

          if (effect === "fade") {
            if (isActive) {
              cardTransform  = "translateX(-50%)";
              cardOpacity    = 1;
              cardZIndex     = 2;
              cardAnimation  = animating && !seam ? `spotFadeIn ${DUR} ease forwards` : undefined;
              cardTransition = "none";
            } else if (isPrev) {
              cardTransform  = "translateX(-50%)";
              cardOpacity    = 0;
              cardZIndex     = 1;
              cardAnimation  = !seam ? `spotFadeOut ${DUR} ease forwards` : undefined;
              cardTransition = "none";
            } else {
              cardTransform  = `translateX(-50%) translateX(${slot * stepPct}%)`;
              cardOpacity    = hidden ? 0 : 1;
              cardZIndex     = 1;
              cardAnimation  = undefined;
              cardTransition = "none";
            }
          } else {
            cardOpacity = hidden && !isPrev ? 0 : 1;
            cardZIndex  = isActive ? 2 : 1;
            if (seam) {
              cardTransform  = `translateX(-50%) translateX(${slot * stepPct}%)`;
              cardTransition = "none";
            } else if (isActive && animating) {
              const effDir = reverse ? (direction === "next" ? "prev" : "next") : direction;
              cardAnimation  = effDir === "next"
                ? `spotEnterRight ${DUR} ${EASE} forwards`
                : `spotEnterLeft  ${DUR} ${EASE} forwards`;
              cardTransform  = "translateX(-50%)";
              cardTransition = "none";
            } else if (isPrev) {
              const effDir = reverse ? (direction === "next" ? "prev" : "next") : direction;
              cardAnimation  = effDir === "next"
                ? `spotExitLeft  ${DUR} ${EASE} forwards`
                : `spotExitRight ${DUR} ${EASE} forwards`;
              cardTransform  = "translateX(-50%)";
              cardTransition = "none";
            } else {
              cardTransform  = `translateX(-50%) translateX(${slot * stepPct}%)`;
              cardTransition = hidden ? "none" : `transform ${DUR} ${EASE}, opacity ${DUR} ease-out`;
            }
          }

          const baseStyle: React.CSSProperties = {
            transform:     cardTransform,
            animation:     cardAnimation,
            opacity:       cardOpacity!,
            zIndex:        cardZIndex!,
            pointerEvents: cardOpacity! === 0 ? "none" : "auto",
            transition:    cardTransition,
          };

          if (isActive) {
            return (
              <div key={key} className={cls} style={baseStyle}>
                {cardInner(s, img, true)}
              </div>
            );
          }
          return (
            <button key={key} type="button" aria-label={`Go to slide ${idx + 1}`}
              tabIndex={hidden ? -1 : 0}
              onClick={() => go(idx)}
              className={`${cls} cursor-pointer`} style={baseStyle}>
              {cardInner(s, img, false)}
            </button>
          );
        })}

        {settings.showArrows !== false && total > 1 && !isMobile && (
          <>
            <Arrow dir="prev" style={settings.arrowStyle} onClick={goPrev} />
            <Arrow dir="next" style={settings.arrowStyle} onClick={goNext} />
          </>
        )}
      </div>

      {settings.showDots !== false && total > 1 && (() => {
        const dotStyle = settings.dotStyle || "circle";
        const autoPlay = settings.autoPlay ?? true;
        const speed    = settings.autoPlaySpeed || 4000;

        if (dotStyle === "segments") {
          const segW = ({ narrow: "w-[35%]", medium: "w-[60%]", wide: "w-[80%]", full: "w-full" } as Record<string,string>)[settings.segmentsWidth || "medium"] ?? "w-[60%]";
          return (
            <div className={`flex gap-1.5 px-2 py-3 ${segW} mx-auto`}>
              {slides.map((_: any, i: number) => (
                <button key={i}
                  onClick={(e) => { e.stopPropagation(); go(i); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  aria-label={`Go to slide ${i + 1}`}
                  className="relative overflow-hidden rounded-sm bg-gray-200 h-1.5 flex-1"
                >
                  {i < current && <span className="absolute inset-0 bg-gray-800" />}
                  {i === current && (
                    <span key={`sps-${current}`}
                      className="absolute inset-y-0 left-0 w-full bg-gray-800"
                      style={autoPlay
                        ? { animation: `sliderProgress ${speed}ms linear forwards`, animationPlayState: paused ? "paused" : "running" }
                        : undefined}
                    />
                  )}
                </button>
              ))}
            </div>
          );
        }

        return (
          <div className="flex items-center justify-center gap-2 py-4">
            {slides.map((_: any, i: number) => (
              <button key={i} onClick={(e) => { e.stopPropagation(); go(i); }} onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Go to slide ${i + 1}`}
                className={`rounded-full transition-all duration-300 ${
                  i === current ? "w-7 h-2.5 bg-gray-900" : "w-2.5 h-2.5 bg-gray-300 hover:bg-gray-400"
                }`} />
            ))}
          </div>
        );
      })()}

      <style>{SLIDER_KEYFRAMES}</style>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — SlideshowSection
// ════════════════════════════════════════════════════════════════════════════
export function SlideshowSection({
  settings,
  isMobile = false,
}: {
  settings: any;
  isMobile?: boolean;
}) {
  const slides: any[] = settings.slides || [];
  const total         = slides.length;
  const style: string = settings.sliderStyle || "classic";

  const [current,   setCurrent]   = useState(0);
  const [prev,      setPrev]      = useState<number | null>(null);
  const [animating, setAnimating] = useState(false);
  const [direction, setDirection] = useState<"next" | "prev">("next");
  const [paused,    setPaused]    = useState(false);

  const togglePlay = useCallback(() => setPaused((p) => !p), []);

  const dur = style === "cinematic" ? 600 : 450;

  const go = useCallback(
    (idx: number, dir: "next" | "prev" = "next") => {
      if (animating || total <= 1) return;
      setDirection(dir);
      setPrev(current);
      setCurrent(idx);
      setAnimating(true);
      setTimeout(() => { setPrev(null); setAnimating(false); }, dur);
    },
    [animating, current, total, dur],
  );

  const goNext = useCallback(() => go((current + 1) % total, "next"), [current, total, go]);
  const goPrev = useCallback(() => go((current - 1 + total) % total, "prev"), [current, total, go]);
  const goTo   = useCallback((i: number) => go(i, i > current ? "next" : "prev"), [current, go]);

  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  const resetTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (settings.autoPlay && !paused && total > 1)
      timerRef.current = setInterval(() => goNextRef.current(), settings.autoPlaySpeed || 4000);
  }, [settings.autoPlay, settings.autoPlaySpeed, total, paused]);

  useEffect(() => {
    if (!settings.autoPlay || paused || total <= 1) return;
    timerRef.current = setInterval(() => goNextRef.current(), settings.autoPlaySpeed || 4000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [settings.autoPlay, settings.autoPlaySpeed, total, paused, current]);

  const router = useRouter();
  const onTap = useCallback(() => {
    const link = slides[current]?.buttonLink;
    if (!link) return;
    if (/^https?:\/\//i.test(link)) {
      if (typeof window !== "undefined") window.location.assign(link);
    } else {
      router.push(link);
    }
  }, [slides, current, router]);

  const { offset, onStart, onMove, onEnd: onEndRaw, onCancel } = useSwipe({ total, onNext: goNext, onPrev: goPrev, onTap });
  const onEnd = useCallback(() => { onEndRaw(); resetTimer(); }, [onEndRaw, resetTimer]);

  if (!slides.length) return null;

  const sharedProps = {
    slides, current, prev, animating, direction, offset, settings,
    go: goTo, goNext, goPrev,
    paused, togglePlay,
    onStart, onMove, onEnd, onCancel,
    isMobile,
  };

  return (
    <>
      {style === "classic"   && <ClassicSlider        {...sharedProps} />}
      {style === "cinematic" && <CinematicFadeSlider   {...sharedProps} />}
      {style === "split"     && <SplitSlider           {...sharedProps} />}
      {style === "kenburns"  && <KenBurnsSlider        {...sharedProps} />}
      {style === "thumbnail" && <ThumbnailStripSlider  {...sharedProps} />}
      {style === "spotlight" && <SpotlightSlider       {...sharedProps} />}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// HeroSection — ✅ FIX #4: text alignment corrected (left=items-start, right=items-end)
// ════════════════════════════════════════════════════════════════════════════
export function HeroSection({ settings }: { settings: any }) {
  const heightClass =
    settings.height === "small" ? "h-64"
    : settings.height === "large" ? "h-[500px]"
    : "h-96";

  return (
    <div className={`relative overflow-hidden ${heightClass}`}>
      {settings.imageUrl && (
        <img src={settings.imageUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
      )}
      <div className="absolute inset-0" style={{ backgroundColor: `rgba(0,0,0,${settings.overlayOpacity || 0.4})` }} />
      <div className={`relative z-10 h-full flex flex-col justify-center px-8 ${
        settings.textAlignment === "center" ? "items-center text-center"
        : settings.textAlignment === "left"  ? "items-start text-left"
        : "items-end text-right"
      }`}>
        <h2 className="text-4xl font-bold text-white mb-4" style={{ fontFamily: "var(--font-heading)" }}>
          {settings.title}
        </h2>
        <p className="text-xl text-white/90 mb-6">{settings.subtitle}</p>
        {settings.buttonText && (
          <button className="px-8 py-3 rounded-lg font-medium text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: "var(--color-primary)" }}>
            {settings.buttonText}
          </button>
        )}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Other section components (unchanged)
// ════════════════════════════════════════════════════════════════════════════
export function FeaturedCollectionSection({ settings }: { settings: any }) {
  const products = Array.from({ length: settings.productsLimit || 4 }, (_, i) => i);
  return (
    <section className="py-16 px-6" style={{ backgroundColor: "var(--color-background)" }}>
      <div className="max-w-7xl mx-auto">
        <h2 className="text-2xl font-bold mb-8 text-center"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}>
          {settings.title}
        </h2>
        <div className={`grid grid-cols-2 md:grid-cols-${settings.columns || 4} gap-6`}>
          {products.map((i) => (
            <div key={i} className="group">
              <div className="aspect-square rounded-lg mb-3 overflow-hidden" style={{ backgroundColor: "var(--color-surface)" }}>
                <div className="w-full h-full flex items-center justify-center text-gray-300">
                  <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1}
                      d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-sm font-medium mb-1" style={{ color: "var(--color-text-primary)" }}>
                Sample Product {i + 1}
              </h3>
              {settings.showPrice && (
                <p className="text-sm font-bold" style={{ color: "var(--color-primary)" }}>100 SAR</p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function ProductGridSection({ settings }: { settings: any }) {
  return <FeaturedCollectionSection settings={settings} />;
}

export function TextBannerSection({ settings }: { settings: any }) {
  return (
    <div className="py-4 px-6 text-center"
      style={{ backgroundColor: settings.backgroundColor || "#000000", color: settings.textColor || "#ffffff" }}>
      <p className="text-sm font-medium">{settings.text}</p>
    </div>
  );
}

export function NewsletterSection({ settings }: { settings: any }) {
  return (
    <section className="py-16 px-6" style={{ backgroundColor: "var(--color-surface)" }}>
      <div className="max-w-xl mx-auto text-center">
        <h2 className="text-2xl font-bold mb-3"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}>
          {settings.title}
        </h2>
        <p className="mb-6" style={{ color: "var(--color-text-secondary)" }}>{settings.subtitle}</p>
        <div className="flex gap-2 max-w-md mx-auto">
          <input type="email" placeholder="Your email address"
            className="flex-1 px-4 py-3 rounded-lg border text-sm" style={{ borderColor: "var(--color-border)" }} />
          <button className="px-6 py-3 rounded-lg font-medium text-white"
            style={{ backgroundColor: "var(--color-primary)" }}>
            {settings.buttonText}
          </button>
        </div>
      </div>
    </section>
  );
}

export function RichTextSection({ settings }: { settings: any }) {
  const alignClass = settings.alignment === "center" ? "text-center"
    : settings.alignment === "right" ? "text-right" : "text-left";
  return (
    <section className="py-16 px-6" style={{ backgroundColor: "var(--color-background)" }}>
      <div className={`max-w-3xl mx-auto ${alignClass}`}>
        <h2 className="text-2xl font-bold mb-4"
          style={{ fontFamily: "var(--font-heading)", color: "var(--color-text-primary)" }}>
          {settings.title}
        </h2>
        <p style={{ color: "var(--color-text-secondary)", lineHeight: "var(--line-height)" }}>
          {settings.content}
        </p>
      </div>
    </section>
  );
}