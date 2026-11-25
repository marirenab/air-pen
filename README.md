# Air Pen ✍️

Draw and write on a wall with your hand, using a webcam, a projector and [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker). Pinch your fingers to draw. Shapes snap into clean lines, circles and rectangles, and your writing can be turned into neat handwriting.

Everything runs in the browser. Nothing is installed, and hand tracking happens on your own computer.

![Setup: webcam tracks your hand, the browser draws, the projector shows it on the wall](assets/setup.jpg)

> Based on [gprem09/air-pen](https://github.com/gprem09/air-pen). This fork adds pinch-to-draw, steadier lines, colours, an eraser and undo, shape correction, an ink pen style and handwriting conversion.

## How it works

1. **The webcam sees your hand.** MediaPipe tracks your thumb and index finger.
2. **The browser draws.** When you pinch your thumb and index finger together, a glowing line follows your fingers.
3. **The projector shows it on the wall.** Cast the browser tab to the projector, or use the projector as a second screen. The wall becomes your canvas.

The projector doesn't need any setup. It just displays the tab.

## Run it

```bash
git clone https://github.com/marirenab/air-pen.git
cd air-pen
python3 -m http.server 8000
```

1. Open **[http://localhost:8000](http://localhost:8000)**. Type `localhost` exactly: browsers only allow the camera on `localhost` or HTTPS, so the `http://[::]:8000` address the server prints won't work.
2. Allow camera access. On macOS, also check System Settings → Privacy & Security → Camera.
3. Put the tab on the projector:
   - **Cable (HDMI or USB-C):** mirror your screen, or drag the window onto the projector screen and press `F`.
   - **Chromecast or wireless projector:** in Chrome, open ⋮ → Cast… → Cast tab.
   - **AirPlay:** Control Centre → Screen Mirroring.
4. Click once on the page so it receives your key presses.

Leave the terminal running while you use it. Press `Ctrl+C` to stop the server.

## Controls

Press `H` in the app to open or close a help panel with all of these.

### Hand gestures

| Gesture | Action |
| --- | --- |
| 🤏 Pinch thumb + index | Draw. The dot turns white while drawing. |
| 🖐️ Open your fingers | Stop drawing and move the dot freely |
| ⏸️ Keep pinching and hold still | Snap a rough shape to a clean line, circle, triangle or rectangle |
| ☝️ Move your hand | The dot follows the point between your thumb and index finger |

### Drawing

| Control | Action |
| --- | --- |
| Pinch thumb + index (hold) | Draw (the dot turns white while drawing) |
| `Shift` (hold) | Draw with the keyboard instead (backup) |
| `1`–`7` | Pick a colour (see [Colours](#colours)) |
| `C` | Next colour |
| `B` | Ink style on/off (thick-and-thin pen look) |

### Colours

| Key | Colour |
| --- | --- |
| `1` | <img src="assets/colors/ice-blue.svg" width="14" height="14" alt=""> Ice blue |
| `2` | <img src="assets/colors/white.svg" width="14" height="14" alt=""> White |
| `3` | <img src="assets/colors/red.svg" width="14" height="14" alt=""> Red |
| `4` | <img src="assets/colors/orange.svg" width="14" height="14" alt=""> Orange |
| `5` | <img src="assets/colors/yellow.svg" width="14" height="14" alt=""> Yellow |
| `6` | <img src="assets/colors/green.svg" width="14" height="14" alt=""> Green |
| `7` | <img src="assets/colors/pink.svg" width="14" height="14" alt=""> Pink |

Press `C` to cycle through them. The current colour is highlighted in the top-left corner.

### Erasing

| Control | Action |
| --- | --- |
| `E` (hold) | Rubber: erase whatever is under the red ring |
| `Z` | Undo the last line (press again to keep undoing) |
| `Space` | Clear everything |

### Shapes and handwriting

| Control | Action |
| --- | --- |
| Hold still at the end of a stroke | Snap to a clean line, circle, ellipse, triangle or rectangle |
| `S` | Shape correction on/off |
| `T` | Turn your writing into neat handwriting |
| `L`, then a letter key | Teach it how you write that letter |

### Other

| Control | Action |
| --- | --- |
| `F` | Fullscreen |
| `H` | Show/hide the help panel |

## Features

### Pinch to draw

Touch your thumb and index finger together to draw, and open them to stop. You don't need the keyboard, so you can stand at the wall. The pinch is measured relative to the size of your hand, so it works near or far from the camera.

### Steady lines

- Only the middle of the camera view maps to the screen, so small hand movements cover the whole wall.
- A [One Euro filter](https://gery.casiez.net/1euro/) smooths out jitter when you move slowly and stays responsive when you move fast.
- The pen state changes only after a few steady frames, so a wobbly pinch doesn't break the line.
- The little hook made as your fingers open is trimmed off, and accidental tiny marks are removed.
- Lines are drawn as smooth curves.

### Shape correction

Draw a shape and **keep pinching while you hold still for about half a second**, as with "draw and hold" on an iPad. A rough line, circle, oval, triangle or rectangle snaps to a clean one, and a white ring flashes when it does. Press `S` to turn this off, for example while you're writing.

### Ink style

Freehand lines look like a real pen: thicker where you move slowly, thinner where you move fast, with tapered ends. Press `B` to switch back to plain lines.

### Handwriting conversion

Write a word, then press `T`. Your writing is read and replaced with the same text in a neat handwriting font ([Caveat](https://fonts.google.com/specimen/Caveat)), in the same colour, size and position.

- **Print letters separately**, with a small gap between them. Joined-up writing isn't supported.
- Leave a bigger gap between words. Several lines work too.
- `T` converts everything written since you last pressed it.
- A label in the top-right corner shows what it read. Press `Z` to undo and get your original writing back.

Recognition runs offline with the [$P point-cloud recogniser](https://depts.washington.edu/acelab/proj/dollar/pdollar.html) and only knows lowercase a to z. Out of the box it knows textbook letters, so **teach it your own handwriting**:

1. Write **one** letter.
2. Press `L`.
3. Press that letter's key on the keyboard.

Two or three examples of each letter make a big difference. Examples are saved in your browser.

## Tips

- **Lighting matters.** Keep some room light on. A dark room lit only by the projector makes tracking unreliable.
- Sit or stand about **1 metre** from the webcam, with your whole hand in view.
- Point the webcam at **you**, not at the projected image.
- If keys stop working, click on the page again so it has focus.

## Tuning

The settings are near the top of [`script.js`](script.js):

| Setting | What it does |
| --- | --- |
| `ACTIVE_MARGIN` | How much of the camera's edge is ignored. Higher means smaller hand movements cover the screen. |
| `PINCH_ON` / `PINCH_OFF` | How close your fingers must be to start or stop drawing. Keep `PINCH_OFF` above `PINCH_ON`. |
| `new OneEuro(0.8, 0.005)` | Smoothing. A lower first number is steadier but adds a little lag. |
| `PEN_DOWN_FRAMES` / `PEN_UP_FRAMES` | How many steady frames it takes to start or stop a line. |
| `MIN_STROKE_LENGTH` | Lines shorter than this (in pixels) are thrown away. |
| `HOLD_MS` | How long to hold still before a shape snaps. |
| `ERASER_RADIUS` | Size of the rubber. |
| `COLORS` | The colour palette. |

## Files

| File | What's in it |
| --- | --- |
| `index.html` | The page |
| `style.css` | Layout, colour palette and the label in the top-right corner |
| `script.js` | Hand tracking, drawing, controls, ink style |
| `shapes.js` | Shape recognition (lines, circles, ellipses, triangles, rectangles) |
| `handwriting.js` | Letter recognition and splitting writing into letters, words and lines |

## Credits

- Original project: [gprem09/air-pen](https://github.com/gprem09/air-pen)
- Hand tracking: [MediaPipe Hands](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
- Letter recognition: the $P recogniser by Vatavu, Anthony and Wobbrock (2012)
- Smoothing: the One Euro filter by Casiez, Roussel and Vogel (2012)
- Handwriting font: [Caveat](https://fonts.google.com/specimen/Caveat) by Impallari Type
