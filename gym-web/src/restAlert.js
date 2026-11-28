import { Capacitor } from '@capacitor/core';
import { Haptics, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

// The iPhone app tells the member when a rest is over, even with the phone locked in a pocket.
// The website can't (a home-screen web app has no timed notifications), so these do nothing there
const native = Capacitor.isNativePlatform();
const ID = 1; // one rest at a time, so a new one replaces it

// Schedules "Rest over" for `at` (ms). Asks for permission the first time; a no means no alerts
export async function scheduleRestEnd(at) {
  if (!native) return;
  try {
    const { display } = await LocalNotifications.requestPermissions();
    if (display !== 'granted') return;
    await LocalNotifications.cancel({ notifications: [{ id: ID }] });
    await LocalNotifications.schedule({
      notifications: [
        {
          id: ID,
          title: 'Rest over',
          body: 'Time for your next set.',
          schedule: { at: new Date(at), allowWhileIdle: true },
        },
      ],
    });
  } catch {
    // An alert that can't be scheduled must never stop the workout
  }
}

export function cancelRestEnd() {
  if (native) LocalNotifications.cancel({ notifications: [{ id: ID }] }).catch(() => {});
}

// A buzz when a rest ends with the app open, where the notification may not show
export function restBuzz() {
  if (native) Haptics.notification({ type: NotificationType.Success }).catch(() => {});
}
