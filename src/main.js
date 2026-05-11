import './styles.css';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import QRCode from 'qrcode';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInAnonymously,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import { auth, db, missingFirebaseConfig } from './firebase.js';
import { censorProfanity } from './profanity.js';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const APP_TITLE = 'Travel Memories - Staff Appreciation Dinner 2026';
const WORLD_BOUNDS = [[-60, -180], [85, 180]];
const DISPLAY_WORLD_BOUNDS = [[-55, -180], [72, 140]];
const DISPLAY_INITIAL_PAN = [130, 0];
const DISPLAY_ANIMATION_DURATION_SECONDS = 2.25;
const DISPLAY_ANIMATION_HOLD_MS = 20000;
const DISPLAY_WORLD_VIEW_HOLD_MS = 60000;
const RANDOM_PIN_DETAILS_MS = 8000;
const PIN_DETAILS_PER_BATCH = 5;
const VERSION_CHECK_INTERVAL_MS = 60000;
const DISPLAY_PREFERENCES_STORAGE_KEY = 'map-activity:display-preferences';
const CITY_INDEX_URL = '/cities.min.json';
const DISPLAY_ANIMATION_VIEWS = [
  { label: 'Europe', shortLabel: 'EU', bounds: [[35, -12], [72, 35]] },
  { label: 'North America', shortLabel: 'NAm', bounds: [[8, -170], [72, -52]] },
  { label: 'South America', shortLabel: 'SAm', bounds: [[-56, -86], [14, -32]] },
  { label: 'Africa', shortLabel: 'AF', bounds: [[-36, -20], [38, 52]] },
  { label: 'Asia', shortLabel: 'Asia', bounds: [[-10, 45], [72, 150]] },
  { label: 'South-east Asia', shortLabel: 'SEA', bounds: [[-12, 92], [25, 142]] },
  { label: 'Singapore', shortLabel: 'SG', bounds: [[1.16, 103.55], [1.48, 104.12]] },
  { label: 'Australia-New Zealand', shortLabel: 'ANZ', bounds: [[-48, 108], [-9, 180]] },
  { label: 'Original view', shortLabel: 'World', bounds: DISPLAY_WORLD_BOUNDS, home: true },
];
const app = document.querySelector('#app');

const pinIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const animatedPinIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  className: 'pin-marker pin-marker--new',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
});

const activeCleanups = [];
let cityIndexPromise = null;

function assetSignatureFromDocument(doc, baseUrl = window.location.origin) {
  return Array.from(doc.querySelectorAll('script[src], link[rel="stylesheet"][href]'))
    .map((element) => new URL(element.getAttribute('src') || element.getAttribute('href'), baseUrl).pathname)
    .sort()
    .join('|');
}

function startDeploymentRefreshPolling() {
  if (!import.meta.env.PROD || typeof window === 'undefined') {
    return;
  }

  let currentSignature = assetSignatureFromDocument(document);
  let isChecking = false;
  let hasReloadScheduled = false;

  const checkForDeployment = async () => {
    if (isChecking || hasReloadScheduled || document.visibilityState === 'hidden') {
      return;
    }

    isChecking = true;

    try {
      const response = await fetch(`/index.html?ts=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });

      if (!response.ok) {
        return;
      }

      const nextHtml = await response.text();
      const nextDocument = new DOMParser().parseFromString(nextHtml, 'text/html');
      const nextSignature = assetSignatureFromDocument(nextDocument);

      if (!currentSignature) {
        currentSignature = nextSignature;
        return;
      }

      if (nextSignature && nextSignature !== currentSignature) {
        hasReloadScheduled = true;
        window.location.reload();
      }
    } catch {
      // Ignore transient network failures and retry on the next interval.
    } finally {
      isChecking = false;
    }
  };

  window.setInterval(checkForDeployment, VERSION_CHECK_INTERVAL_MS);
  window.addEventListener('focus', checkForDeployment);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForDeployment();
    }
  });
}

function readDisplayPreferences() {
  if (typeof window === 'undefined') {
    return {
      animate: false,
      showMessages: false,
    };
  }

  try {
    const rawValue = window.localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY);
    if (!rawValue) {
      return {
        animate: false,
        showMessages: false,
      };
    }

    const parsed = JSON.parse(rawValue);
    const animate = parsed?.animate === true;
    const showMessages = !animate && parsed?.showMessages === true;

    return {
      animate,
      showMessages,
    };
  } catch {
    return {
      animate: false,
      showMessages: false,
    };
  }
}

function writeDisplayPreferences(preferences) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    const animate = preferences.animate === true;
    const showMessages = !animate && preferences.showMessages === true;

    window.localStorage.setItem(
      DISPLAY_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        animate,
        showMessages,
      }),
    );
  } catch {
    // Ignore storage failures and continue with in-memory state.
  }
}

function cleanup() {
  while (activeCleanups.length > 0) {
    const dispose = activeCleanups.pop();
    dispose();
  }
}

function render(html) {
  cleanup();
  app.innerHTML = html;
}

function requireFirebase() {
  if (missingFirebaseConfig.length === 0) {
    return true;
  }

  render(`
    <main class="center-page">
      <section class="card setup-card">
        <p class="eyebrow">Setup needed</p>
        <h1>Firebase is not configured</h1>
        <p>Create a <code>.env</code> file from <code>.env.example</code> and fill in your Firebase web app settings.</p>
        <p class="muted">Missing: ${missingFirebaseConfig.map((key) => `<code>${escapeHtml(key)}</code>`).join(', ')}</p>
      </section>
    </main>
  `);
  return false;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function normalizeCityText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function loadCityIndex() {
  if (!cityIndexPromise) {
    cityIndexPromise = fetch(CITY_INDEX_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load city list (${response.status})`);
        }
        return response.json();
      })
      .then((rows) => rows.map(([city, state, country, lat, lng]) => {
        const searchText = normalizeCityText(`${city} ${state} ${country}`);
        const normalizedCity = normalizeCityText(city);

        return {
          city,
          state,
          country,
          lat,
          lng,
          label: `${city}, ${country}`,
          searchText,
          normalizedCity,
        };
      }));
  }

  return cityIndexPromise;
}

