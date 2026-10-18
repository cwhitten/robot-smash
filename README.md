# Robot Smash

A 3D hero robot brawler for the browser (three.js + Vite). Start as **Jimmy**, smash bad bots,
collect coins, and buy **Bob**, **Nooby** and **Oli Bot** in the Robot Shop.

## Run it

```bash
npm install
npm run dev        # then open the printed http://localhost:5173 link
```

`npm run build` produces a static site in `dist/` you can host anywhere.

## Play on iPad

Live at **https://cwhitten.github.io/robot-smash/**. Open it in Safari, tap Share → **Add to Home Screen**,
then launch it from the icon to play full-screen (works offline after the first load). Every push to
`main` redeploys via `.github/workflows/deploy.yml`.

## Controls

| Key | Action |
| --- | --- |
| W A S D / arrows | Move |
| Mouse (click the game first) | Look around |
| Left click / J | Main attack (hold to keep attacking) |
| Right click / K | Second attack (Oli Bot) |
| Shift | Dash (you can't be hurt while dashing) |
| Space | Jump (jump over a boss's ground slam!) |
| E | Super power when the bar is full |
| B | Robot Shop |
| M | Music on/off |
| Esc / P | Pause (volume, graphics quality, reset progress) |

On touch screens: drag the left side to move, swipe anywhere else to look, and use the on-screen
👊 💥 💨 ⬆️ ⭐ buttons. ⏸ pauses, 🛒 opens the shop.

## Tuning

All balance numbers (robot stats, prices, enemy toughness, coin rewards, death penalty) live in
`src/config.js`. Progress saves automatically in the browser's localStorage (also whenever the app is hidden, which
matters on iOS). On iPad the save lives inside the home-screen app — deleting the icon deletes it.
