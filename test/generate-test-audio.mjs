// Generate a 3-second WAV file with a 440Hz sine wave (16kHz, mono, 16-bit PCM).
// This is enough to verify the full pipeline: file upload → audio decode → Whisper inference → result.
// Whisper will likely output silence/noise transcription, but the flow completing without error is what matters.

import { writeFileSync } from 'fs';

const sampleRate = 16000;
const duration = 3; // seconds
const frequency = 440; // Hz
const numSamples = sampleRate * duration;

// 16-bit PCM samples
const samples = new Int16Array(numSamples);
for (let i = 0; i < numSamples; i++) {
  samples[i] = Math.round(0.5 * 32767 * Math.sin(2 * Math.PI * frequency * i / sampleRate));
}

// WAV header
const byteRate = sampleRate * 2; // 16-bit mono
const dataSize = numSamples * 2;
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + dataSize, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);       // chunk size
header.writeUInt16LE(1, 20);        // PCM format
header.writeUInt16LE(1, 22);        // mono
header.writeUInt32LE(sampleRate, 24);
header.writeUInt32LE(byteRate, 28);
header.writeUInt16LE(2, 32);        // block align
header.writeUInt16LE(16, 34);       // bits per sample
header.write('data', 36);
header.writeUInt32LE(dataSize, 40);

const wav = Buffer.concat([header, Buffer.from(samples.buffer)]);
writeFileSync(new URL('./test-audio.wav', import.meta.url), wav);
console.log(`Generated test-audio.wav: ${duration}s, ${sampleRate}Hz, ${numSamples} samples`);