function formatDate(timestamp) {
  if (!timestamp?.toDate) {
    return 'Pending';
  }

  return timestamp.toDate().toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

async function verifyAllowlistAccess(user) {
  if (!user || !user.email) {
    return false;
  }

  const eventConfig = await getDoc(doc(db, 'config', 'event'));
  return eventConfig.exists() && auth.currentUser?.uid === user.uid;
}

function bindAllowlistGate(renderAllowedPage, options = {}) {
  const {
    checkingTitle = 'Checking login...',
    signInTitle = 'Sign in to continue',
    signInMessage = 'Use a Google account included in the backend allowlist.',
    deniedTitle = 'Access not allowed',
  } = options;

  if (!requireFirebase()) {
    return;
  }

  render(`
    <main class="center-page">
      <section class="card auth-card">
        <p class="eyebrow">${APP_TITLE}</p>
        <h1>${checkingTitle}</h1>
      </section>
    </main>
  `);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      render(`
        <main class="center-page">
          <section class="card auth-card">
            <p class="eyebrow">${APP_TITLE}</p>
            <h1>${signInTitle}</h1>
            <p>${signInMessage}</p>
            <div class="button-row">
              <button class="primary-button" data-google-login>Sign in with Google</button>
            </div>
          </section>
        </main>
      `);
      app.querySelector('[data-google-login]')?.addEventListener('click', signInWithGoogle);
      return;
    }

    try {
      render(`
        <main class="center-page">
          <section class="card auth-card">
            <p class="eyebrow">${APP_TITLE}</p>
            <h1>Checking access...</h1>
          </section>
        </main>
      `);
      const hasAccess = await verifyAllowlistAccess(user);
      if (hasAccess) {
        renderAllowedPage(user);
        return;
      }
    } catch (error) {
      if (auth.currentUser?.uid !== user.uid) {
        return;
      }
    }

    render(`
      <main class="center-page">
        <section class="card auth-card">
          <p class="eyebrow">${APP_TITLE}</p>
          <h1>${deniedTitle}</h1>
          <p>Signed in as <strong>${escapeHtml(user.email)}</strong>. This account is not included in the backend allowlist.</p>
          <div class="button-row">
            <button class="primary-button" data-google-login>Switch account</button>
            <button class="secondary-button" data-sign-out>Sign out</button>
          </div>
        </section>
      </main>
    `);

    app.querySelector('[data-google-login]')?.addEventListener('click', () => {
      if (auth.currentUser) {
        signOut(auth).then(signInWithGoogle);
        return;
      }

      signInWithGoogle();
    });
    app.querySelector('[data-sign-out]')?.addEventListener('click', () => signOut(auth));
  });
}

function bindAdminGate(renderAdminPage) {
  bindAllowlistGate(renderAdminPage, {
    signInMessage: 'Use a Google account included in the backend admin allowlist.',
  });
}

function createBaseMap(element, options = {}) {
  const {
    fitWorld = true,
    lockMinZoomToInitial = false,
    panAfterFit = [0, 0],
    viewBounds = WORLD_BOUNDS,
    ...mapOptions
  } = options;
  const map = L.map(element, {
    worldCopyJump: true,
    attributionControl: mapOptions.attributionControl ?? true,
    ...mapOptions,
  }).setView([20, 0], 2);

  L.tileLayer(TILE_URL, {
    attribution: TILE_ATTRIBUTION,
    maxZoom: 18,
    minZoom: 1,
  }).addTo(map);

  window.setTimeout(() => {
    map.invalidateSize();
    if (fitWorld) {
      map.fitBounds(viewBounds, {
        animate: false,
        padding: [16, 16],
      });
      if (panAfterFit[0] !== 0 || panAfterFit[1] !== 0) {
        map.panBy(panAfterFit, { animate: false });
      }
      if (lockMinZoomToInitial) {
        map.setMinZoom(map.getZoom());
      }
    }
  }, 0);
  return map;
}

function createPinMarker(latlng, animate = false) {
  return L.marker(latlng, {
    icon: animate ? animatedPinIcon : pinIcon,
    riseOnHover: true,
  });
}

function createPinPopup(pin) {
  return `
    <article class="pin-popup-card">
      <p class="pin-popup-label">Travel memory</p>
      <h2>${escapeHtml(pin.locationName)}</h2>
      <p class="pin-popup-person">Shared by ${escapeHtml(pin.userName || 'Guest')}</p>
      ${pin.note ? `<p class="pin-popup-note">${escapeHtml(pin.note)}</p>` : ''}
    </article>
  `;
}

function createPinSpotlight(pin) {
  return `
    <h2>${escapeHtml(pin.locationName)}</h2>
    <p class="pin-spotlight-person">Shared by ${escapeHtml(pin.userName || 'Guest')}</p>
    ${pin.note ? `<p class="pin-spotlight-note">${escapeHtml(pin.note)}</p>` : ''}
    <p class="pin-spotlight-posted">${escapeHtml(formatDisplayPostedAt(pin.createdAt))}</p>
  `;
}

function animationDurationMs() {
  return DISPLAY_ANIMATION_DURATION_SECONDS * 1000;
}

function createdAtMillis(pin) {
  if (pin.createdAt?.toMillis) {
    return pin.createdAt.toMillis();
  }

  if (pin.createdAt?.toDate) {
    return pin.createdAt.toDate().getTime();
  }

  return 0;
}

function formatDisplayPostedAt(timestamp) {
  if (!timestamp?.toDate) {
    return 'Posted time pending';
  }

  return `Posted ${timestamp.toDate().toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  })} SGT`;
}

function createTravelPin(pin, animate = true) {
  const marker = createPinMarker([pin.lat, pin.lng], animate);
  marker.bindPopup(createPinPopup(pin), {
    autoPan: false,
    className: 'travel-popup',
    maxWidth: 280,
  });

  return marker;
}

function moveToDisplayHome(map, animate = true) {
  const applyPan = () => {
    map.panBy(DISPLAY_INITIAL_PAN, { animate: false });
  };

  if (animate) {
    map.once('moveend', applyPan);
  }

  map.flyToBounds(DISPLAY_WORLD_BOUNDS, {
    animate,
    duration: animate ? DISPLAY_ANIMATION_DURATION_SECONDS : 0,
    easeLinearity: 0.25,
    padding: [16, 16],
  });

  if (!animate) {
    applyPan();
  }
}

