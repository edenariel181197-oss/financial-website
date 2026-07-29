import { useEffect, useRef, useState } from 'react';

export default function useCountUp(target, duration = 600) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    if (target == null || isNaN(target)) return;
    const from = prevRef.current == null || isNaN(prevRef.current) ? target : prevRef.current;
    const to = target;
    if (from === to) { setDisplay(to); return; }

    const start = performance.now();
    let raf;
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + (to - from) * eased);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}
