import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const DEFAULT_COUNT = 200;
const DEFAULT_INTERVAL_MS = 3000;
const MAX_LOCATION_JITTER = 0.045;

const asiaLocations = [
  ['Singapore', 'Singapore', 1.28967, 103.85007],
  ['Kyoto', 'Japan', 35.01164, 135.76803],
  ['Tokyo', 'Japan', 35.6895, 139.69171],
  ['Osaka', 'Japan', 34.69374, 135.50218],
  ['Seoul', 'South Korea', 37.566, 126.9784],
  ['Busan', 'South Korea', 35.17955, 129.07564],
  ['Taipei', 'Taiwan', 25.04776, 121.53185],
  ['Tainan', 'Taiwan', 22.99083, 120.21333],
  ['Hong Kong', 'Hong Kong S.A.R.', 22.27933, 114.16281],
  ['Macau', 'Macau S.A.R.', 22.20056, 113.54611],
  ['Bangkok', 'Thailand', 13.75633, 100.50177],
  ['Chiang Mai', 'Thailand', 18.78834, 98.9853],
  ['Phuket', 'Thailand', 7.88045, 98.39225],
  ['Hanoi', 'Vietnam', 21.0245, 105.84117],
  ['Ho Chi Minh City', 'Vietnam', 10.82302, 106.62965],
  ['Da Nang', 'Vietnam', 16.06778, 108.22083],
  ['Hoi An', 'Vietnam', 15.87944, 108.335],
  ['Kuala Lumpur', 'Malaysia', 3.1412, 101.68653],
  ['George Town', 'Malaysia', 5.41413, 100.32875],
  ['Langkawi', 'Malaysia', 6.3502, 99.73197],
  ['Jakarta', 'Indonesia', -6.21462, 106.84513],
  ['Bali', 'Indonesia', -8.40952, 115.18892],
  ['Yogyakarta', 'Indonesia', -7.80139, 110.36472],
  ['Manila', 'Philippines', 14.59951, 120.98422],
  ['Cebu City', 'Philippines', 10.31672, 123.89071],
  ['Boracay', 'Philippines', 11.9674, 121.9248],
  ['Siem Reap', 'Cambodia', 13.36179, 103.86056],
  ['Phnom Penh', 'Cambodia', 11.56245, 104.91601],
  ['Luang Prabang', 'Laos', 19.88556, 102.13472],
  ['Vientiane', 'Laos', 17.96667, 102.6],
  ['Yangon', 'Myanmar', 16.80528, 96.15611],
  ['Bagan', 'Myanmar', 21.1717, 94.8585],
  ['Kathmandu', 'Nepal', 27.70169, 85.3206],
  ['Pokhara', 'Nepal', 28.2096, 83.9856],
  ['Thimphu', 'Bhutan', 27.46609, 89.64191],
  ['Dhaka', 'Bangladesh', 23.7104, 90.40744],
  ['Colombo', 'Sri Lanka', 6.93194, 79.84778],
  ['Galle', 'Sri Lanka', 6.0329, 80.2168],
  ['Malé', 'Maldives', 4.1748, 73.50888],
  ['Delhi', 'India', 28.65195, 77.23149],
  ['Mumbai', 'India', 19.07283, 72.88261],
  ['Jaipur', 'India', 26.91962, 75.78781],
  ['Agra', 'India', 27.18333, 78.01667],
  ['Goa', 'India', 15.29933, 74.124],
  ['Bengaluru', 'India', 12.97194, 77.59369],
  ['Kolkata', 'India', 22.56263, 88.36304],
  ['Shanghai', 'China', 31.22222, 121.45806],
  ['Beijing', 'China', 39.9075, 116.39723],
  ['Xi’an', 'China', 34.25833, 108.92861],
  ['Chengdu', 'China', 30.66667, 104.06667],
  ['Hangzhou', 'China', 30.29365, 120.16142],
  ['Guilin', 'China', 25.28194, 110.28639],
  ['Ulaanbaatar', 'Mongolia', 47.90771, 106.88324],
  ['Dubai', 'United Arab Emirates', 25.20485, 55.27078],
  ['Abu Dhabi', 'United Arab Emirates', 24.46667, 54.36667],
  ['Doha', 'Qatar', 25.28545, 51.53096],
  ['Muscat', 'Oman', 23.61387, 58.5922],
  ['Istanbul', 'Türkiye', 41.01384, 28.94966],
  ['Cappadocia', 'Türkiye', 38.64306, 34.82889],
  ['Amman', 'Jordan', 31.95522, 35.94503],
  ['Petra', 'Jordan', 30.32845, 35.44436],
];

const names = [
  'Aarav', 'Aisha', 'Akira', 'Ananya', 'Arjun', 'Bao', 'Chen', 'Dewi', 'Farah', 'Hana',
  'Haruto', 'Hui Min', 'Irfan', 'Jae', 'Jia', 'Kavya', 'Kenji', 'Linh', 'Mei', 'Minh',
  'Nadia', 'Nisha', 'Priya', 'Rahul', 'Rina', 'Sakura', 'Sanjay', 'Siti', 'Sora', 'Tariq',
  'Wei', 'Yuna', 'Zara', 'Anika', 'Darren', 'Elaine', 'Fiona', 'Gabriel', 'Hazel', 'Ivan',
];