function renderDisplay() {
  bindAllowlistGate(() => {
    render(`
      <main class="display-shell">
        <div id="display-map" class="display-map" aria-label="Live travel pin map"></div>
        <div class="display-title">
          <h1 data-event-name>${APP_TITLE}</h1>
          <p data-pin-count>Waiting for pins...</p>
        </div>
        <a class="guest-qr" data-guest-qr hidden target="_blank" rel="noreferrer">
          <span>Scan to add your pin</span>
          <img data-guest-qr-image alt="QR code for the guest pin submission page" />
        </a>
        <div class="display-controls">
          <div class="view-jump-controls" aria-label="Map view shortcuts">
            ${DISPLAY_ANIMATION_VIEWS.map((view, index) => `
              <button class="view-jump-button" type="button" data-view-index="${index}" aria-label="Show ${escapeHtml(view.label)}" aria-pressed="false">
                ${escapeHtml(view.shortLabel)}
              </button>
            `).join('')}
          </div>
          <div class="display-mode-controls">
            <label class="control-toggle">
              <input type="checkbox" data-show-messages-toggle />
              <span>Show msg</span>
            </label>
            <label class="control-toggle">
              <input type="checkbox" data-animation-toggle />
              <span>Animate</span>
            </label>
          </div>
        </div>
        <div class="pin-spotlight-layer" data-pin-spotlight-layer></div>
        <div class="sr-only" data-display-status aria-live="polite">Loading event...</div>
      </main>
    `);

    const map = createBaseMap('display-map', {
      dragging: true,
      zoomControl: false,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      touchZoom: true,
      keyboard: false,
      boxZoom: false,
      tap: false,
      attributionControl: false,
      lockMinZoomToInitial: true,
      panAfterFit: DISPLAY_INITIAL_PAN,
      viewBounds: DISPLAY_WORLD_BOUNDS,
      wheelPxPerZoomLevel: 120,
      zoomSnap: 0.25,
    });
    const pinSpotlightLinePane = map.createPane('pinSpotlightLine');
    const markers = new Map();
    let pinUnsubscribe = null;
    const status = app.querySelector('[data-display-status]');
    const eventName = app.querySelector('[data-event-name]');
    const pinCount = app.querySelector('[data-pin-count]');
    const guestQr = app.querySelector('[data-guest-qr]');
    const guestQrImage = app.querySelector('[data-guest-qr-image]');
    const animationToggle = app.querySelector('[data-animation-toggle]');
    const showMessagesToggle = app.querySelector('[data-show-messages-toggle]');
    const pinSpotlightLayer = app.querySelector('[data-pin-spotlight-layer]');
    const viewButtons = Array.from(app.querySelectorAll('[data-view-index]'));
    const persistedDisplayPreferences = readDisplayPreferences();
    let lastGuestUrl = '';
    let animationTimer = null;
    let pinDetailsTimer = null;
    let animationStep = 0;
    let nextPinDetailsAllowedAt = 0;
    let currentViewEndsAt = 0;
    let currentFocusBounds = L.latLngBounds(DISPLAY_WORLD_BOUNDS);
    let mapViewIsTransitioning = false;
    let mapViewTransitionToken = 0;
    const highlightedMarkers = new Set();
    const shownPinCounts = new Map();
    let lastShownBatchIds = new Set();
    let currentDisplayedBatchIds = [];

    animationToggle.checked = persistedDisplayPreferences.animate;
    showMessagesToggle.checked = persistedDisplayPreferences.showMessages;

    const getOverlayRects = () => {
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const overlayElements = [
        app.querySelector('.display-title'),
        guestQr.hidden ? null : guestQr,
        app.querySelector('.display-controls'),
      ].filter(Boolean);
      const overlayRects = overlayElements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left - containerRect.left - 12,
          right: rect.right - containerRect.left + 12,
          top: rect.top - containerRect.top - 12,
          bottom: rect.bottom - containerRect.top + 12,
        };
      });
      return overlayRects;
    };

    const getPinAvoidRect = (marker) => {
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      if (!map.getBounds().contains(marker.getLatLng())) {
        return null;
      }

      const point = map.latLngToContainerPoint(marker.getLatLng());
      if (point.x < 0
        || point.x > containerRect.width
        || point.y < 0
        || point.y > containerRect.height) {
        return null;
      }

      return {
        left: point.x - 32,
        right: point.x + 32,
        top: point.y - 62,
        bottom: point.y + 22,
      };
    };

    const rectOverlaps = (rect, otherRect) => rect.left < otherRect.right
      && rect.right > otherRect.left
      && rect.top < otherRect.bottom
      && rect.bottom > otherRect.top;

    const markerIsVisible = (marker) => {
      if (!map.getBounds().contains(marker.getLatLng())) {
        return false;
      }

      const point = map.latLngToContainerPoint(marker.getLatLng());
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const overlayRects = getOverlayRects();

      const insideMap = point.x >= 0
        && point.x <= containerRect.width
        && point.y >= 0
        && point.y <= containerRect.height;
      const behindOverlay = overlayRects.some((rect) => point.x >= rect.left
        && point.x <= rect.right
        && point.y >= rect.top
        && point.y <= rect.bottom);

      return insideMap && !behindOverlay;
    };

    const pointIsInFocus = (latLng) => currentFocusBounds.contains(latLng);

    const clearHighlightedMarkers = () => {
      highlightedMarkers.forEach((marker) => {
        marker.getElement()?.classList.remove('pin-marker--highlighted');
        marker.setZIndexOffset(0);
      });
      highlightedMarkers.clear();
    };

    const positionPinSpotlight = (marker, pin, occupiedRects, blockedPinRects, featuredPinRects, staggerIndex) => {
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const ownPinRect = getPinAvoidRect(marker);
      const overlayRects = [
        ...getOverlayRects(),
        ...blockedPinRects,
        ...(ownPinRect ? [ownPinRect] : []),
        ...featuredPinRects,
        ...occupiedRects,
      ];
      const margin = 10;
      const gap = 28;
      const sideGap = 44;
      const topGap = 68;
      const pinSpotlight = document.createElement('article');
      const pinSpotlightLine = document.createElement('span');

      pinSpotlight.className = 'pin-spotlight';
      pinSpotlight.innerHTML = createPinSpotlight(pin);
      pinSpotlightLine.className = 'pin-spotlight-line';
      pinSpotlight.style.animationDelay = `${staggerIndex * 180}ms`;
      pinSpotlightLine.style.animationDelay = `${staggerIndex * 180}ms`;
      pinSpotlight.style.visibility = 'hidden';
      pinSpotlightLayer.append(pinSpotlight);
      pinSpotlightLinePane.append(pinSpotlightLine);
      pinSpotlightLine.hidden = true;

      const width = pinSpotlight.offsetWidth;
      const height = pinSpotlight.offsetHeight;
      const placements = [
        { name: 'top', left: point.x - (width / 2), top: point.y - height - topGap },
        { name: 'right', left: point.x + sideGap, top: point.y - (height / 2) },
        { name: 'left', left: point.x - width - sideGap, top: point.y - (height / 2) },
        { name: 'bottom', left: point.x - (width / 2), top: point.y + gap },
      ];

      const fits = ({ left, top }) => {
        const rect = {
          left,
          top,
          right: left + width,
          bottom: top + height,
        };
        return rect.left >= margin
          && rect.top >= margin
          && rect.right <= containerRect.width - margin
          && rect.bottom <= containerRect.height - margin
          && !overlayRects.some((overlayRect) => rectOverlaps(rect, overlayRect));
      };

      let placement = placements.find(fits);
      if (!placement) {
        placement = {
          name: 'clamped',
          left: Math.min(Math.max(point.x - (width / 2), margin), containerRect.width - width - margin),
          top: Math.min(Math.max(point.y - height - gap, margin), containerRect.height - height - margin),
        };
        const rect = {
          left: placement.left,
          top: placement.top,
          right: placement.left + width,
          bottom: placement.top + height,
        };
        if (overlayRects.some((overlayRect) => rectOverlaps(rect, overlayRect))) {
          pinSpotlight.remove();
          pinSpotlightLine.remove();
          return false;
        }
      }

      pinSpotlight.dataset.placement = placement.name;
      pinSpotlight.style.left = `${placement.left}px`;
      pinSpotlight.style.top = `${placement.top}px`;
      pinSpotlight.style.visibility = '';
      occupiedRects.push({
        left: placement.left - 12,
        top: placement.top - 12,
        right: placement.left + width + 12,
        bottom: placement.top + height + 12,
      });

      const anchorX = Math.min(Math.max(point.x, placement.left), placement.left + width);
      const anchorY = Math.min(Math.max(point.y, placement.top), placement.top + height);
      const layerPoint = map.latLngToLayerPoint(marker.getLatLng());
      const anchorLayerPoint = map.containerPointToLayerPoint(L.point(anchorX, anchorY));
      const dx = anchorLayerPoint.x - layerPoint.x;
      const dy = anchorLayerPoint.y - layerPoint.y;
      const length = Math.hypot(dx, dy);
      if (length > 10) {
        pinSpotlightLine.style.left = `${layerPoint.x}px`;
        pinSpotlightLine.style.top = `${layerPoint.y}px`;
        pinSpotlightLine.style.width = `${length}px`;
        pinSpotlightLine.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        pinSpotlightLine.hidden = false;
      }
      marker.getElement()?.classList.add('pin-marker--highlighted');
      marker.setZIndexOffset(1000);
      highlightedMarkers.add(marker);
      if (ownPinRect) {
        featuredPinRects.push(ownPinRect);
      }
      return true;
    };

    const hidePinSpotlight = () => {
      pinSpotlightLayer.innerHTML = '';
      pinSpotlightLinePane.replaceChildren();
      clearHighlightedMarkers();
      currentDisplayedBatchIds = [];
    };

    const messagesAreEnabled = () => animationToggle.checked || showMessagesToggle.checked;

    const scheduleNextPinDetails = () => {
      if (messagesAreEnabled()
        && Date.now() + RANDOM_PIN_DETAILS_MS < currentViewEndsAt - 100) {
        pinDetailsTimer = window.setTimeout(showRandomPinDetails, RANDOM_PIN_DETAILS_MS);
      }
    };

    const showRandomPinDetails = () => {
      if (mapViewIsTransitioning) {
        pinDetailsTimer = window.setTimeout(showRandomPinDetails, 150);
        return;
      }

      currentFocusBounds = map.getBounds();
      if (!animationToggle.checked) {
        currentViewEndsAt = Number.POSITIVE_INFINITY;
      }

      if (Date.now() < nextPinDetailsAllowedAt || markers.size === 0) {
        map.closePopup();
        hidePinSpotlight();
        scheduleNextPinDetails();
        return;
      }

      const candidates = Array.from(markers.entries())
        .map(([id, item]) => ({ id, ...item }))
        .filter(({ marker }) => markerIsVisible(marker) && pointIsInFocus(marker.getLatLng()));
      if (candidates.length === 0) {
        map.closePopup();
        hidePinSpotlight();
        scheduleNextPinDetails();
        return;
      }

      const candidateIdSet = new Set(candidates.map(({ id }) => id));
      if (currentDisplayedBatchIds.length > 0
        && candidates.length <= PIN_DETAILS_PER_BATCH
        && currentDisplayedBatchIds.length === candidateIdSet.size
        && currentDisplayedBatchIds.every((id) => candidateIdSet.has(id))) {
        scheduleNextPinDetails();
        return;
      }

      map.closePopup();
      hidePinSpotlight();
      const occupiedRects = [];
      const featuredPinRects = [];
      const blockedPinRects = candidates
        .map(({ marker }) => getPinAvoidRect(marker))
        .filter(Boolean);
      const rankedCandidates = candidates
        .map((candidate) => ({
          ...candidate,
          shownCount: shownPinCounts.get(candidate.id) || 0,
          createdAtMs: createdAtMillis(candidate.pin),
          randomTieBreaker: Math.random(),
        }));
      const sortCandidates = (items) => items
        .sort((a, b) => b.createdAtMs - a.createdAtMs
          || a.shownCount - b.shownCount
          || a.randomTieBreaker - b.randomTieBreaker);
      const preferredCandidates = sortCandidates(
        rankedCandidates.filter((candidate) => !lastShownBatchIds.has(candidate.id)),
      );
      const fallbackCandidates = sortCandidates(
        rankedCandidates.filter((candidate) => lastShownBatchIds.has(candidate.id)),
      );
      const sortedCandidates = [...preferredCandidates, ...fallbackCandidates];
      const shownThisRoundIds = new Set();
      const renderedBatchIds = [];

      for (const { id, marker, pin } of sortedCandidates) {
        if (positionPinSpotlight(marker, pin, occupiedRects, blockedPinRects, featuredPinRects, occupiedRects.length)) {
          shownPinCounts.set(id, (shownPinCounts.get(id) || 0) + 1);
          shownThisRoundIds.add(id);
          renderedBatchIds.push(id);
        }

        if (occupiedRects.length >= PIN_DETAILS_PER_BATCH) {
          lastShownBatchIds = shownThisRoundIds;
          currentDisplayedBatchIds = renderedBatchIds;
          scheduleNextPinDetails();
          return;
        }
      }

      if (occupiedRects.length === 0) {
        hidePinSpotlight();
      }

      if (shownThisRoundIds.size > 0) {
        lastShownBatchIds = shownThisRoundIds;
        currentDisplayedBatchIds = renderedBatchIds;
      }

      scheduleNextPinDetails();
    };

    const stopMessagePlayback = () => {
      window.clearTimeout(pinDetailsTimer);
      pinDetailsTimer = null;
      map.closePopup();
      hidePinSpotlight();
    };

    const startStaticMessages = () => {
      window.clearTimeout(pinDetailsTimer);
      nextPinDetailsAllowedAt = Date.now();
      currentFocusBounds = map.getBounds();
      currentViewEndsAt = Number.POSITIVE_INFINITY;
      showRandomPinDetails();
    };

    const getViewHoldMs = (view) => (view.home ? DISPLAY_WORLD_VIEW_HOLD_MS : DISPLAY_ANIMATION_HOLD_MS);

    const setActiveViewButton = (activeIndex) => {
      viewButtons.forEach((button, index) => {
        const isActive = index === activeIndex;
        button.classList.toggle('view-jump-button--active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    };

    const viewHasMessagePins = (view) => {
      const bounds = L.latLngBounds(view.bounds);
      return Array.from(markers.values()).some(({ marker }) => bounds.contains(marker.getLatLng()));
    };

    const nextPopulatedAnimationViewIndex = (startIndex) => {
      if (markers.size === 0) {
        return startIndex;
      }

      for (let offset = 0; offset < DISPLAY_ANIMATION_VIEWS.length; offset += 1) {
        const viewIndex = (startIndex + offset) % DISPLAY_ANIMATION_VIEWS.length;
        if (viewHasMessagePins(DISPLAY_ANIMATION_VIEWS[viewIndex])) {
          return viewIndex;
        }
      }

      return startIndex;
    };

    const showAnimationView = (viewIndex, continueAnimation) => {
      const normalizedIndex = ((viewIndex % DISPLAY_ANIMATION_VIEWS.length) + DISPLAY_ANIMATION_VIEWS.length)
        % DISPLAY_ANIMATION_VIEWS.length;
      const view = DISPLAY_ANIMATION_VIEWS[normalizedIndex];
      const viewHoldMs = getViewHoldMs(view);
      window.clearTimeout(animationTimer);
      window.clearTimeout(pinDetailsTimer);
      map.closePopup();
      map.stop();
      hidePinSpotlight();
      setActiveViewButton(normalizedIndex);
      currentFocusBounds = L.latLngBounds(view.bounds);
      nextPinDetailsAllowedAt = Number.POSITIVE_INFINITY;
      currentViewEndsAt = Number.POSITIVE_INFINITY;
      mapViewIsTransitioning = true;
      const transitionToken = ++mapViewTransitionToken;
      map.once('moveend', () => {
        if (transitionToken !== mapViewTransitionToken) {
          return;
        }

        mapViewIsTransitioning = false;
        nextPinDetailsAllowedAt = Date.now();
        currentViewEndsAt = animationToggle.checked ? Date.now() + viewHoldMs : Number.POSITIVE_INFINITY;

        if (messagesAreEnabled()) {
          showRandomPinDetails();
        }

        if (continueAnimation) {
          animationTimer = window.setTimeout(runAnimationStep, viewHoldMs);
        }
      });

      if (view.home) {
        moveToDisplayHome(map);
      } else {
        map.flyToBounds(view.bounds, {
          duration: DISPLAY_ANIMATION_DURATION_SECONDS,
          easeLinearity: 0.25,
          padding: [72, 72],
        });
      }

      animationStep = (normalizedIndex + 1) % DISPLAY_ANIMATION_VIEWS.length;
    };

    const stopAnimation = (returnHome = true) => {
      window.clearTimeout(animationTimer);
      animationTimer = null;
      animationStep = 0;
      mapViewTransitionToken += 1;
      mapViewIsTransitioning = false;
      map.stop();
      stopMessagePlayback();
      if (returnHome) {
        moveToDisplayHome(map);
        setActiveViewButton(DISPLAY_ANIMATION_VIEWS.findIndex((view) => view.home));
      }
    };

    const runAnimationStep = () => {
      if (!animationToggle.checked) {
        return;
      }

      showAnimationView(nextPopulatedAnimationViewIndex(animationStep), true);
    };

    const persistDisplayPreferences = () => {
      writeDisplayPreferences({
        animate: animationToggle.checked,
        showMessages: showMessagesToggle.checked,
      });
    };

    animationToggle.addEventListener('change', () => {
      if (animationToggle.checked) {
        showMessagesToggle.checked = false;
        runAnimationStep();
      } else {
        stopAnimation();
      }

      persistDisplayPreferences();
    });

    showMessagesToggle.addEventListener('change', () => {
      if (showMessagesToggle.checked) {
        if (animationToggle.checked) {
          animationToggle.checked = false;
          stopAnimation(false);
        } else {
          stopMessagePlayback();
        }
        startStaticMessages();
      } else if (!animationToggle.checked) {
        stopMessagePlayback();
      }

      persistDisplayPreferences();
    });

    viewButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const viewIndex = Number(button.dataset.viewIndex);
        if (!Number.isInteger(viewIndex)) {
          return;
        }

        showAnimationView(viewIndex, animationToggle.checked);
      });
    });
    setActiveViewButton(DISPLAY_ANIMATION_VIEWS.findIndex((view) => view.home));

    if (animationToggle.checked) {
      runAnimationStep();
    } else if (showMessagesToggle.checked) {
      startStaticMessages();
    }

    const updatePinCount = () => {
      const count = markers.size;
      pinCount.textContent = count === 1 ? '1 travel pin' : `${count} travel pins`;
    };

    const configUnsubscribe = onSnapshot(doc(db, 'config', 'event'), async (snapshot) => {
      if (!snapshot.exists()) {
        status.textContent = 'Create /config/event in Firestore to start.';
        guestQr.hidden = true;
        return;
      }

      const config = snapshot.data();
      eventName.textContent = config.eventName || APP_TITLE;
      status.textContent = config.active ? 'Event is live' : 'Event is paused';

      if (config.eventKey) {
        const guestUrl = `${window.location.origin}/guest?k=${encodeURIComponent(config.eventKey)}`;
        if (guestUrl !== lastGuestUrl) {
          lastGuestUrl = guestUrl;
          guestQr.href = guestUrl;
          try {
            guestQrImage.src = await QRCode.toDataURL(guestUrl, {
              width: 220,
              margin: 1,
              color: {
                dark: '#0f172a',
                light: '#ffffff',
              },
            });
            guestQr.hidden = false;
          } catch (error) {
            status.textContent = `Could not generate guest QR code: ${error.message}`;
            guestQr.hidden = true;
          }
        }
      } else {
        guestQr.hidden = true;
      }

      if (pinUnsubscribe) {
        pinUnsubscribe();
        markers.forEach(({ marker }) => marker.remove());
        markers.clear();
      }

      const pinsQuery = query(collection(db, 'pins'), where('eventKey', '==', config.eventKey || ''));
      let hasLoadedInitialPins = false;
      pinUnsubscribe = onSnapshot(pinsQuery, (pinsSnapshot) => {
        pinsSnapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          const pin = change.doc.data();

          if (change.type === 'removed') {
            markers.get(id)?.marker.remove();
            markers.delete(id);
            shownPinCounts.delete(id);
            lastShownBatchIds.delete(id);
            return;
          }

          if (markers.has(id)) {
            const item = markers.get(id);
            item.pin = pin;
            item.marker
              .setLatLng([pin.lat, pin.lng])
              .bindPopup(createPinPopup(pin), {
                autoPan: false,
                className: 'travel-popup',
                maxWidth: 280,
              });
            return;
          }

          const marker = createTravelPin(pin, hasLoadedInitialPins).addTo(map);
          markers.set(id, { id, marker, pin });
        });

        hasLoadedInitialPins = true;
        updatePinCount();
      }, (error) => {
        status.textContent = `Could not load pins: ${error.message}`;
      });
    }, (error) => {
      status.textContent = `Could not load event: ${error.message}`;
    });

    const onResize = () => map.invalidateSize();
    window.addEventListener('resize', onResize);
    activeCleanups.push(
      () => configUnsubscribe(),
      () => pinUnsubscribe?.(),
      () => stopAnimation(false),
      () => window.removeEventListener('resize', onResize),
      () => map.remove(),
    );
  });
}

