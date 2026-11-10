import { useEffect, useRef, useState } from 'react';

// The formats printed on food packaging
const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export default function BarcodeScanner({ onResult, onClose }) {
  const dialogRef = useRef(null);
  const videoRef = useRef(null);
  const [status, setStatus] = useState('Starting the camera…');
  const [typed, setTyped] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    let stream = null;
    let stopped = false;

    async function scan() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return stream.getTracks().forEach((t) => t.stop()); // closed while asking for permission
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        // Loaded only when someone scans, so the rest of the app stays small
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        const detector = new BarcodeDetector({ formats: FORMATS });
        setStatus('Line the barcode up inside the box.');
        while (!stopped) {
          const [code] = await detector.detect(videoRef.current);
          if (code && !stopped) return onResult(code.rawValue);
          await new Promise((r) => setTimeout(r, 150)); // a few checks a second is plenty and spares the battery
        }
      } catch (err) {
        if (stopped) return;
        setStatus(
          err.name === 'NotAllowedError'
            ? 'Camera access is blocked. Type the number under the barcode instead.'
            : 'No camera found. Type the number under the barcode instead.',
        );
      }
    }
    scan();

    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
      dialog.close();
    };
    // Runs once per opening; onResult only calls state setters, so the first one stays valid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="scanner-dialog"
      aria-labelledby="scan-title"
      onCancel={(e) => {
        e.preventDefault(); // Esc: let the parent unmount us, which also stops the camera
        onClose();
      }}
    >
      <div className="picker-head">
        <h2 id="scan-title">Scan barcode</h2>
        <button type="button" className="link-btn" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="scanner-frame">
        <video ref={videoRef} muted playsInline aria-label="Camera view" />
      </div>
      <p className="msg" role="status">{status}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onResult(typed);
        }}
      >
        <div className="field">
          <label htmlFor="barcode-typed">Or type the number under the barcode</label>
          <input id="barcode-typed" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 14))} autoComplete="off" />
        </div>
        <button className="login-btn" type="submit" disabled={typed.length < 8}>
          Look up
        </button>
      </form>
    </dialog>
  );
}
