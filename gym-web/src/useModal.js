import { useEffect, useRef } from 'react';

// Opens a <dialog> as a modal when it mounts and closes it when it unmounts; put the ref on the <dialog>
export default function useModal() {
  const ref = useRef(null);
  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);
  return ref;
}

// Tapping outside the dialog closes it; closedby="any" does that natively, this onClick is for Safari, which lacks it
export const closeOnBackdrop = (onClose) => (e) => {
  if ('closedBy' in HTMLDialogElement.prototype || e.target !== e.currentTarget) return;
  const r = e.currentTarget.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    onClose();
};