function renderGuest() {
  if (!requireFirebase()) {
    return;
  }

  const eventKey = new URLSearchParams(window.location.search).get('k')?.trim();
  if (!eventKey) {
    render(`
      <main class="center-page guest-bg">
        <section class="card auth-card">
          <p class="eyebrow">${APP_TITLE}</p>
          <h1>Missing event key</h1>
          <p>Scan the event QR code again. Guest links must include <code>?k=event-key</code>.</p>
        </section>
      </main>
    `);
    return;
  }

  render(`
    <main class="guest-shell guest-bg">
      <section class="guest-card card">
        <p class="eyebrow">${APP_TITLE}</p>
        <h1>Drop a pin somewhere you have travelled</h1>
        <p class="muted">Tap the map to choose a place, then tell us who you are and what it means to you.</p>
        <div class="city-search">
          <label>
            Search for a city
            <input data-city-search type="search" placeholder="Loading city list..." autocomplete="off" disabled />
          </label>
          <div class="city-results" data-city-results role="listbox" aria-label="City search results"></div>
          <p class="city-search-status" data-city-search-status>Loading city list...</p>
          <p class="city-data-credit">City data from <a href="https://github.com/dr5hn/countries-states-cities-database" target="_blank" rel="noreferrer">Countries States Cities Database</a>.</p>
        </div>
        <div class="guest-map" id="guest-map" aria-label="Choose a pin location"></div>
        <form class="pin-form" data-pin-form>
          <label>
            Your name
            <input name="userName" type="text" maxlength="79" autocomplete="name" required />
          </label>
          <label>
            What does this location mean to you?
            <input name="locationName" type="text" placeholder="e.g. My first solo trip" maxlength="99" required />
          </label>
          <label>
            Optional note
            <textarea name="note" placeholder="What made it memorable?" maxlength="240" rows="3"></textarea>
          </label>
          <div class="selected-location" data-selected-location>No place selected yet.</div>
          <button class="primary-button wide" type="submit" disabled data-submit>Submit pin</button>
          <p class="form-status" role="status" data-form-status>Signing you in...</p>
        </form>
      </section>
    </main>
  `);

  const map = createBaseMap('guest-map', {
    zoomControl: true,
    scrollWheelZoom: false,
  });
  let selected = null;
  let selectedMarker = null;
  let citySearchTimer = null;
  let cityIndex = [];
  let cityResults = [];
  let isGuestPageActive = true;
  const citySearch = app.querySelector('[data-city-search]');
  const cityResultsList = app.querySelector('[data-city-results]');
  const citySearchStatus = app.querySelector('[data-city-search-status]');
  const selectedLocation = app.querySelector('[data-selected-location]');
  const submitButton = app.querySelector('[data-submit]');
  const formStatus = app.querySelector('[data-form-status]');
  const form = app.querySelector('[data-pin-form]');

  const updateSubmitState = () => {
    submitButton.disabled = !selected || !auth.currentUser;
  };

  const setSelectedLocation = (latlng, label = '') => {
    selected = {
      lat: Number(latlng.lat.toFixed(6)),
      lng: Number(latlng.lng.toFixed(6)),
    };

    if (selectedMarker) {
      selectedMarker.setLatLng(latlng);
    } else {
      selectedMarker = createPinMarker(latlng).addTo(map);
    }

    selectedLocation.textContent = label
      ? `Selected: ${label}`
      : `Selected: ${selected.lat}, ${selected.lng}`;
    formStatus.textContent = '';
    updateSubmitState();
  };

  const renderCityResults = () => {
    if (cityResults.length === 0) {
      cityResultsList.innerHTML = '';
      cityResultsList.hidden = true;
      return;
    }

    cityResultsList.innerHTML = cityResults.map((result, index) => `
      <button type="button" role="option" data-city-result="${index}">
        <span class="city-result-label">${escapeHtml(result.label)}</span>
        ${result.state ? `<span class="city-result-meta">${escapeHtml(result.state)}</span>` : ''}
      </button>
    `).join('');
    cityResultsList.hidden = false;
  };

  const searchCities = (queryText) => {
    const trimmedQuery = queryText.trim();
    if (trimmedQuery.length < 2) {
      cityResults = [];
      citySearchStatus.textContent = cityIndex.length === 0 ? 'Loading city list...' : '';
      renderCityResults();
      return;
    }

    if (cityIndex.length === 0) {
      cityResults = [];
      renderCityResults();
      citySearchStatus.textContent = 'Loading city list...';
      return;
    }

    const normalizedQuery = normalizeCityText(trimmedQuery);
    const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
    const matches = [];
    const seenLocations = new Set();

    for (const city of cityIndex) {
      if (!queryTokens.every((token) => city.searchText.includes(token))) {
        continue;
      }

      const locationKey = `${city.city}\u0000${city.state}\u0000${city.country}\u0000${city.lat}\u0000${city.lng}`;
      if (seenLocations.has(locationKey)) {
        continue;
      }
      seenLocations.add(locationKey);

      const score = city.normalizedCity === normalizedQuery
        ? 0
        : city.normalizedCity.startsWith(normalizedQuery)
          ? 1
          : city.searchText.startsWith(normalizedQuery)
            ? 2
            : 3;

      matches.push({ ...city, score });
    }

    cityResults = matches
      .sort((a, b) => a.score - b.score
        || a.city.localeCompare(b.city)
        || a.country.localeCompare(b.country)
        || a.state.localeCompare(b.state))
      .slice(0, 8);

    citySearchStatus.textContent = cityResults.length === 0 ? 'No city matches found.' : '';
    renderCityResults();
  };

  loadCityIndex()
    .then((cities) => {
      if (!isGuestPageActive) {
        return;
      }

      cityIndex = cities;
      citySearch.disabled = false;
      citySearch.placeholder = 'Type a city name';
      citySearchStatus.textContent = '';
      searchCities(citySearch.value);
    })
    .catch((error) => {
      if (!isGuestPageActive) {
        return;
      }

      citySearchStatus.textContent = `Could not load city list: ${error.message}`;
    });

  citySearch.addEventListener('input', () => {
    window.clearTimeout(citySearchTimer);
    citySearchTimer = window.setTimeout(() => searchCities(citySearch.value), 150);
  });

  cityResultsList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-city-result]');
    if (!button) {
      return;
    }

    const result = cityResults[Number(button.dataset.cityResult)];
    if (!result) {
      return;
    }

    const latlng = L.latLng(result.lat, result.lng);
    setSelectedLocation(latlng, result.label);
    map.setView(latlng, Math.max(map.getZoom(), 8), { animate: true });
    citySearch.value = result.label;
    cityResults = [];
    citySearchStatus.textContent = '';
    renderCityResults();
  });

  map.on('click', (event) => {
    setSelectedLocation(event.latlng);
  });

  signInAnonymously(auth)
    .then(() => {
      formStatus.textContent = 'Tap the map to choose your pin.';
      updateSubmitState();
    })
    .catch((error) => {
      formStatus.textContent = `Could not sign in anonymously: ${error.message}`;
    });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!selected || !auth.currentUser) {
      formStatus.textContent = 'Choose a place on the map first.';
      return;
    }

    const formData = new FormData(form);
    const rawUserName = String(formData.get('userName') || '').trim();
    const rawLocationName = String(formData.get('locationName') || '').trim();
    const rawNote = String(formData.get('note') || '').trim();
    const userName = censorProfanity(rawUserName);
    const locationName = censorProfanity(rawLocationName);
    const note = censorProfanity(rawNote);
    const contentWasCensored = userName !== rawUserName
      || locationName !== rawLocationName
      || note !== rawNote;

    if (!userName) {
      formStatus.textContent = 'Add your name before submitting.';
      return;
    }

    if (!locationName) {
      formStatus.textContent = 'Tell us what this location means to you before submitting.';
      return;
    }

    submitButton.disabled = true;
    formStatus.textContent = 'Submitting pin...';

    try {
      await addDoc(collection(db, 'pins'), {
        lat: selected.lat,
        lng: selected.lng,
        userName,
        locationName,
        ...(note ? { note } : {}),
        ownerId: auth.currentUser.uid,
        eventKey,
        createdAt: serverTimestamp(),
      });

      form.reset();
      selected = null;
      selectedMarker?.remove();
      selectedMarker = null;
      selectedLocation.textContent = 'No place selected yet.';
      formStatus.textContent = contentWasCensored
        ? 'Pin submitted. Some language was censored automatically.'
        : 'Pin submitted. Thank you!';
    } catch (error) {
      if (error.code === 'permission-denied') {
        formStatus.textContent = 'Could not submit pin. The event may be paused or this QR code may be for the wrong event.';
      } else {
        formStatus.textContent = `Could not submit pin: ${error.message}`;
      }
    } finally {
      updateSubmitState();
    }
  });

  const onResize = () => map.invalidateSize();
  window.addEventListener('resize', onResize);
  activeCleanups.push(
    () => {
      isGuestPageActive = false;
    },
    () => window.clearTimeout(citySearchTimer),
    () => window.removeEventListener('resize', onResize),
    () => map.remove(),
  );
}

