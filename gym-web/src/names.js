// "Jet Thomas", or the email when no name was given
export function displayName(u) {
  return [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
}

// "JT" for the avatar circle, or the email's first letter
export function initials(u) {
  const parts = [u.firstName, u.lastName].filter(Boolean);
  return (parts.length ? parts.map((p) => p[0]).join('') : u.email[0]).toUpperCase();
}
