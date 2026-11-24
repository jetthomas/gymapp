import { useEffect, useEffectEvent, useRef, useState } from 'react';
import ErrorMsg from './ErrorMsg';

// Plus: shows the back camera and reports the first food barcode it reads.
// Safari has no built-in BarcodeDetector, so this uses the barcode-detector ponyfill (zxing-wasm).
// It's loaded only when the scanner opens, so it doesn't slow down the rest of the app
export default function BarcodeScanner({ onCode }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  // Always calls the latest onCode without restarting the camera when the parent re-renders
  const found = useEffectEvent((code) => onCode(code));

  useEffect(() => {
    let stream;
    let timer;
    let stopped = false;
    let busy = false;
    // No navigator.mediaDevices outside HTTPS (or localhost), so fail the same way as a refusal
    const camera =
      navigator.mediaDevices?.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      }) ?? Promise.reject(new Error('no camera'));
    camera
      .then(async (s) => {
        stream = s;
        // Closed before the camera opened: let it go straight away
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        const { BarcodeDetector } = await import('barcode-detector/ponyfill');
        if (stopped) return;
        // The barcodes on food packets: EAN-13 and EAN-8 worldwide, UPC-A and UPC-E in North America
        const detector = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
        video.current.srcObject = s;
        video.current.play().catch(() => {});
        // Four looks a second is plenty for a packet held still, and easy on the battery
        timer = setInterval(async () => {
          // readyState 2 = a frame is ready; detect() throws on a video with no frame yet
          if (busy || video.current.readyState < 2) return;
          busy = true;
          try {
            const [barcode] = await detector.detect(video.current);
            if (barcode && !stopped) {
              stopped = true;
              clearInterval(timer);
              found(barcode.rawValue);
            }
          } catch {
            // The reader itself failed (e.g. its WASM file didn't download): stop rather than retry 4 times a second
            stopped = true;
            clearInterval(timer);
            setError("Couldn't read barcodes on this device. Type the food in instead.");
          } finally {
            busy = false;
          }
        }, 250);
      })
      .catch(() =>
        setError("Couldn't open the camera. Allow camera access in Settings, or type the food in."),
      );
    return () => {
      stopped = true;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="scanner">
      {/* muted + playsInline: iPhones only play a camera feed inside the page with both */}
      <video ref={video} className="scanner-video" muted playsInline aria-label="Camera" />
      <p className="hint">Hold the barcode inside the frame.</p>
      <ErrorMsg>{error}</ErrorMsg>
    </div>
  );
}
