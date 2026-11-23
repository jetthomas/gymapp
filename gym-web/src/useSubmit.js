import { useRef, useState } from 'react';

// Runs an async action with a loading flag, and shows its error message if it throws.
// A second run while one is going is ignored, even before the disabled button has re-rendered
export default function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  async function run(action) {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.message);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return { loading, message, setMessage, run };
}
