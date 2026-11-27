import { useEffect, useLayoutEffect, useRef } from 'react';

// Puts the pill under the open button; glide = false jumps there without the transition.
// Returns whether a button is open, so the next move knows if there's somewhere to slide from
function place(nav, pill, glide) {
  const open = nav.querySelector('[aria-current="page"]');
  pill.hidden = !open;
  if (!open) return false;
  pill.classList.toggle('instant', !glide);
  // offset* ignore transforms, so a button mid-press (scale 0.97) still measures full size
  pill.style.transform = `translateX(${open.offsetLeft}px)`;
  pill.style.width = `${open.offsetWidth}px`;
  if (!glide) {
    pill.getBoundingClientRect(); // applies the new spot before the transition comes back
    pill.classList.remove('instant');
  }
  return true;
}

// A row of pill buttons with one white pill that slides behind the open one.
// items: [{ value, label, icon? }]. It's navigation, so the open button is aria-current="page";
// a value that matches no item (a page with no tab) hides the pill
export default function SegmentedNav({ label, items, value, onChange, className = '' }) {
  const nav = useRef(null);
  const pill = useRef(null);
  const shown = useRef(false);

  // Every render, because the buttons can change as well as the open one. Coming from nothing
  // open (first paint, or a page with no tab) it jumps; otherwise it slides
  useLayoutEffect(() => {
    shown.current = place(nav.current, pill.current, shown.current);
  });

  // A new bar size or the web font arriving moves the buttons: follow them without sliding
  useEffect(() => {
    const el = nav.current;
    const jump = () => {
      shown.current = place(el, pill.current, false);
    };
    const observer = new ResizeObserver(jump);
    observer.observe(el);
    let live = true;
    document.fonts.ready.then(() => live && jump());
    return () => {
      live = false;
      observer.disconnect();
    };
  }, []);

  return (
    <nav ref={nav} className={`seg-nav ${className}`} aria-label={label}>
      <span ref={pill} className="seg-nav-pill" aria-hidden="true" />
      {items.map((item) => (
        <button
          key={item.value}
          className="seg-nav-btn"
          type="button"
          aria-current={item.value === value ? 'page' : undefined}
          onClick={() => onChange(item.value)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