function renderAdmin() {
  bindAdminGate(() => {
    render(`
      <main class="admin-shell">
        <header class="admin-header">
          <div>
            <p class="eyebrow">Admin</p>
            <h1>${APP_TITLE}</h1>
          </div>
          <button class="secondary-button" data-admin-sign-out>Sign out</button>
        </header>
        <section class="admin-grid">
          <article class="card admin-card">
            <h2>Event</h2>
            <div data-event-panel class="stacked muted">Loading event config...</div>
          </article>
          <article class="card admin-card">
            <h2>Actions</h2>
            <div class="button-row wrap">
              <button class="primary-button" data-toggle-event disabled>Start / stop event</button>
              <button class="danger-button" data-clear-pins>Clear all pins</button>
            </div>
            <p class="form-status" role="status" data-admin-status></p>
          </article>
        </section>
        <section class="card admin-card">
          <div class="table-header">
            <h2>Pins</h2>
            <span data-admin-pin-count>0 pins</span>
          </div>
          <div class="pin-list" data-pin-list>Loading pins...</div>
        </section>
      </main>
    `);

    const eventPanel = app.querySelector('[data-event-panel]');
    const toggleButton = app.querySelector('[data-toggle-event]');
    const clearButton = app.querySelector('[data-clear-pins]');
    const status = app.querySelector('[data-admin-status]');
    const pinList = app.querySelector('[data-pin-list]');
    const pinCount = app.querySelector('[data-admin-pin-count]');
    let currentConfig = null;
    let latestPins = [];

    app.querySelector('[data-admin-sign-out]').addEventListener('click', () => signOut(auth));

    const renderEventPanel = (snapshot) => {
      if (!snapshot.exists()) {
        toggleButton.disabled = true;
        eventPanel.innerHTML = `
          <p>No <code>/config/event</code> document exists yet.</p>
          <p>Create it from a trusted backend context with <code>eventKey</code>, <code>eventName</code>, <code>active</code>, and <code>adminEmails</code>.</p>
        `;
        return;
      }

      currentConfig = snapshot.data();
      toggleButton.disabled = false;
      const guestUrl = `${window.location.origin}/guest?k=${encodeURIComponent(currentConfig.eventKey || '')}`;
      eventPanel.innerHTML = `
        <dl class="event-details">
          <div><dt>Name</dt><dd>${escapeHtml(currentConfig.eventName || 'Untitled event')}</dd></div>
          <div><dt>Status</dt><dd><span class="status-pill ${currentConfig.active ? 'live' : 'paused'}">${currentConfig.active ? 'Live' : 'Paused'}</span></dd></div>
          <div><dt>Guest URL</dt><dd><button class="link-button" data-copy-guest-url>Copy guest link</button></dd></div>
          <div><dt>Event key</dt><dd><code>${escapeHtml(currentConfig.eventKey || '')}</code></dd></div>
        </dl>
      `;
      eventPanel.querySelector('[data-copy-guest-url]').addEventListener('click', async () => {
        await navigator.clipboard.writeText(guestUrl);
        status.textContent = 'Guest link copied.';
      });
    };

    const renderPins = () => {
      pinCount.textContent = latestPins.length === 1 ? '1 pin' : `${latestPins.length} pins`;

      if (latestPins.length === 0) {
        pinList.innerHTML = '<p class="muted">No pins yet.</p>';
        return;
      }

      pinList.innerHTML = latestPins.map(({ id, data }) => `
        <article class="pin-row">
          <div>
            <strong>${escapeHtml(data.locationName)}</strong>
            <p>Shared by ${escapeHtml(data.userName || 'Guest')}</p>
            ${data.note ? `<p>${escapeHtml(data.note)}</p>` : ''}
            <small>${Number(data.lat).toFixed(4)}, ${Number(data.lng).toFixed(4)} · ${formatDate(data.createdAt)}</small>
          </div>
          <button class="danger-button compact" data-delete-pin="${escapeHtml(id)}">Delete</button>
        </article>
      `).join('');

      pinList.querySelectorAll('[data-delete-pin]').forEach((button) => {
        button.addEventListener('click', async () => {
          await deleteDoc(doc(db, 'pins', button.dataset.deletePin));
          status.textContent = 'Pin deleted.';
        });
      });
    };

    toggleButton.addEventListener('click', async () => {
      if (!currentConfig) {
        return;
      }

      const nextActive = !currentConfig.active;
      await updateDoc(doc(db, 'config', 'event'), {
        active: nextActive,
      });
      status.textContent = nextActive ? 'Event started.' : 'Event paused.';
    });

    clearButton.addEventListener('click', async () => {
      if (latestPins.length === 0) {
        status.textContent = 'There are no pins to clear.';
        return;
      }

      if (!window.confirm(`Delete ${latestPins.length} pin${latestPins.length === 1 ? '' : 's'}? This cannot be undone.`)) {
        return;
      }

      const deletedCount = await clearAllPins();
      status.textContent = `Cleared ${deletedCount} pin${deletedCount === 1 ? '' : 's'}.`;
    });

    const configUnsubscribe = onSnapshot(doc(db, 'config', 'event'), renderEventPanel, (error) => {
      eventPanel.textContent = `Could not load event config: ${error.message}`;
    });

    const pinsUnsubscribe = onSnapshot(query(collection(db, 'pins'), orderBy('createdAt', 'desc')), (snapshot) => {
      latestPins = snapshot.docs.map((pinDoc) => ({
        id: pinDoc.id,
        data: pinDoc.data(),
      }));
      renderPins();
    }, (error) => {
      pinList.textContent = `Could not load pins: ${error.message}`;
    });

    activeCleanups.push(configUnsubscribe, pinsUnsubscribe);
  });
}

async function clearAllPins() {
  let deletedCount = 0;

  while (true) {
    const snapshot = await getDocs(query(collection(db, 'pins'), limit(500)));
    if (snapshot.empty) {
      return deletedCount;
    }

    const batch = writeBatch(db);
    snapshot.docs.forEach((pinDoc) => batch.delete(pinDoc.ref));
    await batch.commit();
    deletedCount += snapshot.size;
  }
}

function renderNotFound() {
  render(`
    <main class="center-page">
      <section class="card auth-card">
        <p class="eyebrow">${APP_TITLE}</p>
        <h1>Page not found</h1>
        <p>Use <code>/</code> for the TV display, <code>/guest?k=event-key</code> for guests, or <code>/admin</code> for admin.</p>
      </section>
    </main>
  `);
}

function boot() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';

  if (path === '/') {
    renderDisplay();
  } else if (path === '/guest') {
    renderGuest();
  } else if (path === '/admin') {
    renderAdmin();
  } else {
    renderNotFound();
  }
}

startDeploymentRefreshPolling();
boot();
