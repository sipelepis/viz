// Motion helpers: scroll reveals and counting numbers. Both respect prefers-reduced-motion
// (the design system also collapses CSS transitions for it).
import { useEffect, useRef } from 'react';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveal [data-reveal] elements as they scroll into view, including ones rendered later.
 * Sets a data-shown attribute (not a class, which React would overwrite on re-render).
 * Without IntersectionObserver nothing is hidden in the first place.
 */
export function useRevealOnScroll() {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const root = document.documentElement;
    root.classList.add('reveal-ready');
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.setAttribute('data-shown', '');
        io.unobserve(e.target);
      }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );
    const watch = (node: ParentNode) =>
      node.querySelectorAll('[data-reveal]:not([data-shown])').forEach((el) => io.observe(el));
    watch(document);
    const mo = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach((n) => {
      if (!(n instanceof Element)) return;
      if (n.matches('[data-reveal]:not([data-shown])')) io.observe(n);
      watch(n);
    })));
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      root.classList.remove('reveal-ready');
    };
  }, []);
}

/**
 * A number that counts up when it first scrolls into view, then glides to new values.
 * Screen readers get only the final value.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      const from = shown.current ?? 0;
      if (reducedMotion() || from === value) {
        shown.current = value;
        el.textContent = format(value);
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - start) / 900);
        shown.current = from + (value - from) * (1 - (1 - k) ** 3); // ease-out cubic
        // Whole-number stats count in whole numbers; fractional ones (rates, shares) keep their precision.
        el.textContent = format(k === 1 ? value : Number.isInteger(value) ? Math.round(shown.current) : shown.current);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    if (shown.current === null && 'IntersectionObserver' in window && !reducedMotion()) {
      const io = new IntersectionObserver(([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        run();
      });
      io.observe(el);
      return () => { io.disconnect(); cancelAnimationFrame(raf); };
    }
    run();
    return () => cancelAnimationFrame(raf);
  }, [value, format]);

  return (
    <>
      <span ref={ref} aria-hidden="true">{format(shown.current ?? (reducedMotion() ? value : 0))}</span>
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}
