# CFB TeamBuilder Studio

A desktop app that grabs your team straight from the EA Sports College Football 27
Team Builder website, lets you edit it in a clean UI, and saves a team `.json` you
can import into the MMC editor to build a mod.

```
Team Builder website → grab team → edit here → Save .json → MMC editor import → mod
```

## Install it (no coding needed)

1. Go to the repo's **Releases** page and download
   **`CFB-TeamBuilder-Studio-Setup-x.y.z.exe`**.
2. Double-click it. It installs in a few seconds, needs no admin password, and
   opens the app. You'll get a **CFB TeamBuilder Studio** shortcut on your
   desktop and in the Start menu.
3. If Windows shows **"Windows protected your PC"**, click **More info → Run
   anyway**. You see this because the app isn't code-signed, which is a paid
   certificate. It doesn't mean anything is wrong.

**Don't want to install anything?** Download
`CFB-TeamBuilder-Studio-Portable-x.y.z.exe` instead. It runs from anywhere,
including a USB stick or your Downloads folder. It takes a few extra seconds to
start each time.

**Uninstall:** Windows Settings → Apps → CFB TeamBuilder Studio → Uninstall.

It replaces two older tools:

- **The Chrome extension** (in this repo's root): it captured the same team JSON,
  but you edited it in a browser tab and pushed it back to the website.
- **CFB TEAMBUILDER Offline Editor** (Python exe): it edited the in-game
  TEAMBUILDER save file directly.

This app works on the website's team JSON. That is the same file MMC imports, so
the file you save goes straight into MMC with no conversion step.

## Using it

1. **Get from Team Builder.** A Team Builder window opens. Sign in with your EA
   account; the login is remembered for next time. Open your team and click
   **Edit**. When the site loads the team file, the app grabs it and opens it.
   - Every grabbed team is also saved untouched to a `captures` folder, so you
     always have the original. Use **Start → Open captures folder** to find it.
2. **Or Open .json.** Load any team JSON you already have.
3. **Edit:**
   - **Team:** school name, nickname, abbreviation, city, state, stadium, year
     founded, the three team colors, and the team and crowd palettes.
   - **Uniforms** (pick Home, Away or any alternate):
     - Jersey number font, chosen from a searchable grid that shows every
       font in your jersey's number colors. Hover over a font to see it in the
       large **Number preview**, then click to use it. A font with tuned data
       also brings its spacing, placement and per-number kerning.
     - **Number preview:** type any number, pick which size to show (chest,
       back, shoulder or sleeve), and pick a background color. The preview
       updates as you change colors, spacing or size. Numbers with their own
       spacing (like 11) are shown with it, as the game does. It's a flat size
       study, not a 3D render of the game, and its settings aren't saved to the
       team.
     - **Spacing:** a more negative value puts the digits closer together.
       The slider covers -0.70 to -0.15, which includes every in-game jersey
       (they range from -0.65 to -0.16).
     - Number colors, spacing, and size for each position (chest, back,
       shoulder, sleeve).
     - Helmet shell finish (the matching accessory finish is set too) and
       facemask color.
     - Brand logo on the jersey, pants and socks, with tested placement for
       Nike, Jordan, Under Armour and Adidas.
     - **Swap a color** recolors every swatch on the uniform that uses one color.
     - Every individual material and stripe color on the helmet, jersey, pants
       and socks.
   - **Team color chips:** every color picker has one-click chips for your
     team's primary, secondary and tertiary colors.
   - **Changes:** every edit with its before and after values. You can save
     this as a report or undo everything.
   - **Raw JSON:** view the exact data, or edit it by hand (advanced).
4. **Save .json** (Ctrl+S). The app won't let you overwrite the file you opened.
   Import the saved file in the MMC editor.

## What it can't do (yet)

- **Logos and custom textures.** These are uploaded on the website. The team
  file only stores links to them, so change logos on the website and grab the
  team again.
- **Number size direction isn't fully confirmed.** A higher % should mean
  bigger numbers in-game, based on two players' reports. Check in game.
- **Pushing edits back to the website.** Not included; the target is MMC. The
  Chrome extension can still do this.

## For developers

### Running from source

Requires [Node.js](https://nodejs.org) 20 or newer.

```
cd teambuilder-desktop
npm install
npm start
```

### Building the .exe files

```
npm run dist
```

This writes the installer (`…-Setup-x.y.z.exe`) and the portable exe
(`…-Portable-x.y.z.exe`) to `teambuilder-desktop/dist/`. It works on Windows as
is. On Linux or macOS the installer step also needs Wine.

The **Build CFB TeamBuilder Studio** GitHub workflow builds both on Windows for
every push that changes the app. You can download them from the workflow run's
Artifacts. To publish a release, bump `version` in `package.json` and push a
matching tag:

```
git tag studio-v0.1.0
git push origin studio-v0.1.0
```

The workflow attaches both exes to a GitHub Release with install instructions.

The app icon is `build/icon.svg`. `build/icon.png` and `build/icon.ico` are
rendered from it. `build/after-pack.js` writes the icon and version details
into the exe.

### Tests

```
npm test
```

This runs the editing logic against `test/fixtures/sample-team.json`, a trimmed
real team.

## How it works

- `src/main.js`: the Electron main process.
  - **Capturing the team.** The sign-in window uses its own saved session
    (`persist:ea-teambuilder`). Chrome's debugging protocol is attached to it.
    When the page downloads `cdn.mcr.ea.com/.../*nonce-primary.json`, the
    response body is read straight from the page. This is the same approach as
    extension v0.76. If that path misses, the app re-downloads the same URL in
    the signed-in session.
  - **Opening and saving.** The renderer can't touch files directly; open and
    save go through the main process. Saves are written, read back and
    compared before reporting success.
- `src/preload.js`: the small bridge the UI is allowed to call (`window.tbApi`).
- `src/core/model.js`: all editing logic as plain functions with no UI. The
  field paths match extension v0.76: both number-font texture fields, the
  layout profile, the tint channels, and helmet shell plus accessory.
- `src/data/tb-data.json`: catalogs and tuning data extracted from extension
  v0.76: 205 fonts, 389 shells, 291 accessories, 17 brand decals, 220 per-font
  number layouts, 193 number-color channel maps, and brand placement values.
- `src/core/preview.js`: draws the number preview. Each font's digit images
  are 120×120. Their red, green and blue channels mark where the number's main,
  outline and third colors go, so the preview can be recolored live. The two
  digit centers sit `(1 + numberSpacing)` digit-widths apart. Across 258
  in-game jerseys, that leaves a steady ~6 px gap between digits, including
  EA's per-number overrides. The older `|numberSpacing|` formula overlapped
  63% of numbers.
- `src/assets/number-previews/`: digit images for all 205 fonts, packed one
  file per font, from the CFB TEAMBUILDER Offline Editor's preview assets.
  `tools/build-number-previews.js` regenerates them from that editor's
  `preview_assets` folder.
- `src/renderer/`: the UI. Plain HTML, CSS and JS, with no framework.
