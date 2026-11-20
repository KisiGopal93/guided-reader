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

## AI Script Generator (optional, Bring Your Own Gemini API Key)

Generates a reading script from a topic or context using **Google Gemini** (via Google AI Studio). Each contributor uses their own free-tier API key stored locally in `.env`. The key is read only by `server.py` on your machine—it is never exposed to the browser, HTML/JS, or Git.

### 1. Obtain a free Gemini API key
1. Go to [Google AI Studio API Keys](https://aistudio.google.com/apikey) and sign in with a Google account.
2. Click **Create API key** and copy the generated key.

### 2. Configure your `.env` file
Copy `.env.example` to `.env` in the repository root:
- **Windows (PowerShell):** `Copy-Item .env.example .env`
- **macOS / Linux:** `cp .env.example .env`

Open `.env` and replace the placeholder with your own key:
```env
GEMINI_API_KEY=your_actual_gemini_api_key
```
> `.env` is listed in `.gitignore` and excluded from Git tracking. Never commit `.env` or paste a real key into `.env.example` or frontend files.

### 3. Install dependencies
- **None required to run the app or AI Script Generator.** `server.py` uses Python 3's standard library only (no `pip` or `npm` packages needed).
- Make sure **Python 3** is installed (`python --version`).
- *(Optional)* **Node.js** is only needed if you want to run `node --test "*.test.mjs"` for `reader-core.js`.

### 4. Run the application
- **With AI Script Generator:**
  ```bash
  python server.py
  ```
  Then open **http://127.0.0.1:8787** in Chrome or Firefox. Click **Generate with AI**, enter a topic, click **Generate Script**, edit the generated text as needed, and click **Load Script**.
- **Offline mode (without AI):** Opening `index.html` directly still works for all manual upload/paste, teleprompter, recording, and report features.
- **Run backend tests:**
  ```bash
  python -m unittest test_server -v
  ```

### 5. Troubleshooting API key errors
- **"Generator unavailable":** You opened `index.html` directly (`file://`) or `server.py` is not running. Start `python server.py` and open `http://127.0.0.1:8787`.
- **"No API key configured":** `.env` is missing, `GEMINI_API_KEY` is blank, or it still contains the placeholder `your_gemini_api_key_here`. Save `.env` with your real key and restart `python server.py`.
- **"Gemini rejected the API key or request":** The key in `.env` is invalid, revoked, or has extra quotes/spaces. Verify or regenerate it in Google AI Studio and restart `server.py`.
- **"Gemini free-tier limit reached" (HTTP 429):** Free-tier rate limit hit; wait a minute and try again.
- **"Gemini is busy or unavailable" (HTTP 503):** Temporary Google overload (`server.py` automatically retries and falls back to `gemini-flash-lite-latest`). Wait a moment and retry.
- **"Gemini model '...' was not found" (HTTP 404):** Set a currently supported model name via `GEMINI_MODEL=...` in `.env` and restart `server.py`.
