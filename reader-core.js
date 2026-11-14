// Pure core logic for the Guided Reader (no DOM, no network, no browser APIs required).
// Used both by the offline HTML page (via <script src="./reader-core.js">) and by Node tests
// (via ESM named imports). Using a dual export keeps file:// loading working in Chrome & Firefox
// without CORS errors while supporting `node --test`.

const GuidedReaderCore = (function () {
  "use strict";

  const DEFAULT_SETTINGS = Object.freeze({
    targetOverallWpm: 145,
    sentencePause: 0.5,
    commaPause: 0.15,
    paragraphPause: 0.8,
    beatPause: 1.0,
    countInSeconds: 3,
    fontSizePx: 56,
    theme: "dark",
    mirror: false,
    language: "auto",
    quietThresholdDbfs: -45,
  });

  // Timing markers `{#name}` are glued to the word after them so they must disappear
  // without inserting spaces (e.g. `{#a}"Warm"` -> `"Warm"`).
  const MARKER_RE = /\{#[A-Za-z0-9._-]+\}/g;
  const TAG_RE = /\[([^\]]+)\]/g;
  const DEVANAGARI_CHAR_RE = /[\u0900-\u097F]/;
  const LETTER_CHAR_RE = /\p{L}/u;
  const LEADING_CLOSERS_STRIP_RE = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
  const TRAILING_CLOSERS_RE = /["'”’)\]}»›]+$/u;
  const LEADING_OPENERS_RE = /^["'“‘(\[{«‹]+/u;
  const LOWERCASE_OR_DIGIT_START_RE = /^[\p{Ll}0-9०-९]/u;
  const INITIALISM_RE = /^(?:[A-Za-z]{1,2}\.){2,}$/;

  // Common abbreviations where a trailing full stop does not end a sentence, even before
  // a capitalised name like "Mr. Rao" or "Dr. Sharma".
  const ABBREVIATIONS = new Set([
    "mr.",
    "mrs.",
    "ms.",
    "dr.",
    "prof.",
    "sr.",
    "jr.",
    "st.",
    "rev.",
    "gen.",
    "col.",
    "lt.",
    "sgt.",
    "capt.",
    "hon.",
    "pres.",
    "gov.",
    "vs.",
    "etc.",
    "e.g.",
    "i.e.",
    "fig.",
    "no.",
    "vol.",
    "ch.",
    "p.",
    "pp.",
    "inc.",
    "ltd.",
    "co.",
    "corp.",
    "jan.",
    "feb.",
    "mar.",
    "apr.",
    "aug.",
    "sep.",
    "sept.",
    "oct.",
    "nov.",
    "dec.",
  ]);

  // Shared segmenter so Devanagari conjuncts (क्ष, ज्ञ, प्र) and base+matra syllables count as 1 unit.
  const GRAPHEME_SEGMENTER = new Intl.Segmenter("ne", { granularity: "grapheme" });

  /**
   * Splits a string into visual grapheme clusters.
   */
  function graphemeClusters(text) {
    if (!text) return [];
    const out = [];
    for (const part of GRAPHEME_SEGMENTER.segment(text)) {
      out.push(part.segment);
    }
    return out;
  }

  /**
   * Detects whether spoken narration is predominantly Nepali (> 30% Devanagari letters).
   * Strips timing markers and tone tags first so English marker IDs never skew Nepali text.
   */
  function detectLanguage(text) {
    if (!text || typeof text !== "string") return "en";
    const cleaned = text.replace(MARKER_RE, "").replace(TAG_RE, " ");
    let totalLetters = 0;
    let devanagariLetters = 0;
    for (const ch of cleaned) {
      if (!LETTER_CHAR_RE.test(ch)) continue;
      totalLetters += 1;
      if (DEVANAGARI_CHAR_RE.test(ch)) {
        devanagariLetters += 1;
      }
    }
    if (totalLetters === 0) return "en";
    return devanagariLetters / totalLetters > 0.3 ? "ne" : "en";
  }

  /**
   * Computes speaking weight for a single spoken word.
   * Uses grapheme clusters (minimum 2). Inside Nepali narration, Latin words weigh 0.6 per letter
   * because a Latin letter carries less syllable time than a Devanagari consonant+vowel cluster.
   */
  function wordWeight(word, lang = "en") {
    const stripped = String(word || "").replace(LEADING_CLOSERS_STRIP_RE, "");
    const target = stripped.length > 0 ? stripped : String(word || "");
    const clusters = graphemeClusters(target);
    if (lang === "ne") {
      let weight = 0;
      for (const cluster of clusters) {
        weight += /^[A-Za-z0-9]/.test(cluster) ? 0.6 : 1;
      }
      return Math.max(2, weight);
    }
    return Math.max(2, clusters.length);
  }

  /**
   * Decides whether `word` ends a sentence given `nextWord` in the same paragraph.
   * Abbreviations (Mr.), decimals (3.5), and initialisms (U.S.A.) do not split mid-paragraph.
   */
  function isSentenceEndingWord(word, nextWord, isLastInParagraph) {
    if (isLastInParagraph) return true;
    const withoutClosers = word.replace(TRAILING_CLOSERS_RE, "");
    if (withoutClosers.length === 0) return false;
    const lastChar = withoutClosers.slice(-1);

    if (lastChar === "?" || lastChar === "!" || lastChar === "…" || lastChar === "।" || lastChar === "॥") {
      return true;
    }

    if (lastChar === ".") {
      const nextTrimmed = (nextWord || "").replace(LEADING_OPENERS_RE, "");
      // A full stop followed by a lowercase letter or digit is a continuation, not a new sentence.
      if (LOWERCASE_OR_DIGIT_START_RE.test(nextTrimmed)) {
        return false;
      }
      const core = withoutClosers.replace(LEADING_OPENERS_RE, "");
      if (ABBREVIATIONS.has(core.toLowerCase())) {
        return false;
      }
      if (INITIALISM_RE.test(core)) {
        return false;
      }
      return true;
    }

    return false;
  }

  /**
   * Checks whether `word` carries a comma, semicolon, or colon pause at its end.
   */
  function isCommaPauseWord(word) {
    const withoutClosers = word.replace(TRAILING_CLOSERS_RE, "");
    if (withoutClosers.length === 0) return false;
    const lastChar = withoutClosers.slice(-1);
    return lastChar === "," || lastChar === ";" || lastChar === ":";
  }

  /**
   * Extracts tokens and tone tags from a single paragraph in exact reading order.
   */
  function tokenizeParagraph(paragraphText) {
    const cleaned = paragraphText.replace(MARKER_RE, "");
    // Match either a [tone hint] block or a run of non-whitespace, non-'[' characters.
    const tokenRe = /\[([^\]]+)\]|([^\s\[]+)/g;
    const items = [];
    let match;
    while ((match = tokenRe.exec(cleaned)) !== null) {
      if (match[1] !== undefined) {
        const hint = match[1].trim();
        if (hint.length > 0) {
          items.push({ type: "tag", value: hint });
        }
      } else if (match[2] !== undefined) {
        const word = match[2].trim();
        if (word.length > 0) {
          items.push({ type: "word", value: word });
        }
      }
    }
    return items;
  }

  /**
   * Parses a markdown or plain-text script into beats, paragraphs, sentences, words, and hints.
   * Throws a clear error if the script is empty or contains only tags/markers with no spoken words.
   */
  function parseScript(rawText) {
    if (typeof rawText !== "string" || rawText.trim() === "") {
      throw new Error("The script is empty. Paste text or open a script file.");
    }

    const rawLines = rawText.split(/\r?\n/);
    const activeLines = [];
    for (const rawLine of rawLines) {
      if (rawLine.trim() === "---") break;
      activeLines.push(rawLine);
    }

    const hasBeatHeadings = activeLines.some((line) => /^##\s+/.test(line.trim()));
    const rawBeats = [];

    if (hasBeatHeadings) {
      let currentBeat = null;
      let currentParaLines = [];

      const flushPara = () => {
        if (currentBeat && currentParaLines.length > 0) {
          currentBeat.rawParagraphs.push(currentParaLines.join(" "));
          currentParaLines = [];
        }
      };

      for (const rawLine of activeLines) {
        const line = rawLine.trim();
        const headingMatch = /^##\s+(.+)$/.exec(line);
        if (headingMatch) {
          flushPara();
          currentBeat = {
            title: headingMatch[1].trim(),
            rawParagraphs: [],
          };
          rawBeats.push(currentBeat);
          continue;
        }
        // Ignore everything before the first ## heading (Status, notes, H1 title) and stray # headings.
        if (!currentBeat || /^#{1,6}\s/.test(line)) continue;
        if (line === "") {
          flushPara();
        } else {
          currentParaLines.push(line);
        }
      }
      flushPara();
    } else {
      // Plain text with no ## headings becomes a single beat.
      const singleBeat = { title: "Script", rawParagraphs: [] };
      let currentParaLines = [];
      for (const rawLine of activeLines) {
        const line = rawLine.trim();
        if (/^#{1,6}\s/.test(line)) continue;
        if (line === "") {
          if (currentParaLines.length > 0) {
            singleBeat.rawParagraphs.push(currentParaLines.join(" "));
            currentParaLines = [];
          }
        } else {
          currentParaLines.push(line);
        }
      }
      if (currentParaLines.length > 0) {
        singleBeat.rawParagraphs.push(currentParaLines.join(" "));
      }
      rawBeats.push(singleBeat);
    }

    // Tokenize paragraphs and drop beats/paragraphs that have zero spoken words,
    // while remembering whether any tone tags were seen for clearer error reporting.
    let sawTag = false;
    const populatedBeats = [];
    let pendingHints = [];

    for (const beat of rawBeats) {
      const populatedParas = [];
      for (const rawPara of beat.rawParagraphs) {
        const items = tokenizeParagraph(rawPara);
        const paraWords = [];
        for (const item of items) {
          if (item.type === "tag") {
            sawTag = true;
            pendingHints.push(item.value);
          } else {
            paraWords.push({ text: item.value, hintsBefore: pendingHints });
            pendingHints = [];
          }
        }
        if (paraWords.length > 0) {
          populatedParas.push(paraWords);
        }
      }
      if (populatedParas.length > 0) {
        populatedBeats.push({
          title: beat.title,
          isOutro: /^outro\s+line/i.test(beat.title),
          paragraphs: populatedParas,
        });
      }
    }

    if (populatedBeats.length === 0) {
      if (sawTag) {
        throw new Error("The script only contains voice direction tags and has no spoken words.");
      }
      throw new Error("No spoken words were found in the script.");
    }

    const beats = [];
    const paragraphs = [];
    const sentences = [];
    const words = [];

    let storyWordCount = 0;
    let outroWordCount = 0;

    populatedBeats.forEach((rawBeat, beatIndex) => {
      const beatSentenceIndices = [];
      const beatParagraphIndices = [];
      const beatFirstWordIndex = words.length;

      rawBeat.paragraphs.forEach((paraTokens, paraPosInBeat) => {
        const paragraphIndex = paragraphs.length;
        const paraFirstWordIndex = words.length;
        const paraSentenceIndices = [];
        const isLastParaInBeat = paraPosInBeat === rawBeat.paragraphs.length - 1;

        let curSentenceWords = [];
        let curSentenceHints = [];
        let curSentenceFirstWord = words.length;

        paraTokens.forEach((tok, wordPosInPara) => {
          const isLastWordInPara = wordPosInPara === paraTokens.length - 1;
          const nextWordText = isLastWordInPara ? "" : paraTokens[wordPosInPara + 1].text;
          const isSentenceEnd = isSentenceEndingWord(tok.text, nextWordText, isLastWordInPara);
          const isParagraphEnd = isLastWordInPara;
          const isBeatEnd = isLastWordInPara && isLastParaInBeat;
          const isCommaPause = !isSentenceEnd && isCommaPauseWord(tok.text);

          const sentenceIndex = sentences.length;
          const wordIndex = words.length;

          if (tok.hintsBefore.length > 0) {
            curSentenceHints.push(...tok.hintsBefore);
          }

          words.push({
            index: wordIndex,
            text: tok.text,
            beat: beatIndex,
            paragraph: paragraphIndex,
            sentence: sentenceIndex,
            hintsBefore: tok.hintsBefore,
            isSentenceEnd,
            isCommaPause,
            isParagraphEnd,
            isBeatEnd,
          });

          if (rawBeat.isOutro) outroWordCount += 1;
          else storyWordCount += 1;

          curSentenceWords.push(tok.text);

          if (isSentenceEnd) {
            sentences.push({
              index: sentenceIndex,
              beatIndex,
              paragraphIndex,
              hints: curSentenceHints,
              text: curSentenceWords.join(" "),
              firstWordIndex: curSentenceFirstWord,
              lastWordIndex: wordIndex,
            });
            paraSentenceIndices.push(sentenceIndex);
            beatSentenceIndices.push(sentenceIndex);

            curSentenceWords = [];
            curSentenceHints = [];
            curSentenceFirstWord = wordIndex + 1;
          }
        });

        paragraphs.push({
          index: paragraphIndex,
          beatIndex,
          sentenceIndices: paraSentenceIndices,
          firstWordIndex: paraFirstWordIndex,
          lastWordIndex: words.length - 1,
        });
        beatParagraphIndices.push(paragraphIndex);
      });

      beats.push({
        index: beatIndex,
        title: rawBeat.title,
        isOutro: rawBeat.isOutro,
        paragraphIndices: beatParagraphIndices,
        sentenceIndices: beatSentenceIndices,
        firstWordIndex: beatFirstWordIndex,
        lastWordIndex: words.length - 1,
      });
    });

    const spokenText = words.map((w) => w.text).join(" ");
    const language = detectLanguage(spokenText);

    return {
      language,
      beats,
      paragraphs,
      sentences,
      words,
      stats: {
        beatCount: beats.length,
        storyBeatCount: beats.filter((b) => !b.isOutro).length,
        hasOutro: beats.some((b) => b.isOutro),
        paragraphCount: paragraphs.length,
        sentenceCount: sentences.length,
        wordCount: words.length,
        storyWordCount,
        outroWordCount,
      },
    };
  }

  function resolveSettings(settingsInput) {
    const merged = { ...DEFAULT_SETTINGS, ...(settingsInput || {}) };
    const safePositive = (v, fallback) => (Number.isFinite(v) && v > 0 ? v : fallback);
    const safeNonNegative = (v, fallback) => (Number.isFinite(v) && v >= 0 ? v : fallback);

    return {
      targetOverallWpm: safePositive(Number(merged.targetOverallWpm), DEFAULT_SETTINGS.targetOverallWpm),
      sentencePause: safeNonNegative(Number(merged.sentencePause), DEFAULT_SETTINGS.sentencePause),
      commaPause: safeNonNegative(Number(merged.commaPause), DEFAULT_SETTINGS.commaPause),
      paragraphPause: safeNonNegative(Number(merged.paragraphPause), DEFAULT_SETTINGS.paragraphPause),
      beatPause: safeNonNegative(Number(merged.beatPause), DEFAULT_SETTINGS.beatPause),
      countInSeconds: safeNonNegative(Number(merged.countInSeconds), DEFAULT_SETTINGS.countInSeconds),
      fontSizePx: safePositive(Number(merged.fontSizePx), DEFAULT_SETTINGS.fontSizePx),
      theme: merged.theme === "light" ? "light" : "dark",
      mirror: Boolean(merged.mirror),
      language: merged.language === "en" || merged.language === "ne" ? merged.language : "auto",
      quietThresholdDbfs: Number.isFinite(Number(merged.quietThresholdDbfs))
        ? Number(merged.quietThresholdDbfs)
        : DEFAULT_SETTINGS.quietThresholdDbfs,
    };
  }

  /**
   * Builds a deterministic word-by-word timing plan that hits the exact target OVERALL WPM
   * (pauses included), with longest-applicable-pause precedence and speaking times weighted by grapheme clusters.
   */
  function planReading(scriptInput, settingsInput) {
    const script = typeof scriptInput === "string" ? parseScript(scriptInput) : scriptInput;
    if (!script || !Array.isArray(script.words) || script.words.length === 0) {
      throw new Error("Cannot plan reading for an empty script.");
    }

    const cfg = resolveSettings(settingsInput);
    const lang = cfg.language === "auto" ? script.language || "en" : cfg.language;
    const n = script.words.length;

    // Overall speed counts from the first sound to the last sound, so there is no trailing pause after the final word.
    const pauses = [];
    const pauseByWordIndex = new Map();

    for (let i = 0; i < n - 1; i += 1) {
      const w = script.words[i];
      const candidates = [];
      if (w.isBeatEnd) candidates.push({ kind: "beat", seconds: cfg.beatPause, priority: 4 });
      if (w.isParagraphEnd) candidates.push({ kind: "paragraph", seconds: cfg.paragraphPause, priority: 3 });
      if (w.isSentenceEnd) candidates.push({ kind: "sentence", seconds: cfg.sentencePause, priority: 2 });
      if (w.isCommaPause) candidates.push({ kind: "comma", seconds: cfg.commaPause, priority: 1 });

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.seconds - a.seconds || b.priority - a.priority);
        const best = candidates[0];
        if (best.seconds > 0) {
          const entry = { after: i, seconds: best.seconds, kind: best.kind };
          pauses.push(entry);
          pauseByWordIndex.set(i, entry);
        }
      }
    }

    const total = (n / cfg.targetOverallWpm) * 60;
    const rawPauseSum = pauses.reduce((sum, p) => sum + p.seconds, 0);
    const rawSpeakingSeconds = total - rawPauseSum;
    const rawSpeakingWpm = rawSpeakingSeconds > 0 ? (n / rawSpeakingSeconds) * 60 : Infinity;

    const tooLong = rawSpeakingSeconds < 0.6 * total || rawSpeakingWpm > 230;
    const warning = tooLong
      ? "The pauses are too long for this speed: lower the pauses or the speed"
      : null;

    // Guard against extreme impossible settings (e.g. a 10 s pause inside a 2-word script) so
    // timestamps never go backwards and speakingOnlyWpm stays finite.
    let effectivePauses = pauses;
    let totalPauseSeconds = rawPauseSum;
    if (rawPauseSum >= total * 0.99 && total > 0 && rawPauseSum > 0) {
      const scale = (total * 0.95) / rawPauseSum;
      effectivePauses = pauses.map((p) => ({ ...p, seconds: p.seconds * scale }));
      pauseByWordIndex.clear();
      for (const p of effectivePauses) pauseByWordIndex.set(p.after, p);
      totalPauseSeconds = total * 0.95;
    }

    const speakingSeconds = Math.max(0, total - totalPauseSeconds);
    const weights = script.words.map((w) => wordWeight(w.text, lang));
    const totalWeight = weights.reduce((sum, w) => sum + w, 0) || n;

    const timedWords = [];
    let cursor = 0;

    for (let i = 0; i < n; i += 1) {
      const w = script.words[i];
      const duration = speakingSeconds * (weights[i] / totalWeight);
      const start = cursor;
      // Anchor the very last word's end directly to `total` so floating-point accumulation never creates drift.
      const end = i === n - 1 ? Math.max(start, total) : start + duration;

      timedWords.push({
        text: w.text,
        start,
        end,
        sentence: w.sentence,
        paragraph: w.paragraph,
        beat: w.beat,
        weight: weights[i],
        hintsBefore: w.hintsBefore || [],
      });

      const pause = pauseByWordIndex.get(i);
      cursor = end + (pause ? pause.seconds : 0);
    }

    const overallWpm = total > 0 ? (n / total) * 60 : 0;
    const speakingOnlyWpm = speakingSeconds > 0 ? (n / speakingSeconds) * 60 : 0;

    return {
      language: lang,
      words: timedWords,
      pauses: effectivePauses,
      total,
      totalPauseSeconds,
      speakingSeconds,
      overallWpm,
      speakingOnlyWpm,
      warning,
    };
  }

  /**
   * Re-plans the remainder of a live reading when the user changes speed mid-session,
   * preserving the exact current cursor position so words never jump backwards.
   */
  function replanFromPosition(scriptInput, currentPlan, currentTime, newSettings) {
    const targetPlan = planReading(scriptInput, newSettings);
    if (!currentPlan || !Array.isArray(currentPlan.words) || currentPlan.words.length === 0) {
      return targetPlan;
    }
    if (!Number.isFinite(currentTime) || currentTime <= 0) {
      return targetPlan;
    }
    if (currentTime >= currentPlan.total) {
      return currentPlan;
    }

    const curWords = currentPlan.words;
    const n = curWords.length;
    const newWords = targetPlan.words;

    const curPauseMap = new Map();
    for (const p of currentPlan.pauses) curPauseMap.set(p.after, p);
    const newPauseMap = new Map();
    for (const p of targetPlan.pauses) newPauseMap.set(p.after, p);

    // Find which word or pause contains `currentTime`.
    let activeWordIdx = -1;
    let inPauseAfterIdx = -1;

    for (let i = 0; i < n; i += 1) {
      const w = curWords[i];
      if (currentTime >= w.start && currentTime <= w.end) {
        activeWordIdx = i;
        break;
      }
      if (i < n - 1 && currentTime > w.end && currentTime < curWords[i + 1].start) {
        inPauseAfterIdx = i;
        break;
      }
    }

    const updatedWords = [];
    const updatedPauses = [];

    if (activeWordIdx >= 0) {
      // Preserve completed prefix words 0 .. activeWordIdx - 1.
      for (let i = 0; i < activeWordIdx; i += 1) {
        updatedWords.push({ ...curWords[i] });
        const cp = curPauseMap.get(i);
        if (cp) updatedPauses.push({ ...cp });
      }

      const oldW = curWords[activeWordIdx];
      const oldDur = oldW.end - oldW.start;
      const frac = oldDur > 1e-6 ? Math.min(1, Math.max(0, (currentTime - oldW.start) / oldDur)) : 0;
      const newDur = newWords[activeWordIdx].end - newWords[activeWordIdx].start;
      // Keep the word aligned at `currentTime` by projecting its already-spoken fraction backwards.
      const anchoredStart = Math.max(
        activeWordIdx > 0 ? updatedWords[activeWordIdx - 1].end + (curPauseMap.get(activeWordIdx - 1)?.seconds || 0) : 0,
        currentTime - frac * newDur
      );
      let cursor = currentTime + (1 - frac) * newDur;

      updatedWords.push({
        ...newWords[activeWordIdx],
        start: anchoredStart,
        end: cursor,
      });

      const firstPause = newPauseMap.get(activeWordIdx);
      if (firstPause) {
        updatedPauses.push({ ...firstPause });
        cursor += firstPause.seconds;
      }

      for (let i = activeWordIdx + 1; i < n; i += 1) {
        const dur = newWords[i].end - newWords[i].start;
        const start = cursor;
        const end = start + dur;
        updatedWords.push({
          ...newWords[i],
          start,
          end,
        });
        const p = newPauseMap.get(i);
        cursor = end + (p ? p.seconds : 0);
        if (p) updatedPauses.push({ ...p });
      }
    } else if (inPauseAfterIdx >= 0) {
      // Keep completed words 0 .. inPauseAfterIdx and finish the active pause at its current end time.
      for (let i = 0; i <= inPauseAfterIdx; i += 1) {
        updatedWords.push({ ...curWords[i] });
        const cp = curPauseMap.get(i);
        if (cp) updatedPauses.push({ ...cp });
      }

      let cursor = curWords[inPauseAfterIdx + 1].start;
      for (let i = inPauseAfterIdx + 1; i < n; i += 1) {
        const dur = newWords[i].end - newWords[i].start;
        const start = cursor;
        const end = start + dur;
        updatedWords.push({
          ...newWords[i],
          start,
          end,
        });
        const p = newPauseMap.get(i);
        cursor = end + (p ? p.seconds : 0);
        if (p) updatedPauses.push({ ...p });
      }
    } else {
      return targetPlan;
    }

    const total = updatedWords[updatedWords.length - 1].end;
    const totalPauseSeconds = updatedPauses.reduce((s, p) => s + p.seconds, 0);
    const speakingSeconds = Math.max(0, total - totalPauseSeconds);

    return {
      language: targetPlan.language,
      words: updatedWords,
      pauses: updatedPauses,
      total,
      totalPauseSeconds,
      speakingSeconds,
      overallWpm: total > 0 ? (n / total) * 60 : 0,
      speakingOnlyWpm: speakingSeconds > 0 ? (n / speakingSeconds) * 60 : 0,
      warning: targetPlan.warning,
    };
  }

  /**
   * Computes RMS in dBFS for a slice of normalized PCM samples [-1, 1], floored at -120 dBFS.
   */
  function rmsToDbfs(rms) {
    if (!Number.isFinite(rms) || rms <= 0) return -120;
    return Math.max(-120, 20 * Math.log10(rms));
  }

  /**
   * Measures a 5-second silence recording to report the room noise floor in dBFS.
   * Trims brief start/end edges on longer captures so mouse clicks do not skew the room check.
   */
  function measureRoomFloor(samples, sampleRate) {
    if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return {
        noiseFloorDbfs: -120,
        peakDbfs: -120,
        noisy: false,
        message: "No audio captured for the room check.",
      };
    }

    const totalSeconds = samples.length / sampleRate;
    const startIdx = totalSeconds >= 1.5 ? Math.floor(0.25 * sampleRate) : 0;
    const endIdx = totalSeconds >= 1.5 ? Math.max(startIdx + 1, samples.length - Math.floor(0.1 * sampleRate)) : samples.length;

    let sumSq = 0;
    let peak = 0;
    let count = 0;
    for (let i = startIdx; i < endIdx; i += 1) {
      const s = Number.isFinite(samples[i]) ? samples[i] : 0;
      const abs = Math.abs(s);
      if (abs > peak) peak = abs;
      sumSq += s * s;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    const noiseFloorDbfs = rmsToDbfs(rms);
    const peakDbfs = rmsToDbfs(peak);
    const noisy = noiseFloorDbfs > -50;

    return {
      noiseFloorDbfs,
      peakDbfs,
      noisy,
      message: noisy
        ? "This room is noisy: close the window / turn off the fan / move away from the computer"
        : `Room noise floor is good (${noiseFloorDbfs.toFixed(1)} dBFS). Ready to record.`,
    };
  }

  /**
   * Generates a plain-language one-sentence coaching advice from speed and pause verdicts.
   */
  function buildAdvice(overallWpm, speedVerdict, pauseVerdict, pausesAtLeast05, meanPauseSeconds, sentenceCount) {
    const roundedWpm = Math.round(overallWpm);
    const neededLong = Math.max(1, Math.ceil(sentenceCount / 3));
    if (speedVerdict.color !== "green" && overallWpm > 155) {
      if (pausesAtLeast05 === 0) {
        const pct = Math.max(5, Math.round(((overallWpm - 145) / overallWpm) * 100));
        return `You speak at ${roundedWpm} words a minute with no pause longer than 0.5 s. Take a full breath after each full stop and slow down by about ${pct}%.`;
      }
      if (pauseVerdict.color !== "green") {
        if (meanPauseSeconds >= 0.4 - 1e-6) {
          return `You speak at ${roundedWpm} words a minute with ${pausesAtLeast05} pauses of 0.5 s or more (${neededLong} needed for ${sentenceCount} sentences). Slow down slightly and pause after every full stop.`;
        }
        return `You speak at ${roundedWpm} words a minute and need longer pauses (mean ${meanPauseSeconds.toFixed(2)} s). Slow down slightly and hold a full 0.5 s breath after each sentence.`;
      }
      return `You speak at ${roundedWpm} words a minute, which is above the 135 to 155 wpm target. Follow the highlight more calmly and stretch your sentence pauses slightly.`;
    }

    if (speedVerdict.color !== "green" && overallWpm < 135) {
      if (pauseVerdict.color !== "green") {
        return `Your overall speed is ${roundedWpm} words a minute and pauses are short. Speak steadily and leave clear 0.5 s breaths after sentences.`;
      }
      return `Your overall speed is ${roundedWpm} words a minute, which is slower than the 135 to 155 wpm target. Keep your good pauses and read the words slightly brisker.`;
    }

    if (pauseVerdict.color !== "green") {
      if (pausesAtLeast05 === 0) {
        return `Your speed is ${roundedWpm} words a minute, with no pause of 0.5 s or more. Take a full breath after each full stop.`;
      }
      if (meanPauseSeconds >= 0.4 - 1e-6) {
        return `Your speed is on target at ${roundedWpm} words a minute, with ${pausesAtLeast05} pauses of 0.5 s or more (${neededLong} needed). Hold a full 0.5 s breath after every sentence.`;
      }
      return `Your speed is on target at ${roundedWpm} words a minute, but your pauses average ${meanPauseSeconds.toFixed(2)} s. Hold a full 0.5 s breath at sentence and paragraph ends.`;
    }

    return `Great take: ${roundedWpm} words a minute overall with ${pausesAtLeast05} pauses of 0.5 s or more (mean ${meanPauseSeconds.toFixed(2)} s).`;
  }

  /**
   * Analyses recorded mono PCM samples against a script:
   * frames every 10 ms, detects pauses >= 0.18 s between first and last sound,
   * computes overall & speaking-only WPM, pause histogram, loudness checks, and verdicts.
   */
  function measureTake(samples, sampleRate, scriptInput, options = {}) {
    const script = typeof scriptInput === "string" ? parseScript(scriptInput) : scriptInput;
    if (!script || !Array.isArray(script.words) || script.words.length === 0) {
      throw new Error("Cannot measure a take without a valid parsed script.");
    }

    const quietThresholdDbfs = Number.isFinite(Number(options.quietThresholdDbfs))
      ? Number(options.quietThresholdDbfs)
      : DEFAULT_SETTINGS.quietThresholdDbfs;
    const minPauseSeconds = Number.isFinite(Number(options.minPauseSeconds))
      ? Number(options.minPauseSeconds)
      : 0.18;

    const wordCount = script.words.length;
    const sentenceCount = script.sentences ? script.sentences.length : 1;

    const makeSilentReport = (reason) => ({
      isSilent: true,
      message: reason,
      durationSeconds: 0,
      firstSoundTime: 0,
      lastSoundTime: 0,
      activeDurationSeconds: 0,
      speakingSeconds: 0,
      totalPauseSeconds: 0,
      overallWpm: 0,
      speakingOnlyWpm: 0,
      wordCount,
      sentenceCount,
      pauses: [],
      pauseCount: 0,
      meanPauseSeconds: 0,
      longestPauseSeconds: 0,
      pausesAtLeast05: 0,
      histogram: {
        from018To030: 0,
        from030To050: 0,
        from050To080: 0,
        over080: 0,
      },
      peakDbfs: -120,
      speechRmsDbfs: -120,
      levelWarning: null,
      speedVerdict: { label: "no speech", color: "red" },
      pauseVerdict: { label: "no pauses", color: "red" },
      overallColor: "red",
      advice: reason,
    });

    if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return makeSilentReport("No audio samples found in this take. Check your microphone and record again.");
    }

    const frameSize = Math.max(1, Math.round(sampleRate * 0.01));
    const frameDuration = frameSize / sampleRate;
    const numFrames = Math.floor(samples.length / frameSize);
    if (numFrames === 0) {
      return makeSilentReport("Recording is too short to measure. Record at least a few words.");
    }

    const frames = [];
    let globalPeak = 0;

    for (let f = 0; f < numFrames; f += 1) {
      const startOffset = f * frameSize;
      let sumSq = 0;
      for (let i = 0; i < frameSize; i += 1) {
        const val = Number.isFinite(samples[startOffset + i]) ? samples[startOffset + i] : 0;
        const abs = Math.abs(val);
        if (abs > globalPeak) globalPeak = abs;
        sumSq += val * val;
      }
      const rms = Math.sqrt(sumSq / frameSize);
      const dbfs = rmsToDbfs(rms);
      frames.push({
        index: f,
        rms,
        dbfs,
        isQuiet: dbfs < quietThresholdDbfs,
      });
    }

    let firstSoundFrame = -1;
    let lastSoundFrame = -1;
    let activeSumSq = 0;
    let activeFrameCount = 0;

    for (let f = 0; f < frames.length; f += 1) {
      if (!frames[f].isQuiet) {
        if (firstSoundFrame === -1) firstSoundFrame = f;
        lastSoundFrame = f;
        activeSumSq += frames[f].rms * frames[f].rms;
        activeFrameCount += 1;
      }
    }

    if (firstSoundFrame === -1) {
      return makeSilentReport(
        `No speech was detected above ${quietThresholdDbfs} dBFS. Check your microphone or speak closer to it.`
      );
    }

    const durationSeconds = samples.length / sampleRate;
    const firstSoundTime = firstSoundFrame * frameDuration;
    const lastSoundTime = (lastSoundFrame + 1) * frameDuration;
    const activeDurationSeconds = Math.max(frameDuration, lastSoundTime - firstSoundTime);

    // Find quiet stretches strictly inside [firstSoundFrame, lastSoundFrame] so leading and
    // trailing silence are ignored.
    const pauses = [];
    const minPauseFrames = Math.max(1, Math.round(minPauseSeconds / frameDuration));
    let runStart = -1;

    for (let f = firstSoundFrame + 1; f <= lastSoundFrame; f += 1) {
      if (frames[f].isQuiet) {
        if (runStart === -1) runStart = f;
      } else if (runStart !== -1) {
        const runFrames = f - runStart;
        if (runFrames >= minPauseFrames) {
          pauses.push({
            start: runStart * frameDuration,
            end: f * frameDuration,
            duration: runFrames * frameDuration,
          });
        }
        runStart = -1;
      }
    }

    const totalPauseSeconds = pauses.reduce((sum, p) => sum + p.duration, 0);
    const speakingSeconds = Math.max(0, activeDurationSeconds - totalPauseSeconds);
    const overallWpm = activeDurationSeconds > 0 ? (wordCount / activeDurationSeconds) * 60 : 0;
    const speakingOnlyWpm = speakingSeconds > 0 ? (wordCount / speakingSeconds) * 60 : 0;

    const pauseCount = pauses.length;
    const meanPauseSeconds = pauseCount > 0 ? totalPauseSeconds / pauseCount : 0;
    const longestPauseSeconds = pauseCount > 0 ? Math.max(...pauses.map((p) => p.duration)) : 0;

    let from018To030 = 0;
    let from030To050 = 0;
    let from050To080 = 0;
    let over080 = 0;

    for (const p of pauses) {
      const d = p.duration;
      if (d >= 0.8 - 1e-6) over080 += 1;
      else if (d >= 0.5 - 1e-6) from050To080 += 1;
      else if (d >= 0.3 - 1e-6) from030To050 += 1;
      else from018To030 += 1;
    }

    const pausesAtLeast05 = from050To080 + over080;

    const peakDbfs = rmsToDbfs(globalPeak);
    const speechRms = activeFrameCount > 0 ? Math.sqrt(activeSumSq / activeFrameCount) : 0;
    const speechRmsDbfs = rmsToDbfs(speechRms);

    let levelWarning = null;
    if (peakDbfs > -3) {
      levelWarning = "Too loud: move back or lower the gain";
    } else if (speechRmsDbfs < -30) {
      levelWarning = "Too quiet";
    }

    // Overall speed verdict thresholds: 135..155 good, 155..165 a bit fast, >165 too fast,
    // 125..135 a bit slow, <125 too slow. Small 1e-9 tolerance protects exact boundary hits.
    let speedVerdict;
    if (overallWpm < 125 - 1e-9) {
      speedVerdict = { label: "too slow", color: "red" };
    } else if (overallWpm < 135 - 1e-9) {
      speedVerdict = { label: "a bit slow", color: "amber" };
    } else if (overallWpm <= 155 + 1e-9) {
      speedVerdict = { label: "good", color: "green" };
    } else if (overallWpm <= 165 + 1e-9) {
      speedVerdict = { label: "a bit fast", color: "amber" };
    } else {
      speedVerdict = { label: "too fast", color: "red" };
    }

    // Pause verdict: good requires mean >= 0.40 s AND >= 1 long pause (>= 0.5 s) per 3 sentences.
    const requiredLongPauses = sentenceCount / 3;
    let pauseVerdict;
    if (pauseCount === 0) {
      pauseVerdict = { label: "no pauses", color: "red" };
    } else if (meanPauseSeconds >= 0.4 - 1e-6 && pausesAtLeast05 >= requiredLongPauses && pausesAtLeast05 >= 1) {
      pauseVerdict = { label: "good", color: "green" };
    } else if ((pausesAtLeast05 === 0 && sentenceCount >= 3) || meanPauseSeconds < 0.25) {
      pauseVerdict = { label: "too few pauses", color: "red" };
    } else if (meanPauseSeconds >= 0.4 - 1e-6) {
      pauseVerdict = { label: "too few pauses", color: "amber" };
    } else {
      pauseVerdict = { label: "needs longer pauses", color: "amber" };
    }

    let overallColor = "green";
    if (speedVerdict.color === "red" || pauseVerdict.color === "red") {
      overallColor = "red";
    } else if (speedVerdict.color === "amber" || pauseVerdict.color === "amber") {
      overallColor = "amber";
    }

    const advice = buildAdvice(overallWpm, speedVerdict, pauseVerdict, pausesAtLeast05, meanPauseSeconds, sentenceCount);

    return {
      isSilent: false,
      message: null,
      durationSeconds,
      firstSoundTime,
      lastSoundTime,
      activeDurationSeconds,
      speakingSeconds,
      totalPauseSeconds,
      overallWpm,
      speakingOnlyWpm,
      wordCount,
      sentenceCount,
      pauses,
      pauseCount,
      meanPauseSeconds,
      longestPauseSeconds,
      pausesAtLeast05,
      histogram: {
        from018To030,
        from030To050,
        from050To080,
        over080,
      },
      peakDbfs,
      speechRmsDbfs,
      levelWarning,
      speedVerdict,
      pauseVerdict,
      overallColor,
      advice,
    };
  }

  /**
   * Downsamples PCM audio into min/max/rms bins for fast canvas waveform drawing.
   */
  function buildWaveformBins(samples, sampleRate, numBins = 320) {
    if (!samples || samples.length === 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
      return { duration: 0, bins: [] };
    }
    const count = Math.max(1, Math.min(Math.floor(numBins), samples.length));
    const step = samples.length / count;
    const bins = [];
    for (let b = 0; b < count; b += 1) {
      const start = Math.floor(b * step);
      const end = Math.max(start + 1, Math.floor((b + 1) * step));
      let min = 1;
      let max = -1;
      let sumSq = 0;
      for (let i = start; i < end && i < samples.length; i += 1) {
        const s = Number.isFinite(samples[i]) ? samples[i] : 0;
        if (s < min) min = s;
        if (s > max) max = s;
        sumSq += s * s;
      }
      const n = Math.max(1, Math.min(end, samples.length) - start);
      bins.push({ min, max, rms: Math.sqrt(sumSq / n) });
    }
    return { duration: samples.length / sampleRate, bins };
  }

  /**
   * Encodes normalized float PCM samples [-1, 1] into a standard RIFF/WAVE mono 16-bit byte array.
   * Writing the header directly avoids relying on browser-specific WAV exporters.
   */
  function encodeWavMono16(samples, sampleRate = 48000) {
    const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? Math.round(sampleRate) : 48000;
    const length = samples ? samples.length : 0;
    const dataBytes = length * 2;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    const writeAscii = (offset, str) => {
      for (let i = 0; i < str.length; i += 1) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeAscii(0, "RIFF");
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(8, "WAVE");
    writeAscii(12, "fmt ");
    view.setUint32(16, 16, true); // PCM fmt chunk size
    view.setUint16(20, 1, true); // AudioFormat = 1 (linear PCM)
    view.setUint16(22, 1, true); // NumChannels = 1 (mono)
    view.setUint32(24, rate, true); // SampleRate
    view.setUint32(28, rate * 2, true); // ByteRate = SampleRate * 1 * 2
    view.setUint16(32, 2, true); // BlockAlign = 1 * 2
    view.setUint16(34, 16, true); // BitsPerSample = 16
    writeAscii(36, "data");
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let i = 0; i < length; i += 1) {
      const raw = Number.isFinite(samples[i]) ? samples[i] : 0;
      const clamped = Math.max(-1, Math.min(1, raw));
      const pcm = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
      view.setInt16(offset, pcm, true);
      offset += 2;
    }

    return new Uint8Array(buffer);
  }

  /**
   * Extracts a contiguous paragraph range [fromParaIndex..toParaIndex] as a standalone parsed script,
   * keeping beat titles and tone hints intact so single-paragraph practice plans and measures accurately.
   */
  function sliceScript(parsed, fromParaIndex = 0, toParaIndex = null) {
    if (!parsed || !Array.isArray(parsed.paragraphs) || parsed.paragraphs.length === 0) {
      throw new Error("Cannot slice an empty script.");
    }
    const maxIdx = parsed.paragraphs.length - 1;
    const startP = Math.max(0, Math.min(maxIdx, Math.floor(fromParaIndex)));
    const endP = toParaIndex === null || toParaIndex === undefined
      ? maxIdx
      : Math.max(startP, Math.min(maxIdx, Math.floor(toParaIndex)));

    const beats = [];
    const paragraphs = [];
    const sentences = [];
    const words = [];

    const beatMap = new Map();
    let storyWordCount = 0;
    let outroWordCount = 0;

    for (let pIdx = startP; pIdx <= endP; pIdx += 1) {
      const origPara = parsed.paragraphs[pIdx];
      const origBeat = parsed.beats[origPara.beatIndex];

      let beatEntry = beatMap.get(origBeat.index);
      if (!beatEntry) {
        beatEntry = {
          index: beats.length,
          title: origBeat.title,
          isOutro: origBeat.isOutro,
          paragraphIndices: [],
          sentenceIndices: [],
          firstWordIndex: words.length,
          lastWordIndex: words.length,
        };
        beatMap.set(origBeat.index, beatEntry);
        beats.push(beatEntry);
      }

      const newParaIndex = paragraphs.length;
      const newPara = {
        index: newParaIndex,
        beatIndex: beatEntry.index,
        sentenceIndices: [],
        firstWordIndex: words.length,
        lastWordIndex: words.length,
      };

      const isLastParaOverall = pIdx === endP;
      const nextOrigPara = !isLastParaOverall ? parsed.paragraphs[pIdx + 1] : null;
      const isLastParaInSliceBeat = isLastParaOverall || nextOrigPara.beatIndex !== origBeat.index;

      for (const sIdx of origPara.sentenceIndices) {
        const origSent = parsed.sentences[sIdx];
        const newSentIndex = sentences.length;
        const sentFirstWord = words.length;

        for (let wIdx = origSent.firstWordIndex; wIdx <= origSent.lastWordIndex; wIdx += 1) {
          const origW = parsed.words[wIdx];
          const isLastInPara = wIdx === origPara.lastWordIndex;
          words.push({
            index: words.length,
            text: origW.text,
            beat: beatEntry.index,
            paragraph: newParaIndex,
            sentence: newSentIndex,
            hintsBefore: origW.hintsBefore || [],
            isSentenceEnd: origW.isSentenceEnd,
            isCommaPause: origW.isCommaPause,
            isParagraphEnd: isLastInPara,
            isBeatEnd: isLastInPara && isLastParaInSliceBeat,
          });
          if (beatEntry.isOutro) outroWordCount += 1;
          else storyWordCount += 1;
        }

        sentences.push({
          index: newSentIndex,
          beatIndex: beatEntry.index,
          paragraphIndex: newParaIndex,
          hints: origSent.hints || [],
          text: origSent.text,
          firstWordIndex: sentFirstWord,
          lastWordIndex: words.length - 1,
        });
        newPara.sentenceIndices.push(newSentIndex);
        beatEntry.sentenceIndices.push(newSentIndex);
      }

      newPara.lastWordIndex = words.length - 1;
      paragraphs.push(newPara);
      beatEntry.paragraphIndices.push(newParaIndex);
      beatEntry.lastWordIndex = words.length - 1;
    }

    return {
      language: parsed.language,
      beats,
      paragraphs,
      sentences,
      words,
      stats: {
        beatCount: beats.length,
        storyBeatCount: beats.filter((b) => !b.isOutro).length,
        hasOutro: beats.some((b) => b.isOutro),
        paragraphCount: paragraphs.length,
        sentenceCount: sentences.length,
        wordCount: words.length,
        storyWordCount,
        outroWordCount,
      },
    };
  }

  return {
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
  };
})();

if (typeof globalThis !== "undefined") {
  globalThis.GuidedReaderCore = GuidedReaderCore;
}

if (typeof module === "object" && module && module.exports) {
  exports.DEFAULT_SETTINGS = GuidedReaderCore.DEFAULT_SETTINGS;
  exports.graphemeClusters = GuidedReaderCore.graphemeClusters;
  exports.detectLanguage = GuidedReaderCore.detectLanguage;
  exports.wordWeight = GuidedReaderCore.wordWeight;
  exports.parseScript = GuidedReaderCore.parseScript;
  exports.sliceScript = GuidedReaderCore.sliceScript;
  exports.planReading = GuidedReaderCore.planReading;
  exports.replanFromPosition = GuidedReaderCore.replanFromPosition;
  exports.measureRoomFloor = GuidedReaderCore.measureRoomFloor;
  exports.measureTake = GuidedReaderCore.measureTake;
  exports.buildWaveformBins = GuidedReaderCore.buildWaveformBins;
  exports.encodeWavMono16 = GuidedReaderCore.encodeWavMono16;
}
