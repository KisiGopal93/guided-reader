# Guided Reader

An offline recording helper for **AI Demystified** (English and Nepali). It guides your reading pace word by word, shows every pause as a draining bar, records clean microphone audio inside your browser, and measures your real speed and pauses afterwards.

Nothing is uploaded anywhere. No server, no build step, and no internet connection are needed.

## How to open it

1. Open `index.html` directly in Chrome or Firefox (double-click the file in your file manager, or drag it into a browser tab).
2. No terminal or local web server is required.

## Quick start (5 steps)

1. **Load a script** in **1. Script & Plan**:
   - Click **Choose File…** (for example `samples/ep03.script.en.md` or `samples/ep03.script.ne.md`),
   - Or drag and drop a `.md` or `.txt` file onto the page,
   - Or paste text into the box and click **Load Script**.
2. **Check the timing plan**:
   - You will see the section count, spoken words, sentences, paragraphs, total time, pause time, **Target OVERALL speed** (pauses included), and **Speaking-Only speed** (for information).
   - Example: `samples/ep03.script.en.md` at `145 wpm` shows `9` sections (`8 beats + outro`), `442` words (`424 story + 18 outro`), `63 / 19` sentences/paragraphs, total `3:03`, about `43 s` of pauses, and `190 wpm` speaking-only.
   - To practice just one paragraph, click that paragraph in the outline and choose **Practice selected paragraph only**.
3. **Run the 5-second room check**:
   - Click **Run 5s Room Check** and stay silent for 5 seconds.
   - If the room noise floor is louder than `-50 dBFS`, the tool warns you to close a window, turn off a fan, or move away from the computer.
4. **Read with the guide** in **2. Read**:
   - Click **Open Reading Screen** and press `Space` (or **Start**).
   - After the `3, 2, 1` count-in, follow the yellow word highlight.
   - When a sentence ends, it stays on screen while the pause bar drains (`Breathe 0.5 s`, `Paragraph 0.8 s`, or `Beat 1.0 s`).
   - Watch the top-right meter: it warns immediately if your voice peaks above `-3 dBFS` (**Too loud**) or averages below `-30 dBFS` (**Too quiet**).
5. **Inspect and save your take** in **3. Report & Takes**:
   - When you finish or press `Esc` (**Stop**), the tool measures your audio and opens the report:
     - **OVERALL speed** (from first sound to last sound, pauses included): `135–155 wpm` is **green (good)**, `155–165` or `125–135` is **amber**, above `165` or below `125` is **red**.
     - **Pauses** (quiet stretches of `0.18 s` or longer, ignoring leading/trailing silence): **green** when mean pause is at least `0.40 s` and at least 1 pause of `0.50 s+` appears per 3 sentences.
     - **Waveform & Match the plan**: shows measured pause bands and dashed planned-pause outlines so you can see where pauses were kept or rushed.
   - Click **Save WAV** to download a `48 kHz`, mono, `16-bit` WAV file (for example `ep03-en-take-001.wav`), or **Save WebM** for the compressed recording.

## Script format rules

- Everything before the first `## ` heading (title, `Status:`, notes) is ignored.
- Every `## ` heading starts a new beat/section (including `## Outro line`).
- Everything from a line containing only `---` onward is ignored (owner notes).
- Timing markers like `{#b1.chip}` are removed cleanly before the next word.
- Voice direction tags like `[curious]` or `[laughs]` are not counted as spoken words; they appear as small italic chips above the sentence.
- Plain text with no `## ` headings is also accepted as a single section.

## Keyboard shortcuts (on the Read screen)

| Key | Action |
|---|---|
| `Space` | Start, pause, or resume |
| `Left` / `Right` | Previous or next sentence |
| `Up` / `Down` | Target overall speed `+5` or `-5` wpm (re-plans smoothly ahead) |
| `R` | Restart the current paragraph |
| `Esc` | Stop reading (and finish/measure the recording) |

## Files in this folder

- `index.html` — the offline page (plain HTML, CSS, and JavaScript, using system fonts).
- `reader-core.js` — pure functions for script parsing, timing planning, take measurement, and WAV encoding.
- `reader-core.test.mjs` — Node tests. Run from the repo root with:
  ```bash
  node --test "*.test.mjs"
  ```
  (On Node 20 and earlier, `node --test .` also works; Node 24 expects the file/glob path.)
- `RECORDING_PROTOCOL.md` — short checklist for recording clean voice-clone takes.
