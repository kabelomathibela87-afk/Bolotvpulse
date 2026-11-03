# Bolo TV app (Afrikabelo + Bolo TV Pulse)

One installable app that reads both blogs live: Home (mixed feed), Afrikabelo, Pulse, Saved.
New posts you publish on Blogger appear in the app automatically. Nothing to update.

Features: category chips, search, in-app reader, save for offline, share, dark/light theme,
install prompt, offline fallback, app shortcuts.

## 1. Put it online (free, 5 minutes)

The app must be served over HTTPS. Pick one:

**Netlify (easiest)**: go to app.netlify.com/drop and drag the unzipped `boloapp` folder in.
You get a link like `https://bolotv.netlify.app` (rename it in Site settings).

**GitHub Pages**: create a repo, upload all files in this folder, then
Settings > Pages > Deploy from branch > main / root.
Your link will be `https://<username>.github.io/<repo>/`.

Open the link on your phone in Chrome. You should see an "Install" bar, and
Chrome menu > "Install app" works. That alone is a downloadable app.

## 2. Make an Android APK / Play Store app

1. Go to **pwabuilder.com** and paste your live link. It should score green on Manifest and Service Worker.
2. Click **Package for stores > Android**. Set:
   - Package ID: `com.bolotv.app` (must be unique and permanent)
   - App name: `Bolo TV`, Launcher name: `Bolo TV`
   - Signing key: choose "New" and **download and back up the keystore + passwords**. You cannot update the app without them.
3. Download the zip. It contains an `.aab` (for Google Play), an `.apk` (to test / share directly) and `assetlinks.json`.
4. To remove the browser address bar in the app, host `assetlinks.json` at
   `https://<your-domain>/.well-known/assetlinks.json` (add a `.well-known` folder to this project and redeploy).
   Netlify: works as is. GitHub Pages: add an empty file named `.nojekyll` so the folder is served.
5. Install the `.apk` on a phone to test before submitting.

## 3. Google Play checklist (commercial release)

- Google Play Console account: one-time US$25 fee.
- Upload the `.aab`, 512x512 icon (`icons/icon-512.png`), a 1024x500 feature graphic, and 4+ phone screenshots.
- **Privacy policy URL** is required: use https://afrikabelo.blogspot.com/p/privacy-policy.html (or write one covering Bolo TV Pulse too).
- Complete Data safety and Content rating. Choose category **News & Magazines**.
- If you show ads, declare it. News apps also need a "News app" declaration in Play Console.
- Personal developer accounts created recently must run a closed test (about 12 testers for 14 days) before production access.

## 4. Connect your blogs to the app

In Blogger > Theme > Edit HTML, change the INSTALL banner link (currently a bit.ly link to an older PWA)
to your new app link, so visitors install this version.

## Customising

- Colours: top of `styles.css` (`--gold`, `--bg`).
- Categories: `CHIPS` at the top of `app.js` (labels must match your Blogger labels).
- Icons: `icons/` (replace with your real logo at 192, 512 and maskable 512).
- After changing any file, bump `VERSION` in `sw.js` so phones pick up the update.
