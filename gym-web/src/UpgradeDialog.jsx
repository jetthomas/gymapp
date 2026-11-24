import { useEffect, useRef } from 'react';
import { startCheckout } from './api';
import ErrorMsg from './ErrorMsg';
import useSubmit from './useSubmit';

// The pop-up that sells Plus: what's in it, then on to Stripe's payment page
export default function UpgradeDialog({ token, onClose }) {
  const ref = useRef(null);
  const { loading, message, run } = useSubmit();
  // StrictMode runs effects twice in development, so don't reopen an open dialog
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) {
      dialog.showModal();
      return () => dialog.close();
    }
  }, []);
  return (
    <dialog ref={ref} className="sheet" aria-labelledby="upgrade-title" onCancel={onClose}>
      <h2 id="upgrade-title">Upgrade to Gym App Plus</h2>
      <ul>
        <li>Scan a barcode to fill in a food</li>
        <li>Progress charts for every exercise</li>
        <li>Up to a year of muscle history</li>
      </ul>
      <ErrorMsg>{message}</ErrorMsg>
      <div className="sheet-actions">
        <button className="pill-btn" type="button" onClick={onClose}>
          Not now
        </button>
        <button
          className="pill-btn filled"
          type="button"
          disabled={loading}
          onClick={() =>
            run(async () => {
              const { url } = await startCheckout(token);
              window.location.assign(url);
            })
          }
        >
          {loading ? 'Opening…' : 'Continue to payment'}
        </button>
      </div>
    </dialog>
  );
}
