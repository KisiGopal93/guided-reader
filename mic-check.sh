#!/usr/bin/env bash
# Mic check for voice-clone recording (Linux, PipeWire). Records 6 s of silence and 10 s of normal speech from the
# DEFAULT input, then prints the numbers that matter for a clean sample (noise floor, loudness, peak) and a plain verdict.
# Nothing is uploaded; the two test files stay in the folder you give (default: /tmp/mic-check) and can be deleted.
# Usage: bash mic-check.sh [output-folder]
set -u
OUT="${1:-/tmp/mic-check}"
mkdir -p "$OUT"
for tool in pw-record ffmpeg python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "Missing tool: $tool"; exit 1; }
done

countdown() { for n in 3 2 1; do printf '%s... ' "$n"; sleep 1; done; echo "NOW"; }

echo "Mic noise cancellation must be OFF on the microphone itself. Sit where you will record, mic clipped as you will use it."
echo
echo "STEP 1 of 2: stay completely SILENT for 6 seconds. Starting in:"; countdown
timeout 6 pw-record --channels 1 --rate 48000 "$OUT/silence.wav" >/dev/null 2>&1
echo "Done."
echo
echo "STEP 2 of 2: speak NORMALLY for 10 seconds, calm storyteller voice, as in the video. Say, for example:"
echo '  "Your phone chip starts as plain sand. So how does sand learn to think? Let us find out, one small step at a time."'
echo "Starting in:"; countdown
timeout 10 pw-record --channels 1 --rate 48000 "$OUT/speech.wav" >/dev/null 2>&1
echo "Done. Measuring..."
echo

python3 - "$OUT" <<'PY'
import subprocess, sys, re
out = sys.argv[1]

def vol(path):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af", "volumedetect,ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True).stderr
    def g(pat):
        m = re.findall(pat, r)
        return float(m[-1]) if m else None
    return {"mean": g(r"mean_volume: (-?[\d.]+) dB"), "max": g(r"max_volume: (-?[\d.]+) dB"),
            "lufs": g(r"I:\s+(-?[\d.]+) LUFS"), "peak": g(r"Peak:\s+(-?[\d.]+) dBFS")}

try:
    s, v = vol(f"{out}/silence.wav"), vol(f"{out}/speech.wav")
except Exception as e:
    print("Could not measure:", e); sys.exit(1)
if s["mean"] is None or v["mean"] is None:
    print("A recording is empty or unreadable. Is the microphone the default input and switched on?"); sys.exit(1)

floor = s["mean"]
print(f"Room noise (silence):   average {floor:.1f} dBFS")
print(f"Your speech:            loudness {v['lufs']} LUFS, loudest peak {v['peak']} dBFS")
print()
verdicts = []
verdicts.append(("Room noise", "GREEN" if floor < -55 else "AMBER" if floor < -48 else "RED",
                 "quiet enough" if floor < -55 else "a little noisy: close windows, switch off fans" if floor < -48 else "too noisy: find a quieter room or move away from the noise"))
pk = v["peak"]
verdicts.append(("Peak level", "GREEN" if -12 <= pk <= -3 else "RED" if pk > -3 else "AMBER",
                 "good headroom (between -12 and -3 dBFS)" if -12 <= pk <= -3 else "TOO LOUD, near clipping: lower the gain" if pk > -3 else "a bit quiet: raise the gain a little"))
gap = v["lufs"] - floor if v["lufs"] is not None else 0
verdicts.append(("Speech above the noise", "GREEN" if gap >= 40 else "AMBER" if gap >= 33 else "RED",
                 f"{gap:.0f} dB above the room noise (aim for 40 or more)"))
for name, color, text in verdicts:
    print(f"[{color}] {name}: {text}")
print()
print("Files kept in:", out, "(delete them when you like)")
PY
