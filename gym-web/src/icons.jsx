// Line icons on a 24px grid, drawn in the text colour. All decoration: the button or text
// beside each one carries the meaning, so screen readers skip them
function Icon({ size = 20, children }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const Dumbbell = (p) => (
  <Icon {...p}>
    <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11" />
  </Icon>
);

export const Play = (p) => (
  <Icon {...p}>
    <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
  </Icon>
);

export const Timer = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 10v3.5l2 2M9.5 2.5h5" />
  </Icon>
);

export const Check = (p) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const LogOut = (p) => (
  <Icon {...p}>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 8l4 4-4 4M19 12H9" />
  </Icon>
);

export const ChevronLeft = (p) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronRight = (p) => (
  <Icon {...p}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const Sliders = (p) => (
  <Icon {...p}>
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
    <circle cx="15" cy="7" r="2" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

export const Flame = (p) => (
  <Icon {...p}>
    <path d="M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.4 1.2-4 2.5-5 .2 1.8 1 2.8 2 3.2-.6-2.8-.4-5.8.5-8.7Z" />
  </Icon>
);

export const Grid = (p) => (
  <Icon {...p}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </Icon>
);

export const Utensils = (p) => (
  <Icon {...p}>
    <path d="M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 0-3.5 2.5-3.5 6.5S15 14 17 14" />
  </Icon>
);
