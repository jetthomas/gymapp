# Running BarMetric as an iPhone app

BarMetric's iPhone app is the same React site, wrapped by [Capacitor](https://capacitorjs.com) in a native app that shows it full-screen. `npx vite build --mode ios` builds the site into `dist/`. Capacitor copies that into the Xcode project in `ios/`, and Xcode builds the app.

Everything below runs in `gym-web/`, except the API, which runs in `gym-api/` as usual (`cargo run`). Keep the API running while you use the app: the app logs in against it.

- [One-time setup on your Mac](#one-time-setup-on-your-mac)
- [Run it in the Simulator](#run-it-in-the-simulator)
- [Run it on your own iPhone](#run-it-on-your-own-iphone)
- [Files involved](#files-involved)
- [When something goes wrong](#when-something-goes-wrong)

## One-time setup on your Mac

1. Install Xcode from the Mac App Store, and open it once.
2. Point the command-line tools at Xcode, and finish its first-run setup. Both ask for your Mac password:
   ```sh
   sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
   sudo xcodebuild -runFirstLaunch
   ```
3. Check an iPhone simulator is installed:
   ```sh
   xcrun simctl list runtimes
   ```
   No iOS line? In Xcode, open **Settings → Components** and download an iOS simulator.

## Run it in the Simulator

`.env.ios` holds the API's address for the app. For the Simulator it's your Mac, because the Simulator shares its network:

```
VITE_API_URL=http://localhost:5080
```

Leave `/api` off the end. That prefix only exists because Vite forwards it in the browser, and the app has no Vite.

Then, after every change to the site:

```sh
npx vite build --mode ios && npx cap run ios
```

`cap run` copies the new build in, rebuilds the app and installs it. It then asks which device to use: pick one with the arrow keys and press Enter. A simulator boots and opens BarMetric.

To skip the question, name the device. List them, then copy the long ID at the end of a line:

```sh
npx cap run ios --list
npx vite build --mode ios && npx cap run ios --target 05D8BB79-3DF7-4E4A-ADED-A7A8588D7095
```

That ID is the iPhone 18 Pro simulator on this Mac. A plugged-in iPhone shows up in the same list once you've done the iPhone setup below.

`npx cap open ios` only opens Xcode; it doesn't rebuild or install anything. If you work from Xcode, run `npx cap sync ios` first, then press ▶.

## Run it on your own iPhone

### Once

1. **Choose the app's ID.** `capacitor.config.json` still has the placeholder `com.yourname.barmetric`. Pick one that's yours, such as `com.jetthomas.barmetric`. You can change it until the app is on the App Store, but not after. Set it in two places:
   - `appId` in `capacitor.config.json`
   - Xcode: **App** target → **Signing & Capabilities** → **Bundle Identifier**
2. **Sign in to Xcode with your Apple ID**: **Xcode → Settings → Accounts → +**. A free Apple ID is enough for your own phone.
3. **Turn on signing**: open the project with `npx cap open ios`. In the left sidebar, select **App**. Then go to **TARGETS → App → Signing & Capabilities**, tick **Automatically manage signing**, and set **Team** to your name (Personal Team).
4. **Camera permission**: the barcode scanner uses the camera, and iOS closes an app that asks for it without saying why. In **TARGETS → App → Info**, add **Privacy - Camera Usage Description** with text such as "BarMetric uses the camera to scan food barcodes."
5. **Connect the iPhone** with a cable, and tap **Trust** on the phone when it asks.
6. **Turn on Developer Mode** on the phone: **Settings → Privacy & Security → Developer Mode → On**. The phone restarts, then asks you to confirm.

### Each time

1. **Make the API reachable from the phone.** `localhost` on the phone means the phone itself, so give your local API a public `https://` address with a Cloudflare tunnel. In a new terminal:
   ```sh
   cloudflared tunnel --url http://localhost:5080
   ```
   It prints an address like `https://some-random-words.trycloudflare.com`. Keep this terminal open while you use the app.
2. **Put that address in `.env.ios`**, with no `/` at the end:
   ```
   VITE_API_URL=https://some-random-words.trycloudflare.com
   ```
   The address changes every time you start the tunnel, so repeat this step each time. The Simulator works with it too, or switch back to `http://localhost:5080`.
3. **Build and run it**, the same command as for the Simulator. When it asks which device, pick your iPhone; it's the line without "(simulator)":
   ```sh
   npx vite build --mode ios && npx cap run ios
   ```
   Or from Xcode: run `npx vite build --mode ios && npx cap sync ios`, pick your iPhone from the device menu at the top of the window, then press ▶.
4. **Open it:** BarMetric appears on the phone's home screen.
5. **First time only:** if the phone says **Untrusted Developer**, go to **Settings → General → VPN & Device Management**, tap your Apple ID and tap **Trust**. Then open BarMetric again.

After the first run you can usually unplug the cable: Xcode can install over Wi-Fi when the phone and Mac are on the same network.

Good to know:

- With a free Apple ID, the app stops opening after 7 days. Press ▶ in Xcode again to reinstall it. The paid Apple Developer Program ($99 a year) adds TestFlight, which installs builds without a cable and keeps them for 90 days.
- While the tunnel runs, anyone with its address can reach your local API. The API's rate limits still apply, but stop the tunnel (Ctrl+C) when you're done testing.
- Over `https://`, "Stay logged in" works. Over the Simulator's plain `http://localhost` it may not survive the app restarting.

## Files involved

| File                    | What it does                                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `capacitor.config.json` | The app's ID and name. `CapacitorHttp` sends requests through iOS's own networking, so the API doesn't need CORS. |
| `.env.ios`              | `VITE_API_URL`, the API address the app calls. Read by `vite build --mode ios`.                                   |
| `src/api.js`            | Uses `VITE_API_URL` when it's set; otherwise `/api`, which Vite forwards in the browser.                          |
| `src/main.jsx`          | Skips the offline service worker in the iOS build; the app carries its own files.                                 |
| `ios/`                  | The Xcode project Capacitor made. Commit it. `npx cap sync ios` updates the web files inside it.                  |

## When something goes wrong

| What you see                                             | Why, and what to do                                                                                                                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `unable to find utility "simctl"`                        | The command-line tools point at the standalone Command Line Tools, not Xcode. Run step 2 of the one-time setup.                                                                                                    |
| The app won't log in, and nothing seems to happen        | The app on the Simulator or phone is an old build. Rebuild with `npx vite build --mode ios && npx cap run ios`, or `cap sync` then ▶.                                                                              |
| Login fails on a real iPhone, but works in the Simulator | `.env.ios` still says `localhost`, or the tunnel isn't running, or its address changed. Redo steps 1–3 of "Each time".                                                                                             |
| Xcode's console mentions **App Transport Security**      | iOS blocked a plain `http://` address. Use the tunnel's `https://` address. For the Simulator only, you can instead add **App Transport Security Settings → Allows Local Networking = YES** in the app's Info tab. |
| A Mac pop-up asks to let Xcode use a **github.com** key  | Xcode wants your saved GitHub login, to download packages or check your repo. **Always Allow** is fine.                                                                                                            |
| The app crashes when you tap scan barcode                | The camera message from setup step 4 is missing.                                                                                                                                                                   |
| The app stopped opening after a week                     | A free Apple ID's install has expired. Press ▶ in Xcode again.                                                                                                                                                     |
