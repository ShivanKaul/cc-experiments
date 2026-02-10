import { test, expect } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

let server;
let baseURL;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(join(rootDir, 'index.html')));
    } else if (req.url === '/whisper-worker.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(readFileSync(join(rootDir, 'whisper-worker.js')));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseURL = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

test.afterAll(async () => {
  server?.close();
});

test.use({
  launchOptions: {
    args: ['--ignore-certificate-errors'],
  },
});

test('long voice note transcription completes successfully', async ({ page }) => {
  page.on('console', msg => {
    console.log(`[browser ${msg.type()}] ${msg.text()}`);
  });

  await page.goto(baseURL);

  // Use whisper-tiny for speed in CI
  await page.locator('#modelSelect').selectOption('onnx-community/whisper-tiny');

  const longVoiceNote = join(__dirname, 'long-voice-note.wav');
  await page.locator('#fileInput').setInputFiles(longVoiceNote);

  const card = page.locator('.card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.card-filename')).toHaveText('long-voice-note.wav');

  // Wait for model to load
  await expect(page.locator('#modelBanner')).toHaveClass(/visible/, { timeout: 10_000 });

  // Wait for transcription to finish (up to 4 minutes for model download + transcription)
  const status = card.locator('.card-status');
  await expect(status).not.toHaveClass(/loading/, { timeout: 240_000 });

  const statusText = await status.textContent();
  const transcriptionText = await card.locator('.card-text').textContent();

  console.log('\n=== TRANSCRIPTION RESULT ===');
  console.log('Status:', statusText);
  console.log('Text:', transcriptionText);
  console.log('Text length:', transcriptionText.length);
  console.log('=== END ===\n');

  // Should complete without error
  expect(statusText).toBe('done');
  expect(transcriptionText).not.toContain('Error');
});

test('long voice note produces non-degenerate output', async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error') console.log(`[browser error] ${msg.text()}`);
  });

  await page.goto(baseURL);

  // Use whisper-tiny for speed in CI
  await page.locator('#modelSelect').selectOption('onnx-community/whisper-tiny');

  const longVoiceNote = join(__dirname, 'long-voice-note.wav');
  await page.locator('#fileInput').setInputFiles(longVoiceNote);

  const card = page.locator('.card').first();
  const status = card.locator('.card-status');
  await expect(status).not.toHaveClass(/loading/, { timeout: 240_000 });

  const transcriptionText = await card.locator('.card-text').textContent();
  const words = transcriptionText.trim().split(/\s+/);

  console.log('Word count:', words.length);

  // A ~10 minute voice note should produce substantial output
  expect(words.length).toBeGreaterThan(50);

  // Check for degenerate repetition: count unique 5-word phrases.
  // If the same phrase repeats excessively, the transcription is hallucinating.
  const phrases = [];
  for (let i = 0; i <= words.length - 5; i++) {
    phrases.push(words.slice(i, i + 5).join(' '));
  }
  const phraseCounts = {};
  for (const p of phrases) {
    phraseCounts[p] = (phraseCounts[p] || 0) + 1;
  }
  const maxRepeat = Math.max(...Object.values(phraseCounts));
  const uniqueRatio = Object.keys(phraseCounts).length / phrases.length;

  console.log('Max phrase repetition:', maxRepeat);
  console.log('Unique phrase ratio:', uniqueRatio.toFixed(3));

  // Without chunking, the model hallucinates a single repeated sentence
  // (e.g. "I think I have been able to do this" x44), giving uniqueRatio ~0.03.
  // With chunking, whisper-tiny still has some repetition but produces real
  // varied content, giving uniqueRatio ~0.2+.
  // Threshold of 0.1 clearly separates the two cases.
  expect(uniqueRatio).toBeGreaterThan(0.1);
  expect(maxRepeat).toBeLessThan(phrases.length * 0.5);
});
