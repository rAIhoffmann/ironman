import fs from 'fs/promises';

const SOURCE_URL = 'https://www.scubw.de/wetter.html';
const OUTPUT_PATH = new URL('../data/temperature-history.json', import.meta.url);

function toIsoAtSixBerlin(date = new Date()) {
  const berlin = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
  return `${berlin}T06:00:00+02:00`;
}

function normalizeHtml(html) {
  return html
    .replace(/&nbsp;/g, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTemperature(html) {
  const cleaned = normalizeHtml(html);

  const patterns = [
    /Temperatur\s*Wasser[^\d-]*(-?\d{1,2}(?:[.,]\d)?)\s*°?\s*C/i,
    /Wassertemperatur[^\d-]*(-?\d{1,2}(?:[.,]\d)?)\s*°?\s*C/i,
    /Wasser(?:[^\d<]{0,40}|<[^>]+>){0,8}(-?\d{1,2}(?:[.,]\d)?)\s*°?\s*C/i,
    /Temperatur(?:[^\d<]{0,40}|<[^>]+>){0,8}Wasser(?:[^\d<]{0,40}|<[^>]+>){0,8}(-?\d{1,2}(?:[.,]\d)?)/i,
    /\bwater\b(?:[^\d<]{0,40}|<[^>]+>){0,8}(-?\d{1,2}(?:[.,]\d)?)\s*°?\s*C/i
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern) || html.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1].replace(',', '.'));
      if (!Number.isNaN(value) && value > -5 && value < 40) return value;
    }
  }

  const fallbackWindowMatch = cleaned.match(/(Temperatur\s*Wasser|Wassertemperatur|Wasser).{0,120}/i);
  if (fallbackWindowMatch) {
    const valueMatch = fallbackWindowMatch[0].match(/(-?\d{1,2}(?:[.,]\d)?)\s*°?\s*C?/i);
    if (valueMatch?.[1]) {
      const value = Number(valueMatch[1].replace(',', '.'));
      if (!Number.isNaN(value) && value > -5 && value < 40) return value;
    }
  }

  throw new Error('Wassertemperatur konnte auf der Quellseite nicht gefunden werden. Prüfe die HTML-Struktur oder ergänze den Parser.');
}

async function fetchHtml() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; HardtseeTempBot/1.0; +https://github.com/)'
    }
  });
  if (!response.ok) {
    throw new Error(`Abruf fehlgeschlagen: ${response.status} ${response.statusText}`);
  }
  return await response.text();
}

async function loadHistory() {
  try {
    const raw = await fs.readFile(OUTPUT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {
      location: 'Hardtsee, Ubstadt-Weiher',
      sourcePage: SOURCE_URL,
      measurement: 'Temperatur Wasser',
      entries: []
    };
  }
}

async function saveHistory(history) {
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(history, null, 2) + '\n', 'utf-8');
}

async function main() {
  const html = await fetchHtml();
  const temperatureC = extractTemperature(html);
  const history = await loadHistory();
  const recordedAt = toIsoAtSixBerlin(new Date());
  const recordedDate = recordedAt.slice(0, 10);

  const existingIndex = history.entries.findIndex(entry => String(entry.recordedAt).slice(0, 10) === recordedDate);
  const newEntry = {
    recordedAt,
    temperatureC,
    source: SOURCE_URL
  };

  if (existingIndex >= 0) {
    history.entries[existingIndex] = newEntry;
  } else {
    history.entries.push(newEntry);
  }

  history.entries.sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  history.lastUpdated = new Date().toISOString();
  await saveHistory(history);

  console.log(`Gespeichert: ${temperatureC.toFixed(1)} °C für ${recordedDate}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
