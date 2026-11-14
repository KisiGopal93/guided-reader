# Voice-Clone Recording Protocol

A short checklist for recording clean English and Nepali voice samples using the **Guided Reader**.

## 1. Room and microphone

- Record in a quiet room with soft furnishings (curtains, sofa, carpet, or a blanket nearby to reduce echo).
- Place the microphone **15 to 20 cm** (about one hand-width) from your mouth, angled **slightly off-axis** (to the side) so `p` and `b` sounds do not pop.
- Use a pop filter if you have one.
- Keep the **same distance, mic angle, and gain setting** for every recording session.
- Keep **auto gain control (AGC) off** and avoid noise-reduction filters while recording (the Guided Reader turns browser echo cancellation, noise suppression, and auto gain off automatically).

## 2. Delivery

- Speak like a **calm storyteller** to one friend: warm, natural ups and downs in your voice, with a slight smile. Avoid flat reading and filler words (`um`, `uh`, throat clearing).
- Aim for **140 to 150 words per minute OVERALL** (pauses included).
- Take a **full breath after each sentence** (about `0.7 s`, or follow the `0.5 s`–`0.7 s` sentence pause bar), and pause longer after paragraphs (`0.8 s`–`1.0 s`) and beats (`1.0 s`).

## 3. Recording technique

- **Read in short paragraphs** (use **Practice selected paragraph only** in the Guided Reader).
- If you stumble or make a mistake, **stop talking, pause cleanly for 2 seconds, and restart that paragraph** (`R`). Never talk over a mistake.
- Keep the **same energy and loudness** from the first sentence to the last.
- Record **English and Nepali in separate sessions** so your voice placement stays consistent in each language.
- Keep **2 clean takes of each paragraph**.

## 4. Checking quality before keeping a file

1. Run the **5-Second Room Check** before your first take. Fix fans, windows, or mic placement if it warns that the room is louder than `-50 dBFS`.
2. Watch the live meter while reading so you never clip above `-3 dBFS` (**Too loud**) or drop below `-30 dBFS` (**Too quiet**).
3. After each take, read the **Take Report**:
   - **Keep a take only if Speed is green (`135–155 wpm`), Pauses are green (mean `>= 0.40 s` and at least one `0.5 s+` pause per 3 sentences), and there is no clipping.**
4. Save passing takes as **WAV (48 kHz, mono, 16-bit)** using **Save WAV**.

## 5. Uploading afterwards

- Put your clean WAV takes in a local folder (for example `takes/en/` and `takes/ne/`).
- Nothing in the Guided Reader uploads or shares your audio. When you are ready, upload your chosen WAV files to ElevenLabs yourself; check the ElevenLabs instructions for the clone type you use before uploading.

## 6. Instant voice clone: what ElevenLabs advises (checked 14 Nov 2026; their pages change, re-check before you upload)
- Amount: about **1 to 2 minutes** of clean audio is enough. More than about 3 minutes gives little improvement and can make the clone worse. The total length matters, not the number of files. ([ElevenLabs: Instant Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning), [help article](https://help.elevenlabs.io/hc/en-us/articles/13434364550801-How-many-voice-samples-should-I-upload-for-Instant-Voice-Cloning))
- Quality is the most important thing: no echo, no background noise, one speaker. The clone copies EVERYTHING it hears: your pace, your pauses and your energy. A fast sample gives a fast clone. So the sample must already have the pace and pauses you want in the videos.
- Format: MP3 at 192 kbps or higher is recommended; WAV gives little or no improvement. Convert a saved take with: `ffmpeg -i ep01-en-take-001.wav -b:a 192k clone-en.mp3`.
- Use ONE steady tone from start to end (calm storyteller). Do not act out laughs or sighs in the sample.
- Do this separately for English and Nepali (one clone each, as now).
- Later, a Professional clone needs much more audio (30 minutes to about 3 hours, best with 2 to 3 hours of clean speech) and a higher plan ([ElevenLabs: Professional Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/professional-voice-cloning)). Recording in the same room, at the same mic distance, is how today's samples stay useful then.
- Ready-made reading passages of about 2 minutes: `samples/clone-sample.en.md` and `clone-sample.ne.md` (Ep 1 Beats 1 to 4, tags removed).
