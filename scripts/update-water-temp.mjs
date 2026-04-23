#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const DATA_DIR = path.join(projectRoot, 'data');
const DATA_FILE = path.join(DATA_DIR, 'water-temperature.json');

const SOURCE_URLS = [
  'https://www.scubw.de/wswin/html/current.html',
  'https://www.scubw.de/wetter.html'
];

function normalizeNumber(value) {
  return Number.parseFloat(String(value).replace(',', '.'));
}

function ensureReasonableTemperature(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`Ungültiger Temperaturwert: ${value}`);
  }
  if (value < -5 || value > 40) {
    throw new Error(`Unplausibler Temperaturwert erkannt: ${value} °C`);
  }
  return value;
}

function formatDateBerlin(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&deg;/gi, '°')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function htmlToPlainText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function findTemperatureNearLabel(lines, labelRegex, maxLookahead = 8) {
  for (let i = 0; i < lines.length; i += 1) {
    if (!labelRegex.test(lines[i])) continue;

    for (let j = i; j <= Math.min(i + maxLookahead, lines.length - 1); j += 1) {
      const match = lines[j].match(/([0-9]+(?:[.,][0-9]+)?)\s*°?\s*C/i);
      if (match) {
        return ensureReasonableTemperature(normalizeNumber(match[1]));
      }
    }
  }
  return null;
}

function extractTemperature(html) {
  const plainText = htmlToPlainText(html);
  const lines = plainText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const labelPatterns = [
    /wassertemp/i,
    /wassertemperatur/i,
    /temperatur wasser/i,
    /wasser temp/i
  ];

  for (const pattern of labelPatterns) {
    const result = findTemperatureNearLabel(lines, pattern, 10);
    if (result !== null) return result;
  }

  const fullText = lines.join(' ');
  const fallbackPatterns = [
    /Wassertemp[\s\S]{0,120}?([0-9]+(?:[.,][0-9]+)?)\s*°?\s*C/i,
    /Wassertemperatur[\s\S]{0,120}?([0-9]+(?:[.,][0-9]+)?)\s*°?\s*C/i,
    /Temperatur\s*Wasser[\s\S]{0,120}?([0-9]+(?:[.,][0-9]+)?)\s*°?\s*C/i
  ];

  for (const pattern of fallbackPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return ensureReasonableTemperature(normalizeNumber(match[1]));
    }
  }

  throw new Error(
    'Wassertemperatur konnte auf der Quellseite nicht gefunden werden. Prüfe die HTML-Struktur oder ergänze den Parser.'
  );
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; HardtseeTemperatureBot/1.0)',
      'accept-language': 'de-DE,de;q=0.9,en;q=0.8',
      'cache-control': 'no-cache'
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} bei ${url}`);
  }

  return await response.text();
}

async function fetchTemperatureFromSources() {
  const errors = [];

  for (const url of SOURCE_URLS) {
    try {
      const html = await fetchHtml(url);
      const temperature = extractTemperature(html);
      return { temperature, sourceUrl: url };
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }

  throw new Error(
    `Keine Quelle lieferte eine Wassertemperatur.\n${errors.join('\n')}`
  );
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readHistory() {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      throw new Error('Die JSON-Datei enthält kein Array.');
    }

    return parsed
      .filter(
        (entry) =>
          entry &&
          typeof entry.date === 'string' &&
          Number.isFinite(entry.temperature)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

function upsertToday(history, newEntry) {
  const index = history.findIndex((entry) => entry.date === newEntry.date);

  if (index >= 0) {
    history[index] = {
      ...history[index],
      ...newEntry,
      updatedAt: newEntry.updatedAt
    };
  } else {
    history.push(newEntry);
  }

  history.sort((a, b) => a.date.localeCompare(b.date));
  return history;
}

async function writeHistory(history) {
  await fs.writeFile(DATA_FILE, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
}

async function main() {
  await ensureDataDir();

  const { temperature, sourceUrl } = await fetchTemperatureFromSources();
  const today = formatDateBerlin(new Date());
  const nowIso = new Date().toISOString();

  const history = await readHistory();

  const updatedHistory = upsertToday(history, {
    date: today,
    temperature,
    source: sourceUrl,
    updatedAt: nowIso
  });

  await writeHistory(updatedHistory);

  console.log('Wassertemperatur erfolgreich aktualisiert.');
  console.log(`Datum: ${today}`);
  console.log(`Temperatur: ${temperature} °C`);
  console.log(`Quelle: ${sourceUrl}`);
  console.log(`Datei: ${DATA_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