const memoryTemplates = [
  'Tried street food after a long walk through the old town',
  'Watched the sunrise from a quiet lookout point',
  'Took my favourite photo of the whole trip here',
  'Got wonderfully lost exploring side streets and markets',
  'Shared a memorable meal with friends after work',
  'Visited a temple and stayed longer than planned',
  'Found a small cafe that became the trip highlight',
  'Celebrated a milestone with family here',
  'Joined a local tour and learned a surprising story',
  'Spent the evening walking by the waterfront',
  'Returned to a place I had dreamed about for years',
  'Met kind locals who helped us find the best food',
  'Took a scenic train ride that ended near this spot',
  'Rested here after a packed day of sightseeing',
  'Bought souvenirs from a tiny neighbourhood shop',
  'Had a rainy-day adventure that turned out perfect',
  'Saw city lights from above after dinner',
  'Started a backpacking trip from this city',
  'Discovered a peaceful garden in the middle of the city',
  'Made a spontaneous stop that became unforgettable',
];

const noteTemplates = [
  'The food, colours, and energy made this place impossible to forget.',
  'I still remember the sounds of the streets and the kindness of strangers.',
  'This was one of those travel days where every small detour worked out.',
  'A simple walk here turned into my favourite memory from the trip.',
  'I would go back for the food alone, but the views were just as good.',
  'It felt special because I got to slow down and enjoy the moment.',
  'The photos from here still make me smile whenever they come up.',
  'A great reminder that the best travel memories are often unplanned.',
  'This place had the perfect mix of history, food, and atmosphere.',
  'I left with a full camera roll and a very full stomach.',
];

function readEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const separatorIndex = line.indexOf('=');
      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      const value = rawValue.replace(/^['"]|['"]$/g, '');
      return [key, value];
    }));
}

function readConfig() {
  const env = {
    ...readEnvFile('.env'),
    ...readEnvFile('.env.local'),
    ...process.env,
  };

  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const missingKeys = Object.entries(config)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missingKeys.length > 0) {
    throw new Error(`Missing Firebase config values: ${missingKeys.join(', ')}`);
  }

  return config;
}

function readArgs() {
  const args = process.argv.slice(2);
  const options = {
    count: DEFAULT_COUNT,
    intervalMs: DEFAULT_INTERVAL_MS,
    eventKey: process.env.EVENT_KEY || '',
    dryRun: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const nextValue = args[index + 1];
    if (arg === '--count') {
      options.count = Number(nextValue);
      index += 1;
    } else if (arg === '--interval-ms') {
      options.intervalMs = Number(nextValue);
      index += 1;
    } else if (arg === '--event-key') {
      options.eventKey = nextValue || '';
      index += 1;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isInteger(options.count) || options.count < 1) {
    throw new Error('--count must be a positive integer.');
  }

  if (!Number.isInteger(options.intervalMs) || options.intervalMs < 0) {
    throw new Error('--interval-ms must be a non-negative integer.');
  }

  if (!options.eventKey) {
    throw new Error('Provide the event key with --event-key or EVENT_KEY.');
  }

  return options;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function seededValue(seed) {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
}

function pick(list, index, offset = 0) {
  return list[(index + offset) % list.length];
}

function jitterCoordinate(value, index, axisOffset) {
  const jitter = (seededValue(index + axisOffset) - 0.5) * MAX_LOCATION_JITTER;
  return Number((value + jitter).toFixed(6));
}

function createPin(index, eventKey, ownerId) {
  const [city, country, baseLat, baseLng] = pick(asiaLocations, index);
  const userName = pick(names, index, Math.floor(index / names.length));
  const memory = pick(memoryTemplates, index, Math.floor(index / 7));
  const note = pick(noteTemplates, index, Math.floor(index / 5));

  return {
    lat: jitterCoordinate(baseLat, index, 11),
    lng: jitterCoordinate(baseLng, index, 23),
    userName,
    locationName: `${memory} in ${city}`,
    note: `${city}, ${country}. ${note}`,
    ownerId,
    eventKey,
  };
}

function documentId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(20);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function firestoreValue(value) {
  if (typeof value === 'number') {
    return { doubleValue: value };
  }

  return { stringValue: value };
}

function firestoreFields(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [key, firestoreValue(value)]));
}

async function signInAnonymouslyWithRest(apiKey) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ returnSecureToken: true }),
  });

  if (!response.ok) {
    throw new Error(`Anonymous sign-in failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function createPinDocument({ projectId, idToken, pin }) {
  const docId = documentId();
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: `projects/${projectId}/databases/(default)/documents/pins/${docId}`,
            fields: firestoreFields(pin),
          },
          updateTransforms: [
            {
              fieldPath: 'createdAt',
              setToServerValue: 'REQUEST_TIME',
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not create pin (${response.status}): ${await response.text()}`);
  }

  return docId;
}

async function main() {
  const options = readArgs();
  const config = readConfig();
  const authResponse = options.dryRun
    ? { idToken: '', localId: 'dry-run-owner' }
    : await signInAnonymouslyWithRest(config.apiKey);

  console.log(`Preparing ${options.count} Asia pins with ${options.intervalMs}ms between writes.`);
  for (let index = 0; index < options.count; index += 1) {
    const pin = createPin(index, options.eventKey, authResponse.localId);
    if (options.dryRun) {
      console.log(`[dry-run ${index + 1}/${options.count}] ${pin.locationName}`);
    } else {
      const docId = await createPinDocument({
        projectId: config.projectId,
        idToken: authResponse.idToken,
        pin,
      });
      console.log(`[${index + 1}/${options.count}] Created ${docId}: ${pin.locationName}`);
    }

    if (index < options.count - 1 && options.intervalMs > 0) {
      await wait(options.intervalMs);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
