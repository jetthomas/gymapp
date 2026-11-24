import { useState } from 'react';
import UpgradeDialog from './UpgradeDialog';

// Shown instead of a Plus feature to members without Plus. The server refuses the feature
// anyway (403); this is only the friendly way in
export default function PlusLock({ token, feature }) {
  const [upgrading, setUpgrading] = useState(false);
  return (
    <div className="hint">
      <p>{feature} is part of Gym App Plus.</p>
      <button className="pill-btn filled" type="button" onClick={() => setUpgrading(true)}>
        Upgrade to Plus
      </button>
      {upgrading && <UpgradeDialog token={token} onClose={() => setUpgrading(false)} />}
    </div>
  );
}
