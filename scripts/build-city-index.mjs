import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const sourcePath = '.tmp-csc/json-cities.json.gz';
const outputPath = 'public/cities.min.json';
const sourceUrl = 'https://github.com/dr5hn/countries-states-cities-database/releases/latest/download/json-cities.json.gz';

if (!existsSync(sourcePath)) {
  console.log(`Downloading ${sourceUrl}...`);
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not download city source (${response.status})`);
  }

  mkdirSync('.tmp-csc', { recursive: true });
  writeFileSync(sourcePath, Buffer.from(await response.arrayBuffer()));
}

mkdirSync('public', { recursive: true });
const cities = JSON.parse(gunzipSync(readFileSync(sourcePath)));
const seen = new Set();
const reduced = [];

for (const city of cities) {
  if (!city.name || !city.country_name || !city.latitude || !city.longitude) {
    continue;
  }

  const state = city.state_name || '';
  const lat = Number(Number(city.latitude).toFixed(5));
  const lng = Number(Number(city.longitude).toFixed(5));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    continue;
  }

  const key = `${city.name}\u0000${state}\u0000${city.country_name}\u0000${lat}\u0000${lng}`;
  if (seen.has(key)) {
    continue;
  }

  seen.add(key);
  reduced.push([city.name, state, city.country_name, lat, lng]);
}

reduced.sort((a, b) => a[0].localeCompare(b[0])
  || a[2].localeCompare(b[2])
  || a[1].localeCompare(b[1]));

writeFileSync(outputPath, JSON.stringify(reduced));
const size = statSync(outputPath).size;
console.log(`Wrote ${reduced.length} cities to ${outputPath} (${(size / 1024 / 1024).toFixed(2)} MiB).`);
