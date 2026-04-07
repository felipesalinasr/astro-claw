/**
 * Local Whisper transcription using @huggingface/transformers.
 *
 * Zero-config, no API keys, no cloud calls. The model (~40MB for tiny.en) is
 * downloaded on first use and cached in ~/.cache/huggingface for subsequent
 * runs. Falls back gracefully if anything fails — caller can save the audio
 * file and let Claude handle it.
 */

import { existsSync } from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { resolve, basename } from "node:path";
import { homedir } from "node:os";

// Lazy-loaded pipeline (downloads model on first call)
let _pipeline = null;
let _pipelinePromise = null;

const MODEL = process.env.ASTRO_CLAW_WHISPER_MODEL || "Xenova/whisper-tiny.en";

async function getPipeline() {
  if (_pipeline) return _pipeline;
  if (_pipelinePromise) return _pipelinePromise;

  _pipelinePromise = (async () => {
    console.log(`[Transcribe] Loading model: ${MODEL} (first run downloads ~40MB)`);
    const { pipeline, env } = await import("@huggingface/transformers");
    // Use the standard HF cache so other tools can share it
    env.cacheDir = resolve(homedir(), ".cache", "huggingface");
    _pipeline = await pipeline("automatic-speech-recognition", MODEL, {
      quantized: true,
    });
    console.log(`[Transcribe] Model ready`);
    return _pipeline;
  })();

  return _pipelinePromise;
}

// Find ffmpeg on PATH
function findFfmpeg() {
  try {
    const out = execSync("which ffmpeg", { encoding: "utf-8", stdio: ["pipe", "pipe", "ignore"] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Decode any audio file to a Float32Array of 16kHz mono PCM samples using ffmpeg.
// Whisper requires this exact format.
function decodeAudioToPcm(inputPath) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    throw new Error("ffmpeg not found — install with `brew install ffmpeg` to enable voice transcription");
  }

  // Run ffmpeg to convert to raw 16kHz mono float32 PCM, write to stdout
  const result = spawnSync(
    ffmpeg,
    [
      "-i", inputPath,
      "-f", "f32le",       // raw 32-bit float little-endian
      "-acodec", "pcm_f32le",
      "-ac", "1",          // mono
      "-ar", "16000",      // 16kHz
      "-loglevel", "error",
      "pipe:1",
    ],
    { maxBuffer: 200 * 1024 * 1024 }  // up to 200MB of decoded PCM
  );

  if (result.status !== 0) {
    const stderr = result.stderr?.toString() || "";
    throw new Error(`ffmpeg decode failed: ${stderr.slice(0, 200)}`);
  }

  // Convert Buffer to Float32Array (must be aligned)
  const buffer = result.stdout;
  const aligned = new ArrayBuffer(buffer.length);
  new Uint8Array(aligned).set(buffer);
  return new Float32Array(aligned);
}

/**
 * Transcribe an audio file to text. Returns null on any failure.
 *
 * @param {string} audioPath - absolute path to an audio file (any format ffmpeg can read)
 * @returns {Promise<string|null>} the transcribed text, or null if it failed
 */
export async function transcribeAudio(audioPath) {
  if (!existsSync(audioPath)) {
    console.error(`[Transcribe] File not found: ${audioPath}`);
    return null;
  }

  try {
    // 1. Decode to PCM
    const pcm = decodeAudioToPcm(audioPath);
    if (pcm.length === 0) {
      console.error(`[Transcribe] No audio samples decoded from ${audioPath}`);
      return null;
    }

    const durationSec = pcm.length / 16000;
    console.log(`[Transcribe] ${basename(audioPath)}: ${durationSec.toFixed(1)}s of audio`);

    // 2. Load model (lazy)
    const transcriber = await getPipeline();

    // 3. Transcribe
    const result = await transcriber(pcm, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const text = (result?.text || "").trim();
    if (!text) {
      console.error(`[Transcribe] Empty result for ${audioPath}`);
      return null;
    }

    console.log(`[Transcribe] ${basename(audioPath)} → "${text.slice(0, 100)}${text.length > 100 ? "..." : ""}"`);
    return text;
  } catch (err) {
    console.error(`[Transcribe] Failed for ${audioPath}: ${err.message}`);
    return null;
  }
}

/**
 * Check if transcription is available on this system.
 * Returns { available: boolean, reason?: string }
 */
export function checkTranscriptionAvailable() {
  if (!findFfmpeg()) {
    return {
      available: false,
      reason: "ffmpeg not installed (run: brew install ffmpeg)",
    };
  }
  return { available: true };
}
