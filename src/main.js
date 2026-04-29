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
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { auth, db, missingFirebaseConfig } from './firebase.js';

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const WORLD_BOUNDS = [[-60, -180], [85, 180]];
const DISPLAY_WORLD_BOUNDS = [[-55, -180], [72, 140]];
const DISPLAY_INITIAL_PAN = [130, 0];
const DISPLAY_ANIMATION_DURATION_SECONDS = 2.25;
const DISPLAY_ANIMATION_HOLD_MS = 10000;
const RANDOM_PIN_DETAILS_MS = 3000;
const DISPLAY_ANIMATION_VIEWS = [
  { label: 'Europe', bounds: [[35, -12], [72, 35]] },
  { label: 'North America', bounds: [[8, -170], [72, -52]] },
  { label: 'South America', bounds: [[-56, -86], [14, -32]] },
  { label: 'Africa', bounds: [[-36, -20], [38, 52]] },
  { label: 'Asia', bounds: [[-10, 45], [72, 150]] },
  { label: 'Australia-New Zealand', bounds: [[-48, 108], [-9, 180]] },
  { label: 'Original view', bounds: DISPLAY_WORLD_BOUNDS, home: true },
];
const app = document.querySelector('#app');

const pinIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const animatedPinIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  className: 'pin-marker pin-marker--new',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const activeCleanups = [];

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

async function verifyAdminAccess(user) {
  if (!user || !user.email) {
    return false;
  }

  const adminConfig = await getDoc(doc(db, 'config', 'admin'));
  return adminConfig.exists() && auth.currentUser?.uid === user.uid;
}

