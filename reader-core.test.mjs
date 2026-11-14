import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SETTINGS,
  graphemeClusters,
  detectLanguage,
  wordWeight,
  parseScript,
  sliceScript,
  planReading,
  replanFromPosition,
  measureRoomFloor,
  measureTake,
  buildWaveformBins,
  encodeWavMono16,
} from "./reader-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Standalone repo: the Ep 3 sample scripts ship inside samples/ so the test needs no parent project.
const REPO_ROOT = __dirname;

function makeSineBurstSamples({ sampleRate = 16000, segments }) {
  // Helper to construct deterministic synthetic audio: [{ type: "tone" | "silence", seconds, amp }]
  const totalSamples = segments.reduce((sum, seg) => sum + Math.round(seg.seconds * sampleRate), 0);
  const out = new Float32Array(totalSamples);
  let offset = 0;
  for (const seg of segments) {
    const count = Math.round(seg.seconds * sampleRate);
    if (seg.type === "tone") {
      const amp = seg.amp ?? 0.35;
      const freq = seg.freq ?? 220;
      for (let i = 0; i < count; i += 1) {
        out[offset + i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
      }
    }
    offset += count;
  }
  return out;
}

function assertAllFinite(value, label = "value") {
  if (typeof value === "number") {
    assert.ok(Number.isFinite(value), `${label} should be finite, got ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, idx) => assertAllFinite(item, `${label}[${idx}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      assertAllFinite(v, `${label}.${k}`);
    }
  }
}

test("Parsing: removes glued markers, turns [tags] into sentence hints, ignores header/notes", () => {
  const md = [
    "Title: Ignored title line",
    "Status: DRAFT - also ignored",
    "",
    "## Beat 1 - Opening",
    '{#a}"Warm" {#b1.word}hello! [curious] Next sentence here.',
    "",
    "Second paragraph starts here.",
    "",
    "## Beat 2 - Next",
    "[warm] {#b2.one}Final line.",
    "",
    "---",
    "## Notes for owner (ignored)",
    "Ignore everything after triple dash {#bad} [tag].",
  ].join("\n");

  const parsed = parseScript(md);
  assert.equal(parsed.beats.length, 2);
  assert.equal(parsed.paragraphs.length, 3);
  assert.equal(parsed.sentences.length, 4);
  assert.equal(parsed.words[0].text, '"Warm"');
  assert.equal(parsed.words[1].text, "hello!");
  assert.deepEqual(parsed.sentences[0].hints, []);
  assert.deepEqual(parsed.sentences[1].hints, ["curious"]);
  assert.deepEqual(parsed.sentences[3].hints, ["warm"]);
  assert.equal(parsed.words.some((w) => w.text.includes("Ignore") || w.text.includes("Status")), false);
  assert.equal(parsed.words.some((w) => w.text.includes("{#") || w.text.includes("[curious]")), false);
});

test("Parsing: plain text without headings is treated as one beat with paragraphs", () => {
  const text = "First sentence. Second sentence.\n\nNew paragraph here.";
  const parsed = parseScript(text);
  assert.equal(parsed.beats.length, 1);
  assert.equal(parsed.paragraphs.length, 2);
  assert.equal(parsed.sentences.length, 3);
  assert.equal(parsed.words.length, 7);
});

test("Parsing: abbreviations (Mr. Rao), decimals (3.5), initialisms (U.S.A.), quotes, and Nepali danda", () => {
  const en = 'In the U.S.A. Mr. Rao read 3.5 pages. She asked: "Ready." Next line!';
  const parsedEn = parseScript(en);
  assert.equal(parsedEn.sentences.length, 3);
  assert.equal(parsedEn.sentences[0].text, "In the U.S.A. Mr. Rao read 3.5 pages.");
  assert.equal(parsedEn.sentences[1].text, 'She asked: "Ready."');
  assert.equal(parsedEn.sentences[2].text, "Next line!");

  const ne = "तपाईंको मःमः तातो छ। तर कसरी बन्छ? हेरौँ।";
  const parsedNe = parseScript(ne);
  assert.equal(parsedNe.language, "ne");
  assert.equal(parsedNe.sentences.length, 3);
  assert.equal(parsedNe.words[1].text, "मःमः");
});

test("Parsing: empty script and tag-only script throw clear errors", () => {
  assert.throws(() => parseScript(""), /empty/i);
  assert.throws(() => parseScript("   \n\n  "), /empty/i);
  assert.throws(() => parseScript("## Beat 1\n[curious] [warm]\n---"), /tag|spoken words/i);
  assert.throws(() => parseScript("Status: ignored metadata\n## Beat 1\n---\nIgnored notes"), /no spoken words/i);
});

test("Parsing: real Episode 3 English and Nepali scripts match expected counts", () => {
  const enMd = fs.readFileSync(path.join(REPO_ROOT, "samples/ep03.script.en.md"), "utf8");
  const neMd = fs.readFileSync(path.join(REPO_ROOT, "samples/ep03.script.ne.md"), "utf8");

  const en = parseScript(enMd);
  assert.equal(en.language, "en");
  assert.equal(en.stats.beatCount, 9);
  assert.equal(en.stats.storyBeatCount, 8);
  assert.equal(en.stats.hasOutro, true);
  assert.equal(en.stats.wordCount, 442);
  assert.equal(en.stats.storyWordCount, 424);
  assert.equal(en.stats.outroWordCount, 18);
  assert.equal(en.stats.sentenceCount, 63);
  assert.equal(en.stats.paragraphCount, 19);
  assert.equal(en.sentences[0].text, "Your phone's chip starts as plain sand.");

  const enPlan = planReading(en, DEFAULT_SETTINGS);
  assert.equal(enPlan.warning, null);
  assert.ok(Math.abs(enPlan.total - 182.9) < 0.5);
  assert.ok(Math.abs(enPlan.overallWpm - 145) < 0.01);
  assert.ok(Math.abs(enPlan.speakingOnlyWpm - 190) < 2);
  assert.ok(enPlan.totalPauseSeconds > 40 && enPlan.totalPauseSeconds < 46);

  const ne = parseScript(neMd);
  assert.equal(ne.language, "ne");
  assert.equal(ne.stats.beatCount, 9);
  assert.equal(ne.stats.storyBeatCount, 8);
  assert.equal(ne.stats.hasOutro, true);
});

test("Language detection and word weights: Devanagari conjuncts, lighter Latin in Nepali, minimum weight", () => {
  assert.equal(detectLanguage("This is mostly English with नमस्ते"), "en");
  assert.equal(detectLanguage("तपाईंको फोनको चिप Guess गर्दै सिक्छ।"), "ne");
  // Markers like {#b1.englishName} must not cause Nepali text to be misclassified as English.
  assert.equal(detectLanguage("{#b1.chip}चिप {#b1.sand}बालुवा"), "ne");

  assert.deepEqual(graphemeClusters("क्ष"), ["क्ष"]);
  assert.deepEqual(graphemeClusters("ज्ञ"), ["ज्ञ"]);
  assert.deepEqual(graphemeClusters("प्र"), ["प्र"]);
  assert.deepEqual(graphemeClusters("मःमः"), ["मः", "मः"]);

  assert.equal(wordWeight("क्षमादान", "ne"), 4);
  assert.equal(wordWeight("a", "en"), 2);
  assert.equal(wordWeight("म", "ne"), 2);
  assert.equal(wordWeight("AI", "ne"), 2);
  assert.ok(wordWeight("Guess", "ne") < wordWeight("दोहोर्‍याउँछ", "ne"));
  assert.equal(wordWeight("Guess", "ne"), 3);
});

test("Plan: hits exact overall WPM, applies longest pause, warns when pauses are too long, stays deterministic", () => {
  const sample = [
    "## Beat 1",
    "One, two three four five six seven. Eight nine ten eleven twelve thirteen fourteen.",
    "",
    "Fifteen sixteen seventeen eighteen nineteen twenty twenty-one.",
    "",
    "## Beat 2",
    "Twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven.",
  ].join("\n");

  const plan1 = planReading(sample, DEFAULT_SETTINGS);
  const plan2 = planReading(sample, DEFAULT_SETTINGS);
  assert.deepEqual(plan1, plan2);
  assert.equal(plan1.warning, null);

  // Target overall WPM matches within 0.5%
  assert.ok(Math.abs(plan1.overallWpm - 145) / 145 < 0.005);
  // Total equals last word end
  assert.equal(plan1.total, plan1.words[plan1.words.length - 1].end);

  // Check pause kinds: comma after "One,", sentence after "seven.", paragraph after "fourteen.", beat after "twenty-one."
  assert.deepEqual(
    plan1.pauses.map((p) => ({ after: plan1.words[p.after].text, kind: p.kind, seconds: p.seconds })),
    [
      { after: "One,", kind: "comma", seconds: 0.15 },
      { after: "seven.", kind: "sentence", seconds: 0.5 },
      { after: "fourteen.", kind: "paragraph", seconds: 0.8 },
      { after: "twenty-one.", kind: "beat", seconds: 1.0 },
    ]
  );

  // Changing target speed changes speaking times only, never pauses.
  const fasterPlan = planReading(sample, { ...DEFAULT_SETTINGS, targetOverallWpm: 180 });
  assert.deepEqual(fasterPlan.pauses, plan1.pauses);
  assert.ok(fasterPlan.speakingSeconds < plan1.speakingSeconds);

  // No word ends after next word starts.
  for (let i = 0; i < plan1.words.length - 1; i += 1) {
    assert.ok(plan1.words[i].end <= plan1.words[i + 1].start + 1e-12);
  }

  // High target speed + long pauses triggers the warning and still returns a valid plan.
  const warned = planReading(sample, {
    ...DEFAULT_SETTINGS,
    targetOverallWpm: 200,
    sentencePause: 1.8,
    paragraphPause: 2.2,
    beatPause: 2.5,
  });
  assert.equal(warned.warning, "The pauses are too long for this speed: lower the pauses or the speed");
  assertAllFinite(warned, "warnedPlan");
  assert.equal(warned.total, warned.words[warned.words.length - 1].end);
});

test("Replan from position preserves current timestamp without jumping backwards", () => {
  const sample = "One two three four. Five six seven eight. Nine ten eleven twelve.";
  const plan = planReading(sample, { ...DEFAULT_SETTINGS, targetOverallWpm: 145 });
  const tMid = (plan.words[4].start + plan.words[4].end) / 2;
  const replanned = replanFromPosition(sample, plan, tMid, { ...DEFAULT_SETTINGS, targetOverallWpm: 170 });
  assert.ok(replanned.words[4].start <= tMid && replanned.words[4].end >= tMid);
  assert.ok(replanned.total < plan.total);
  for (let i = 0; i < replanned.words.length - 1; i += 1) {
    assert.ok(replanned.words[i].end <= replanned.words[i + 1].start + 1e-12);
  }
  assert.equal(replanned.total, replanned.words[replanned.words.length - 1].end);
});

test("Measure take: pause detection, leading/trailing silence ignored, speed thresholds & no-pause red verdict", () => {
  const sampleRate = 16000;
  // Build a 10-word, 3-sentence script.
  const script = parseScript("One two three. Four five six. Seven eight nine ten.");

  // Target 150 wpm overall over 10 words => active duration = 10 / 150 * 60 = 4.00 s.
  // Include 1.0 s leading silence and 1.2 s trailing silence that must be ignored!
  // Inside active region (4.00 s): two pauses of 0.50 s and 0.60 s (mean 0.55 s, 2 pauses >= 0.5 s).
  const goodAudio = makeSineBurstSamples({
    sampleRate,
    segments: [
      { type: "silence", seconds: 1.0 },
      { type: "tone", seconds: 1.0, amp: 0.35 },
      { type: "silence", seconds: 0.5 },
      { type: "tone", seconds: 0.9, amp: 0.35 },
      { type: "silence", seconds: 0.6 },
      { type: "tone", seconds: 1.0, amp: 0.35 },
      { type: "silence", seconds: 1.2 },
    ],
  });

  const goodReport = measureTake(goodAudio, sampleRate, script);
  assert.equal(goodReport.isSilent, false);
  assert.equal(goodReport.pauseCount, 2);
  assert.ok(Math.abs(goodReport.meanPauseSeconds - 0.55) < 0.02);
  assert.equal(goodReport.pausesAtLeast05, 2);
  assert.ok(Math.abs(goodReport.activeDurationSeconds - 4.0) < 0.02);
  assert.ok(Math.abs(goodReport.overallWpm - 150) < 1);
  assert.equal(goodReport.speedVerdict.label, "good");
  assert.equal(goodReport.speedVerdict.color, "green");
  assert.equal(goodReport.pauseVerdict.label, "good");
  assert.equal(goodReport.pauseVerdict.color, "green");
  assert.equal(goodReport.overallColor, "green");

  // Boundary checks at 135, 155, 165, and >165 wpm using exact 12.00 s duration (1200 x 10ms frames).
  const checkEdgeSpeed = (wordCount, expectedWpm, expectedLabel, expectedColor) => {
    const wordsText = Array.from({ length: wordCount }, (_, i) => (i % 8 === 7 ? "word." : "word")).join(" ");
    const edgeScript = parseScript(wordsText);
    const audio = makeSineBurstSamples({
      sampleRate,
      segments: [{ type: "tone", seconds: 12.0, amp: 0.35 }],
    });
    const r = measureTake(audio, sampleRate, edgeScript);
    assert.ok(Math.abs(r.overallWpm - expectedWpm) < 0.01, `expected ${expectedWpm}, got ${r.overallWpm}`);
    assert.equal(r.speedVerdict.label, expectedLabel, `at ${expectedWpm} wpm`);
    assert.equal(r.speedVerdict.color, expectedColor, `at ${expectedWpm} wpm`);
    // Take with no pauses gets a red verdict overall.
    assert.equal(r.pauseCount, 0);
    assert.equal(r.pauseVerdict.color, "red");
    assert.equal(r.overallColor, "red");
  };

  checkEdgeSpeed(24, 120, "too slow", "red");
  checkEdgeSpeed(26, 130, "a bit slow", "amber");
  checkEdgeSpeed(27, 135, "good", "green");
  checkEdgeSpeed(31, 155, "good", "green");
  checkEdgeSpeed(32, 160, "a bit fast", "amber");
  checkEdgeSpeed(33, 165, "a bit fast", "amber");
  checkEdgeSpeed(34, 170, "too fast", "red");
});

test("Measure take: silent audio returns clear message without crashing, and no NaN or Infinity anywhere", () => {
  const script = parseScript("Hello world. Second sentence.");
  const silent = new Float32Array(16000 * 2);
  const silentReport = measureTake(silent, 16000, script);
  assert.equal(silentReport.isSilent, true);
  assert.match(silentReport.message, /no speech|silent/i);
  assertAllFinite(silentReport, "silentReport");

  const emptyReport = measureTake(new Float32Array(0), 16000, script);
  assert.equal(emptyReport.isSilent, true);
  assertAllFinite(emptyReport, "emptyReport");

  // Extreme pause overflow (10 s pause inside a 3-word script) still produces finite results and valid timestamps.
  const overflowPlan = planReading("One. Two. Three.", {
    ...DEFAULT_SETTINGS,
    targetOverallWpm: 190,
    sentencePause: 10,
  });
  assert.equal(overflowPlan.warning, "The pauses are too long for this speed: lower the pauses or the speed");
  assertAllFinite(overflowPlan, "overflowPlan");
  assert.equal(overflowPlan.total, overflowPlan.words[overflowPlan.words.length - 1].end);
});

test("Measure take: pause histogram bins, sub-threshold gaps ignored, and loudness level warnings", () => {
  const sampleRate = 16000;
  const script = parseScript("One. Two. Three. Four. Five. Six.");
  // Gaps: 0.10s (ignored), 0.22s (0.18-0.3), 0.35s (0.3-0.5), 0.60s (0.5-0.8), 0.90s (0.8+)
  const audio = makeSineBurstSamples({
    sampleRate,
    segments: [
      { type: "tone", seconds: 0.5, amp: 0.3 },
      { type: "silence", seconds: 0.1 },
      { type: "tone", seconds: 0.5, amp: 0.3 },
      { type: "silence", seconds: 0.22 },
      { type: "tone", seconds: 0.5, amp: 0.3 },
      { type: "silence", seconds: 0.35 },
      { type: "tone", seconds: 0.5, amp: 0.3 },
      { type: "silence", seconds: 0.6 },
      { type: "tone", seconds: 0.5, amp: 0.3 },
      { type: "silence", seconds: 0.9 },
      { type: "tone", seconds: 0.5, amp: 0.3 },
    ],
  });
  const r = measureTake(audio, sampleRate, script);
  assert.equal(r.pauseCount, 4);
  assert.deepEqual(r.histogram, {
    from018To030: 1,
    from030To050: 1,
    from050To080: 1,
    over080: 1,
  });
  assert.equal(r.pausesAtLeast05, 2);
  assert.equal(r.levelWarning, null);

  // Peak > -3 dBFS (amp 0.95 => peak -0.45 dBFS) warns "Too loud"
  const loud = makeSineBurstSamples({ sampleRate, segments: [{ type: "tone", seconds: 1.0, amp: 0.95 }] });
  assert.match(measureTake(loud, sampleRate, script).levelWarning, /Too loud/);

  // Speech RMS < -30 dBFS (amp 0.02 => RMS -37 dBFS, still above -45 dBFS quiet threshold) warns "Too quiet"
  const quietSpeech = makeSineBurstSamples({ sampleRate, segments: [{ type: "tone", seconds: 1.0, amp: 0.02 }] });
  assert.equal(measureTake(quietSpeech, sampleRate, script).levelWarning, "Too quiet");
});

test("Room noise check, waveform bins, and 48 kHz mono 16-bit WAV header encoding", () => {
  const quiet = makeSineBurstSamples({
    sampleRate: 48000,
    segments: [{ type: "tone", seconds: 2.0, amp: 0.001 }],
  });
  const quietRoom = measureRoomFloor(quiet, 48000);
  assert.equal(quietRoom.noisy, false);
  assert.ok(quietRoom.noiseFloorDbfs < -50);

  const noisy = makeSineBurstSamples({
    sampleRate: 48000,
    segments: [{ type: "tone", seconds: 2.0, amp: 0.05 }],
  });
  const noisyRoom = measureRoomFloor(noisy, 48000);
  assert.equal(noisyRoom.noisy, true);
  assert.match(noisyRoom.message, /This room is noisy/i);

  const bins = buildWaveformBins(noisy, 48000, 50);
  assert.equal(bins.bins.length, 50);
  assertAllFinite(bins, "waveformBins");

  const pcm = new Float32Array([0, 0.5, -0.5, 1, -1]);
  const wav = encodeWavMono16(pcm, 48000);
  assert.equal(wav.length, 44 + pcm.length * 2);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(String.fromCharCode(...wav.slice(12, 16)), "fmt ");
  assert.equal(String.fromCharCode(...wav.slice(36, 40)), "data");
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint16(22, true), 1); // mono
  assert.equal(view.getUint32(24, true), 48000); // 48 kHz
  assert.equal(view.getUint16(34, true), 16); // 16-bit
});

test("Slice script: supports practicing a single paragraph with valid plan and total === last.end", () => {
  const md = "## Beat 1\nFirst para one. First para two.\n\nSecond para one. Second para two.\n\n## Beat 2\nThird para.";
  const parsed = parseScript(md);
  const singlePara = sliceScript(parsed, 1, 1);
  assert.equal(singlePara.beats.length, 1);
  assert.equal(singlePara.paragraphs.length, 1);
  assert.equal(singlePara.sentences.length, 2);
  assert.equal(singlePara.words[0].text, "Second");
  const plan = planReading(singlePara, DEFAULT_SETTINGS);
  assert.equal(plan.total, plan.words[plan.words.length - 1].end);
  assert.equal(plan.pauses.length, 1);
  assert.equal(plan.pauses[0].kind, "sentence");
});
