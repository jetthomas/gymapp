import useModal from './useModal';

export default function ConfirmDialog({ title, body, confirmLabel, danger, onConfirm, onCancel }) {
  const ref = useModal();
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