function bindGoogleGate(renderGooglePage) {
  if (!requireFirebase()) {
    return;
  }

  render(`
    <main class="center-page">
      <section class="card auth-card">
        <p class="eyebrow">Travel Pin Map</p>
        <h1>Checking login...</h1>
      </section>
    </main>
  `);

  onAuthStateChanged(auth, (user) => {
    if (user?.email) {
      renderGooglePage(user);
      return;
    }

    render(`
      <main class="center-page">
        <section class="card auth-card">
          <p class="eyebrow">Travel Pin Map</p>
          <h1>Sign in to view the map</h1>
          <p>Use any Google account to open the TV display.</p>
          <div class="button-row">
            <button class="primary-button" data-google-login>${user ? 'Switch to Google sign-in' : 'Sign in with Google'}</button>
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
  });
}

function bindAdminGate(renderAdminPage) {
  if (!requireFirebase()) {
    return;
  }

  render(`
    <main class="center-page">
      <section class="card auth-card">
        <p class="eyebrow">Travel Pin Map</p>
        <h1>Checking login...</h1>
      </section>
    </main>
  `);

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      render(`
        <main class="center-page">
          <section class="card auth-card">
            <p class="eyebrow">Travel Pin Map</p>
            <h1>Sign in to continue</h1>
            <p>Use a Google account included in the backend admin allowlist.</p>
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
            <p class="eyebrow">Travel Pin Map</p>
            <h1>Checking admin access...</h1>
          </section>
        </main>
      `);
      const hasAccess = await verifyAdminAccess(user);
      if (hasAccess) {
        renderAdminPage(user);
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
          <p class="eyebrow">Travel Pin Map</p>
          <h1>Access not allowed</h1>
          <p>Signed in as <strong>${escapeHtml(user.email)}</strong>. This account is not included in the backend admin allowlist.</p>
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
    <p class="pin-spotlight-label">Now showing</p>
    <h2>${escapeHtml(pin.locationName)}</h2>
    <p class="pin-spotlight-person">Shared by ${escapeHtml(pin.userName || 'Guest')}</p>
    ${pin.note ? `<p class="pin-spotlight-note">${escapeHtml(pin.note)}</p>` : ''}
  `;
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
  bindGoogleGate(() => {
    render(`
      <main class="display-shell">
        <div id="display-map" class="display-map" aria-label="Live travel pin map"></div>
        <div class="display-title">
          <h1 data-event-name>Travel Pin Map</h1>
          <p data-pin-count>Waiting for pins...</p>
        </div>
        <a class="guest-qr" data-guest-qr hidden target="_blank" rel="noreferrer">
          <span>Scan to add your pin</span>
          <img data-guest-qr-image alt="QR code for the guest pin submission page" />
        </a>
        <label class="animation-toggle">
          <input type="checkbox" data-animation-toggle />
          <span>Animate map</span>
        </label>
        <span class="pin-spotlight-line" data-pin-spotlight-line hidden></span>
        <article class="pin-spotlight" data-pin-spotlight hidden></article>
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
    const markers = new Map();
    let pinUnsubscribe = null;
    const status = app.querySelector('[data-display-status]');
    const eventName = app.querySelector('[data-event-name]');
    const pinCount = app.querySelector('[data-pin-count]');
    const guestQr = app.querySelector('[data-guest-qr]');
    const guestQrImage = app.querySelector('[data-guest-qr-image]');
    const animationToggle = app.querySelector('[data-animation-toggle]');
    const pinSpotlight = app.querySelector('[data-pin-spotlight]');
    const pinSpotlightLine = app.querySelector('[data-pin-spotlight-line]');
    let lastGuestUrl = '';
    let animationTimer = null;
    let pinDetailsTimer = null;
    let animationStep = 0;
    let nextPinDetailsAllowedAt = 0;

    const getOverlayRects = () => {
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const overlayElements = [
        app.querySelector('.display-title'),
        guestQr.hidden ? null : guestQr,
        animationToggle.closest('.animation-toggle'),
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

    const positionPinSpotlight = (marker) => {
      const container = map.getContainer();
      const containerRect = container.getBoundingClientRect();
      const point = map.latLngToContainerPoint(marker.getLatLng());
      const overlayRects = getOverlayRects();
      const margin = 10;
      const gap = 22;

      pinSpotlight.style.visibility = 'hidden';
      pinSpotlight.hidden = false;
      pinSpotlightLine.hidden = true;

      const width = pinSpotlight.offsetWidth;
      const height = pinSpotlight.offsetHeight;
      const placements = [
        { name: 'top', left: point.x - (width / 2), top: point.y - height - gap },
        { name: 'right', left: point.x + gap, top: point.y - (height / 2) },
        { name: 'left', left: point.x - width - gap, top: point.y - (height / 2) },
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
          hidePinSpotlight();
          return false;
        }
      }

      pinSpotlight.dataset.placement = placement.name;
      pinSpotlight.style.left = `${placement.left}px`;
      pinSpotlight.style.top = `${placement.top}px`;
      pinSpotlight.style.visibility = '';

      const anchorX = Math.min(Math.max(point.x, placement.left), placement.left + width);
      const anchorY = Math.min(Math.max(point.y, placement.top), placement.top + height);
      const dx = anchorX - point.x;
      const dy = anchorY - point.y;
      const length = Math.hypot(dx, dy);
      if (length > 10) {
        pinSpotlightLine.style.left = `${point.x}px`;
        pinSpotlightLine.style.top = `${point.y}px`;
        pinSpotlightLine.style.width = `${length}px`;
        pinSpotlightLine.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        pinSpotlightLine.hidden = false;
      }
      return true;
    };

    const hidePinSpotlight = () => {
      pinSpotlight.hidden = true;
      pinSpotlight.innerHTML = '';
      pinSpotlightLine.hidden = true;
    };

    const showRandomPinDetails = () => {
      if (Date.now() < nextPinDetailsAllowedAt || markers.size === 0) {
        map.closePopup();
        hidePinSpotlight();
        return;
      }

      const candidates = Array.from(markers.values())
        .filter(({ marker }) => markerIsVisible(marker));
      if (candidates.length === 0) {
        map.closePopup();
        hidePinSpotlight();
        return;
      }

      const shuffledCandidates = [...candidates].sort(() => Math.random() - 0.5);
      map.closePopup();
      for (const { marker, pin } of shuffledCandidates) {
        pinSpotlight.innerHTML = createPinSpotlight(pin);
        if (positionPinSpotlight(marker)) {
          return;
        }
      }

      hidePinSpotlight();
    };

    const startRandomPinDetails = () => {
      window.clearInterval(pinDetailsTimer);
      pinDetailsTimer = window.setInterval(showRandomPinDetails, RANDOM_PIN_DETAILS_MS);
      window.setTimeout(() => {
        if (animationToggle.checked) {
          showRandomPinDetails();
        }
      }, DISPLAY_ANIMATION_DURATION_SECONDS * 1000);
    };

    const stopAnimation = (returnHome = true) => {
      window.clearTimeout(animationTimer);
      window.clearInterval(pinDetailsTimer);
      animationTimer = null;
      pinDetailsTimer = null;
      animationStep = 0;
      map.stop();
      map.closePopup();
      hidePinSpotlight();
      if (returnHome) {
        moveToDisplayHome(map);
      }
    };

    const runAnimationStep = () => {
      if (!animationToggle.checked) {
        return;
      }

      const view = DISPLAY_ANIMATION_VIEWS[animationStep % DISPLAY_ANIMATION_VIEWS.length];
      hidePinSpotlight();
      nextPinDetailsAllowedAt = Date.now() + (DISPLAY_ANIMATION_DURATION_SECONDS * 1000);
      if (view.home) {
        moveToDisplayHome(map);
      } else {
        map.flyToBounds(view.bounds, {
          duration: DISPLAY_ANIMATION_DURATION_SECONDS,
          easeLinearity: 0.25,
          padding: [72, 72],
        });
      }

      animationStep += 1;
      window.setTimeout(() => {
        if (animationToggle.checked) {
          showRandomPinDetails();
        }
      }, DISPLAY_ANIMATION_DURATION_SECONDS * 1000);
      animationTimer = window.setTimeout(runAnimationStep, DISPLAY_ANIMATION_HOLD_MS);
    };

    animationToggle.addEventListener('change', () => {
      if (animationToggle.checked) {
        runAnimationStep();
        startRandomPinDetails();
      } else {
        stopAnimation();
      }
    });

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
      eventName.textContent = config.eventName || 'Travel Pin Map';
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
      pinUnsubscribe = onSnapshot(pinsQuery, (pinsSnapshot) => {
        pinsSnapshot.docChanges().forEach((change) => {
          const id = change.doc.id;
          const pin = change.doc.data();

          if (change.type === 'removed') {
            markers.get(id)?.marker.remove();
            markers.delete(id);
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

          const marker = createTravelPin(pin).addTo(map);
          markers.set(id, { marker, pin });
        });

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
          <p class="eyebrow">Travel Pin Map</p>
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
        <p class="eyebrow">Travel Pin Map</p>
        <h1>Drop a pin somewhere you have travelled</h1>
        <p class="muted">Tap the map to choose a place, then tell us who you are and what it means to you.</p>
        <div class="guest-map" id="guest-map" aria-label="Choose a pin location"></div>
        <form class="pin-form" data-pin-form>
          <label>
            Your name
            <input name="userName" type="text" placeholder="e.g. Clarence" maxlength="79" autocomplete="name" required />
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
  const selectedLocation = app.querySelector('[data-selected-location]');
  const submitButton = app.querySelector('[data-submit]');
  const formStatus = app.querySelector('[data-form-status]');
  const form = app.querySelector('[data-pin-form]');

  const updateSubmitState = () => {
    submitButton.disabled = !selected || !auth.currentUser;
  };

  map.on('click', (event) => {
    selected = {
      lat: Number(event.latlng.lat.toFixed(6)),
      lng: Number(event.latlng.lng.toFixed(6)),
    };

    if (selectedMarker) {
      selectedMarker.setLatLng(event.latlng);
    } else {
      selectedMarker = createPinMarker(event.latlng).addTo(map);
    }

    selectedLocation.textContent = `Selected: ${selected.lat}, ${selected.lng}`;
    formStatus.textContent = '';
    updateSubmitState();
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
    const userName = String(formData.get('userName') || '').trim();
    const locationName = String(formData.get('locationName') || '').trim();
    const note = String(formData.get('note') || '').trim();

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
      formStatus.textContent = 'Pin submitted. Thank you!';
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
            <h1>Travel Pin Map</h1>
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
        <p class="eyebrow">Travel Pin Map</p>
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

boot();
