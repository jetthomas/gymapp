import { useState } from 'react';

// Runs an async action with a loading flag, and shows its error message if it throws
export default function useSubmit() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action) {
    setLoading(true);
    setMessage('');
    try {
      await action();
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  }
  return { loading, message, setMessage, run };
}
