import { startCheckout } from './api';
import ErrorMsg from './ErrorMsg';
import useSubmit from './useSubmit';

// Shown instead of a Plus feature to members without Plus. The server refuses the feature
// anyway (403); this is only the friendly way in
export default function PlusLock({ token, feature }) {
  const { loading, message, run } = useSubmit();
  return (
    <div className="hint">
      <p>{feature} is part of Gym App Plus.</p>
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
        {loading ? 'Opening…' : 'Upgrade to Plus'}
      </button>
      <ErrorMsg>{message}</ErrorMsg>
    </div>
  );
}
