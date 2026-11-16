import { useEffect, useRef } from 'react';

export default function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }) {
  const ref = useRef(null);
  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="sheet-title" onCancel={onCancel}>
      <h2 id="sheet-title">{title}</h2>
      <p>{body}</p>
      <div className="sheet-actions">
        <button className="pill-btn" type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          className={`pill-btn filled${danger ? ' danger' : ''}`}
          type="button"
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
