/* =====================================================================
   TERRALIVE — MULTI-NODE GLOBAL DATA VISUALIZATION HUB
   =====================================================================
   File    : script.js   (ONE shared script for all five pages)
   Stack   : Vanilla JavaScript (ES2020) — no frameworks, no build step
   Maps    : Leaflet 1.9.4 loaded from CDN only on the two map pages

   HOW THIS FILE IS ORGANISED (worth explaining in the Viva):
   ---------------------------------------------------------------------
     1. CONFIG            — every API URL / constant in ONE place
     2. SHARED UTILITIES   — fetchJSON(), formatting + lookup helpers
     3. COMMON MODULE      — hamburger menu (runs on every page)
     4. HOME MODULE        — landing-page live stats + terminal log
     5. SEISMIC MODULE     — USGS feed -> Leaflet map + event log
     6. ATMOSPHERIC MODULE — Open-Meteo weather + air quality (Manama)
     7. ORBITAL MODULE     — "Where the ISS at?" polled every 5 seconds
     8. APP ROUTER         — reads <body data-page="..."> and launches
                             ONLY the module the current page needs
   ---------------------------------------------------------------------
   PAGE ROUTING TRICK (explain this!):
   Every HTML page declares which page it is, e.g.  <body data-page="seismic">.
   The router at the bottom of this file reads that attribute once the DOM
   is ready and calls the matching initialiser. That is how one single
   script file can safely serve five different pages without ever touching
   elements that do not exist on the current page.
===================================================================== */

"use strict";

/* =====================================================================
   1. CONFIG — all endpoints & tunables in one place
   ---------------------------------------------------------------------
   Why these APIs? They are free, public, need NO API key, and send
   permissive CORS headers (Access-Control-Allow-Origin: *), so the exact
   same code works from a local file:// page or from any web host.
===================================================================== */
const CONFIG = {

  /* ---- NODE 01 : SEISMIC (USGS Earthquake Hazards Program) ---- */
  // Full feed: EVERY quake (down to tiny magnitudes) in the last 24 hours.
  USGS_FEED_URL:
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",

  // Lighter feed (magnitude 2.5+ only) used on the HOME page so the
  // landing page downloads ~50 KB instead of ~1 MB.
  USGS_HOME_URL:
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",

  // How often the seismic page silently re-syncs (5 minutes).
  QUAKE_REFRESH_MS: 5 * 60 * 1000,

  /* ---- NODE 02 : ATMOSPHERIC (Open-Meteo, no API key) ---- */
  // The project spec hardcodes ONE city: Manama, Bahrain.
  CITY: {
    name: "Manama, Bahrain",
    latitude: 26.2285,
    longitude: 50.5860,
  },

  // Current weather + the next 24 hours of hourly temperatures.
  // (timezone=auto lets Open-Meteo return times already in Bahrain local time.)
  WEATHER_URL:
    "https://api.open-meteo.com/v1/forecast" +
    "?latitude=26.2285&longitude=50.5860" +
    "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day," +
    "precipitation,weather_code,cloud_cover,pressure_msl,uv_index," +
    "wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
    "&hourly=temperature_2m&forecast_days=2&timezone=auto",

  // Separate Open-Meteo service for air quality (US + European AQI and
  // the six major pollutants, all in µg/m³).
  AIR_QUALITY_URL:
    "https://air-quality-api.open-meteo.com/v1/air-quality" +
    "?latitude=26.2285&longitude=50.5860" +
    "&current=european_aqi,us_aqi,pm10,pm2_5,carbon_monoxide," +
    "nitrogen_dioxide,sulphur_dioxide,ozone&timezone=auto",

  /* ---- NODE 03 : ORBITAL ("Where the ISS at?") ---- */
  // 25544 is the official NORAD catalogue ID of the International
  // Space Station (ZARYA). Free tier allows ~1 request/second.
  ISS_URL: "https://api.wheretheiss.at/v1/satellites/25544",

  // Project spec: refresh the ISS position every 5 seconds.
  ISS_POLL_MS: 5000,

  /* ---- BASEMAP (used by both Leaflet maps) ---- */
  // CARTO's free "dark matter" tiles drawn on top of OpenStreetMap data.
  // {s}/{z}/{x}/{y} are placeholders that Leaflet fills in per tile.
  TILES_URL: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  TILES_ATTRIBUTION:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> ' +
    'contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};

/* =====================================================================
   2. SHARED UTILITIES
===================================================================== */

/* ---------------------------------------------------------------------
   fetchJSON(url) — THE heart of the whole project.
   ---------------------------------------------------------------------
   VIVA NOTE — how the asynchronous fetch() works, step by step:

   1. fetch(url) asks the browser to send an HTTP GET request to the API.
      It returns IMMEDIATELY with a Promise — an "I owe you" object for a
      result that will arrive some time later (maybe 100 ms, maybe 3 s).

   2. Declaring this function `async` lets us use the `await` keyword.
      `await response` suspends ONLY THIS FUNCTION until the Promise
      settles. The rest of the page (menus, animations, scrolling)
      keeps running — the browser's event loop is never blocked.

   3. When the response arrives we check `response.ok` (true when the
      HTTP status is 200–299). If the server answered 404 or 500 we
      throw our own Error, just like a network failure.

   4. response.json() reads the response body and parses the JSON text
      into a real JavaScript object. It is ALSO asynchronous (the body
      may still be streaming in), so we await it too.

   5. The parsed object is returned to whoever called us — the caller
      will typically do `const data = await fetchJSON(url)` and then
      read plain properties such as data.current.temperature_2m.

   6. Anything thrown inside the try block (offline, DNS failure, bad
      status, invalid JSON) is caught by the CALLER's try/catch, which
      flips the node's status pill to "OFFLINE" instead of crashing.
--------------------------------------------------------------------- */
async function fetchJSON(url) {
  const response = await fetch(url);            // step 1 + 2
  if (!response.ok) {                           // step 3
    throw new Error("HTTP " + response.status + " from " + url);
  }
  return await response.json();                 // step 4 + 5
}

/* Tiny helper: makes any API string safe to inject into innerHTML.
   Replaces the characters the browser treats as markup. */
function escapeHTML(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/* Updates a status pill: setPill(el, "online", "ONLINE")
   The .dot span is coloured by CSS classes .online / .syncing / .error */
function setPill(pillEl, state, text) {
  if (!pillEl) return;
  pillEl.classList.remove("syncing", "online", "error");
  pillEl.classList.add(state);
  const label = pillEl.querySelector(".status-text");
  if (label && text) label.textContent = text;
}

/* Current UTC time as "HH:MM:SS" — used by clocks and log lines. */
function nowUTC() {
  return new Date().toUTCString().slice(17, 25);   // "13:07:42"
}

/* "3 min ago" style relative time from an epoch-milliseconds value. */
function timeAgo(epochMs) {
  const seconds = Math.floor((Date.now() - epochMs) / 1000);
  if (seconds < 60) return seconds + "s ago";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h " + (minutes % 60) + "m ago";
  return Math.floor(hours / 24) + "d ago";
}

/* Converts a wind direction in degrees (0–360) into a 16-point compass
   label such as "NW" or "SSE" — nicer for humans than raw degrees. */
function compassDirection(degrees) {
  const points = ["N","NNE","NE","ENE","E","ESE","SE","SSE",
                  "S","SSW","SW","WSW","W","WNW","NW","NNW"];
  const index = Math.round(((degrees % 360) / 22.5)) % 16;
  return points[index];
}

/* Formats a latitude/longitude value with its hemisphere letter,
   e.g.  41.83 -> "41.83° N"   /   -133.38 -> "133.38° W" */
function formatLatLon(value, isLatitude) {
  const hemisphere = isLatitude
    ? (value >= 0 ? "N" : "S")
    : (value >= 0 ? "E" : "W");
  return Math.abs(value).toFixed(2) + "° " + hemisphere;
}

/* ---------------------------------------------------------------------
   WMO weather-code lookup table.
   Open-Meteo does NOT send text like "Partly cloudy" — it sends a numeric
   WMO code (e.g. 2). We translate the code into a label + icon ourselves.
--------------------------------------------------------------------- */
const WEATHER_CODES = {
  0:  { label: "Clear sky",                icon: "☀️" },
  1:  { label: "Mainly clear",             icon: "🌤️" },
  2:  { label: "Partly cloudy",            icon: "⛅" },
  3:  { label: "Overcast",                 icon: "☁️" },
  45: { label: "Fog",                      icon: "🌫️" },
  48: { label: "Depositing rime fog",      icon: "🌫️" },
  51: { label: "Light drizzle",            icon: "🌦️" },
  53: { label: "Moderate drizzle",         icon: "🌦️" },
  55: { label: "Dense drizzle",            icon: "🌧️" },
  56: { label: "Light freezing drizzle",   icon: "🌧️" },
  57: { label: "Dense freezing drizzle",   icon: "🌧️" },
  61: { label: "Slight rain",              icon: "🌧️" },
  63: { label: "Moderate rain",            icon: "🌧️" },
  65: { label: "Heavy rain",               icon: "🌧️" },
  66: { label: "Light freezing rain",      icon: "🌨️" },
  67: { label: "Heavy freezing rain",      icon: "🌨️" },
  71: { label: "Slight snowfall",          icon: "🌨️" },
  73: { label: "Moderate snowfall",        icon: "❄️" },
  75: { label: "Heavy snowfall",           icon: "❄️" },
  77: { label: "Snow grains",              icon: "❄️" },
  80: { label: "Slight rain showers",      icon: "🌦️" },
  81: { label: "Moderate rain showers",    icon: "🌧️" },
  82: { label: "Violent rain showers",     icon: "⛈️" },
  85: { label: "Slight snow showers",      icon: "🌨️" },
  86: { label: "Heavy snow showers",       icon: "❄️" },
  95: { label: "Thunderstorm",             icon: "⛈️" },
  96: { label: "Thunderstorm with hail",   icon: "⛈️" },
  99: { label: "Thunderstorm, heavy hail", icon: "🌩️" },
};

/* ---------------------------------------------------------------------
   US AQI classification (defined by the US EPA).
   Given a numeric US AQI value we return the official category name,
   a colour for the UI, and a plain-English health message.
--------------------------------------------------------------------- */
function usaqiCategory(aqi) {
  if (aqi <= 50)  return { label: "Good",           color: "#34d399",
    advice: "Air quality is satisfactory — air pollution poses little or no risk." };
  if (aqi <= 100) return { label: "Moderate",       color: "#fbbf24",
    advice: "Acceptable air quality, though unusually sensitive people should watch prolonged outdoor exertion." };
  if (aqi <= 150) return { label: "Sensitive Groups", color: "#fb923c",
    advice: "Members of sensitive groups (children, elderly, asthmatics) may experience health effects." };
  if (aqi <= 200) return { label: "Unhealthy",      color: "#f87171",
    advice: "Everyone may begin to experience health effects on prolonged exposure." };
  if (aqi <= 300) return { label: "Very Unhealthy", color: "#c084fc",
    advice: "Health alert — everyone may experience serious health effects." };
  return { label: "Hazardous", color: "#f43f5e",
    advice: "Health emergency — everyone is likely to be affected." };
}

/* Earthquake magnitude -> colour. Used for markers, list badges, legend. */
function magnitudeColor(mag) {
  if (mag >= 5)   return "#f87171";   // red    — major
  if (mag >= 4)   return "#fb923c";   // orange — strong
  if (mag >= 3)   return "#fbbf24";   // amber  — moderate
  if (mag >= 2)   return "#34d399";   // green  — light
  return "#22d3ee";                   // cyan   — minor
}

/* =====================================================================
   3. COMMON MODULE — mobile hamburger menu (runs on every page)
===================================================================== */
function initCommon() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");

  if (toggle && menu) {
    // classList.toggle returns true when the class was ADDED,
    // so we can sync the button's accessible "expanded" state in one line.
    toggle.addEventListener("click", () => {
      const open = menu.classList.toggle("open");
      toggle.classList.toggle("open", open);
      toggle.setAttribute("aria-expanded", String(open));
    });

    // After choosing a page on a phone, collapse the menu again.
    menu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        menu.classList.remove("open");
        toggle.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Friendly startup line in the browser console (handy during the demo).
  console.log(
    "%c TERRALIVE %c command centre online ",
    "background:#22d3ee;color:#03242d;font-weight:bold",
    "background:#0b1220;color:#9fb0c8"
  );
}

/* =====================================================================
   4. HOME MODULE — landing dashboard
   ---------------------------------------------------------------------
   Responsibilities:
     • run the 1-second "MISSION TIME" UTC clock (setInterval demo #1)
     • fetch a small summary from EACH of the three nodes
     • write the results into the three node cards
     • append timestamped lines into the telemetry terminal
===================================================================== */
function initHomePage() {

  /* ---- 4a. Mission clock — updated every second ---- */
  const clock = document.getElementById("mission-clock");

  function tick() {
    if (clock) clock.textContent = nowUTC() + " UTC";
  }
  tick();                                // paint immediately (no 1 s gap)
  setInterval(tick, 1000);               // then repaint every second

  /* ---- 4b. Terminal log helper ---- */
  const logList = document.getElementById("terminal-log");

  function logLine(message) {
    if (!logList) return;
    const line = document.createElement("li");
    // Prepending (not appending) keeps the newest line on top.
    line.innerHTML =
      '<span class="t">[' + nowUTC() + ' UTC]</span> ' + escapeHTML(message);
    logList.prepend(line);
    // Keep the log tidy: never show more than 9 lines.
    while (logList.children.length > 9) {
      logList.removeChild(logList.lastChild);
    }
  }

  /* ---- 4c. One async function per node ---- */

  // SEISMIC summary: uses the lighter M2.5+ feed so the landing page
  // stays fast. We only need the count and the strongest magnitude.
  async function syncSeismic() {
    const pill = document.getElementById("status-quake");
    try {
      const data = await fetchJSON(CONFIG.USGS_HOME_URL);
      const quakes = data.features || [];

      // Reduce the array to the strongest magnitude in one pass.
      let strongest = null;
      for (const q of quakes) {
        const m = q.properties.mag;
        if (m != null && (strongest === null || m > strongest)) strongest = m;
      }

      document.getElementById("stat-quake").textContent =
        quakes.length + " events";
      document.getElementById("stat-quake-sub").textContent =
        "M2.5+ in last 24 h · strongest M" +
        (strongest != null ? strongest.toFixed(1) : "—");

      setPill(pill, "online", "LIVE");
      logLine("SEISMIC uplink established — " + quakes.length +
              " events (M2.5+) in last 24 h");
    } catch (err) {
      setPill(pill, "error", "OFFLINE");
      document.getElementById("stat-quake").textContent = "OFFLINE";
      document.getElementById("stat-quake-sub").textContent = "uplink failed";
      logLine("SEISMIC uplink FAILED — press Re-sync to retry");
      console.error("[TerraLive] USGS home sync failed:", err);
    }
  }

  // ATMOSPHERIC summary: one Open-Meteo request, temperature + label.
  async function syncAtmospheric() {
    const pill = document.getElementById("status-wx");
    try {
      const data = await fetchJSON(CONFIG.WEATHER_URL);
      const cur = data.current;
      const code = WEATHER_CODES[cur.weather_code] ||
                   { label: "Code " + cur.weather_code, icon: "🌡️" };

      document.getElementById("stat-wx").textContent =
        Math.round(cur.temperature_2m) + "°C";
      document.getElementById("stat-wx-sub").textContent =
        code.label + " · Manama, BH";

      setPill(pill, "online", "LIVE");
      logLine("ATMOSPHERIC uplink established — " +
              Math.round(cur.temperature_2m) + "°C, " + code.label);
    } catch (err) {
      setPill(pill, "error", "OFFLINE");
      document.getElementById("stat-wx").textContent = "OFFLINE";
      document.getElementById("stat-wx-sub").textContent = "uplink failed";
      logLine("ATMOSPHERIC uplink FAILED — press Re-sync to retry");
      console.error("[TerraLive] Open-Meteo home sync failed:", err);
    }
  }

  // ORBITAL summary: a single position fix from WhereTheISS.at.
  async function syncOrbital() {
    const pill = document.getElementById("status-iss");
    try {
      const iss = await fetchJSON(CONFIG.ISS_URL);

      document.getElementById("stat-iss").textContent =
        formatLatLon(iss.latitude, true) + " · " +
        formatLatLon(iss.longitude, false);
      document.getElementById("stat-iss-sub").textContent =
        "alt " + iss.altitude.toFixed(0) + " km · " +
        Math.round(iss.velocity).toLocaleString("en-US") + " km/h";

      setPill(pill, "online", "LIVE");
      logLine("ORBITAL lock acquired — ISS over " +
              formatLatLon(iss.latitude, true) + " " +
              formatLatLon(iss.longitude, false));
    } catch (err) {
      setPill(pill, "error", "OFFLINE");
      document.getElementById("stat-iss").textContent = "OFFLINE";
      document.getElementById("stat-iss-sub").textContent = "uplink failed";
      logLine("ORBITAL uplink FAILED — press Re-sync to retry");
      console.error("[TerraLive] ISS home sync failed:", err);
    }
  }

  /* ---- 4d. Launch all three syncs ---- */
  function syncAll() {
    logList.innerHTML = "";                    // clear old log
    logLine("TerraLive command centre online — initialising node uplinks…");

    /* VIVA NOTE — Promise.allSettled vs Promise.all:
       allSettled NEVER rejects. Even if the USGS call fails, the other two
       still run and each handles its own failure in its catch block.
       With plain Promise.all, the first rejection would abandon the rest. */
    Promise.allSettled([syncSeismic(), syncAtmospheric(), syncOrbital()]);
  }

  document.getElementById("home-resync")
    .addEventListener("click", syncAll);

  syncAll();
}

/* =====================================================================
   5. SEISMIC MODULE — earthquakes.html
   ---------------------------------------------------------------------
   Flow: init map -> fetch GeoJSON -> draw circle markers -> render event
   log. Re-runs automatically every 5 minutes and on the Resync button.
===================================================================== */
function initSeismicPage() {

  /* ---- 5a. Guard: this module only runs when Leaflet is loaded ---- */
  if (typeof L === "undefined") {
    setPill(document.getElementById("quake-status"), "error", "NO LEAFLET");
    document.getElementById("quake-list").innerHTML =
      '<p class="loading-text">Leaflet failed to load — check your connection.</p>';
    return;
  }

  /* ---- 5b. Initialise the Leaflet map ----
     L.map(...) grabs the #quake-map div. setView([lat, lon], zoom)
     picks the initial camera: zoom 2 shows most of the planet.
     worldCopyJump lets the map wrap smoothly at the date line. */
  const map = L.map("quake-map", { worldCopyJump: true }).setView([25, 10], 2);

  L.tileLayer(CONFIG.TILES_URL, {
    attribution: CONFIG.TILES_ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  // All quake markers live in one LayerGroup so we can wipe & redraw
  // them in a single call when the magnitude filter changes.
  const markerLayer = L.layerGroup().addTo(map);

  /* ---- 5c. Magnitude legend (a custom Leaflet control) ---- */
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = function () {
    const div = L.DomUtil.create("div", "mag-legend");
    const rows = [
      ["M5+", 5], ["M4–5", 4], ["M3–4", 3], ["M2–3", 2], ["< M2", 0],
    ];
    div.innerHTML = '<div class="legend-title">MAGNITUDE</div>' +
      rows.map(([label, mag]) =>
        '<div class="row"><span class="swatch" style="background:' +
        magnitudeColor(mag) + '"></span>' + label + "</div>"
      ).join("");
    return div;
  };
  legend.addTo(map);

  /* ---- 5d. Module state ---- */
  let allQuakes = [];        // the full USGS feature array (cached in RAM)
  let currentFilter = 0;     // minimum magnitude currently selected
  let isFetching = false;    // guard against overlapping requests
  const markersById = {};    // feature id -> Leaflet marker (for fly-to)

  /* Filter helper: null magnitudes count as 0 so "ALL" still shows them. */
  function getFiltered() {
    return allQuakes.filter(
      (q) => (q.properties.mag ?? 0) >= currentFilter
    );
  }

  /* ---- 5e. Draw one popup's HTML for a quake feature ---- */
  function quakePopupHTML(feature) {
    const p = feature.properties;
    const [lon, lat, depthKm] = feature.geometry.coordinates;
    const mag = p.mag != null ? p.mag.toFixed(1) : "—";

    return (
      '<div class="popup-title">M ' + mag + ' Earthquake</div>' +
      '<div class="popup-place">' + escapeHTML(p.place || "Unknown region") + "</div>" +
      '<div class="popup-row"><span>Magnitude</span><span>' + mag + "</span></div>" +
      '<div class="popup-row"><span>Depth</span><span>' +
        (depthKm != null ? depthKm.toFixed(1) + " km" : "—") + "</span></div>" +
      '<div class="popup-row"><span>Time</span><span>' +
        new Date(p.time).toLocaleString() + "</span></div>" +
      '<a class="popup-link" href="' + p.url + '" target="_blank" rel="noopener">' +
        "USGS event page ↗</a>"
    );
  }

  /* ---- 5f. Render markers for the currently filtered set ---- */
  function renderMarkers() {
    markerLayer.clearLayers();          // wipe previous circles
    for (const key in markersById) delete markersById[key];

    getFiltered().forEach((feature) => {
      // GeoJSON stores coordinates as [longitude, latitude, depth] —
      // Leaflet wants [latitude, longitude]. A classic Viva gotcha!
      const [lon, lat] = feature.geometry.coordinates;
      const mag = feature.properties.mag ?? 0;
      const color = magnitudeColor(mag);

      const marker = L.circleMarker([lat, lon], {
        radius: 4 + mag * 2.4,          // bigger circle = bigger quake
        color: color,
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.45,
        opacity: 0.9,
      })
        .bindPopup(quakePopupHTML(feature))
        .addTo(markerLayer);

      markersById[feature.id] = marker;
    });
  }

  /* ---- 5g. Render the scrollable event log (newest first) ---- */
  function renderList() {
    const listEl = document.getElementById("quake-list");
    const quakes = getFiltered()
      .slice()
      .sort((a, b) => b.properties.time - a.properties.time);   // newest 1st

    listEl.innerHTML = "";

    // Cap at 40 DOM rows so huge feed days cannot slow the page down.
    quakes.slice(0, 40).forEach((feature) => {
      const p = feature.properties;
      const [lon, lat, depthKm] = feature.geometry.coordinates;
      const mag = p.mag != null ? p.mag.toFixed(1) : "—";
      const color = magnitudeColor(p.mag ?? 0);

      const item = document.createElement("article");
      item.className = "quake-item";
      item.innerHTML =
        '<div class="quake-left">' +
          '<div class="quake-place">' + escapeHTML(p.place || "Unknown region") + "</div>" +
          '<div class="quake-meta">' + timeAgo(p.time) + " · " +
            (depthKm != null ? depthKm.toFixed(0) : "—") + " km deep</div>" +
        "</div>" +
        '<div class="quake-mag" style="color:' + color +
          ";border-color:" + color + '">' + mag + "</div>";

      // Clicking a row flies the camera to that quake and opens its popup.
      item.addEventListener("click", () => {
        map.flyTo([lat, lon], 5, { duration: 1.2 });
        const marker = markersById[feature.id];
        if (marker) marker.openPopup();
      });

      listEl.appendChild(item);
    });

    document.getElementById("quake-count").textContent =
      "SHOWING " + Math.min(40, quakes.length) + " OF " + quakes.length +
      " FILTERED EVENTS · " + allQuakes.length + " TOTAL IN FEED";
  }

  /* ---- 5h. Top-strip statistics ---- */
  function renderStats() {
    document.getElementById("stat-total").textContent = allQuakes.length;

    let strongestFeature = null;
    for (const q of allQuakes) {
      const m = q.properties.mag;
      if (m != null &&
          (strongestFeature === null || m > strongestFeature.properties.mag)) {
        strongestFeature = q;
      }
    }

    if (strongestFeature) {
      document.getElementById("stat-strongest").textContent =
        "M " + strongestFeature.properties.mag.toFixed(1);
      const place = strongestFeature.properties.place || "—";
      document.getElementById("stat-strongest-place").textContent =
        place.length > 34 ? place.slice(0, 33) + "…" : place;
    }

    if (allQuakes.length > 0) {
      const newest = allQuakes.reduce(
        (a, b) => (a.properties.time > b.properties.time ? a : b)
      );
      document.getElementById("stat-last").textContent =
        timeAgo(newest.properties.time);
    }
  }

  /* ---- 5i. The main load cycle ---- */
  async function loadQuakes() {
    /* VIVA NOTE — the isFetching guard:
       setInterval does NOT wait for the previous fetch to finish. On a slow
       network a 5-minute tick could fire while a request is still in flight,
       causing two overlapping renders. The boolean flag simply skips any
       tick that arrives while a request is already running. */
    if (isFetching) return;
    isFetching = true;

    const pill = document.getElementById("quake-status");
    setPill(pill, "syncing", "SYNCING");

    try {
      const data = await fetchJSON(CONFIG.USGS_FEED_URL);

      // Keep only well-formed features (guard against odd feed entries).
      allQuakes = (data.features || []).filter(
        (f) => f.geometry && Array.isArray(f.geometry.coordinates)
      );

      renderStats();
      renderMarkers();
      renderList();

      setPill(pill, "online", "LIVE · " + allQuakes.length);
      document.getElementById("quake-updated").textContent =
        nowUTC() + " UTC";
    } catch (err) {
      setPill(pill, "error", "OFFLINE");
      document.getElementById("quake-list").innerHTML =
        '<p class="loading-text">UPLINK FAILED — press RESYNC to retry</p>';
      console.error("[TerraLive] USGS feed failed:", err);
    } finally {
      // finally ALWAYS runs — success or failure — so the lock is released.
      isFetching = false;
    }
  }

  /* ---- 5j. Wire up the UI ---- */

  // Magnitude filter chips: swap the .active class and re-render.
  document.querySelectorAll("#mag-filters .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("#mag-filters .chip")
        .forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      currentFilter = parseFloat(chip.dataset.minMag);   // reads data-min-mag
      renderMarkers();
      renderList();
    });
  });

  document.getElementById("quake-refresh")
    .addEventListener("click", loadQuakes);

  // Auto re-sync every 5 minutes (Viva: setInterval demo #2).
  setInterval(loadQuakes, CONFIG.QUAKE_REFRESH_MS);

  // Kick off the first load immediately.
  loadQuakes();
}

/* =====================================================================
   6. ATMOSPHERIC MODULE — weather.html (Manama, Bahrain)
   ---------------------------------------------------------------------
   This page needs TWO Open-Meteo responses (weather + air quality).
   VIVA NOTE — Promise.all runs both requests IN PARALLEL:
   total waiting time ≈ the slower of the two, not the sum of both.
   If EITHER request fails, Promise.all rejects and our single catch
   block shows the "UPLINK FAILED" banner for the whole node.
===================================================================== */
async function initAtmosphericPage() {

  const pill = document.getElementById("wx-status");
  const alertBox = document.getElementById("wx-alert");

  /* Which pollutant rows to draw, and the visual scale maximum for each
     bar (a display choice — NOT an official EPA breakpoint). */
  const POLLUTANTS = [
    { key: "pm2_5",           label: "PM<sub>2.5</sub>", max: 150 },
    { key: "pm10",            label: "PM<sub>10</sub>",  max: 250 },
    { key: "ozone",           label: "O<sub>3</sub>",    max: 200 },
    { key: "nitrogen_dioxide", label: "NO<sub>2</sub>",  max: 200 },
    { key: "sulphur_dioxide",  label: "SO<sub>2</sub>",  max: 300 },
    { key: "carbon_monoxide",  label: "CO",              max: 10000 },
  ];

  /* ---- 6a. Render the "Current Conditions" card ---- */
  function renderCurrent(weather) {
    const cur = weather.current;
    const code = WEATHER_CODES[cur.weather_code] ||
                 { label: "Unknown code " + cur.weather_code, icon: "🌡️" };

    document.getElementById("wx-icon").textContent = code.icon;
    document.getElementById("wx-temp").textContent =
      Math.round(cur.temperature_2m);
    document.getElementById("wx-desc").textContent = code.label;
    document.getElementById("wx-feels").textContent =
      "FEELS LIKE " + Math.round(cur.apparent_temperature) + "°C · OBSERVED " +
      cur.time.slice(11) + " LOCAL";
    document.getElementById("obs-time").textContent =
      "OBS " + cur.time.slice(11) + " AST";

    document.getElementById("wx-humidity").textContent =
      cur.relative_humidity_2m + "%";
    document.getElementById("wx-wind").textContent =
      Math.round(cur.wind_speed_10m) + " km/h " +
      compassDirection(cur.wind_direction_10m);
    document.getElementById("wx-gust").textContent =
      Math.round(cur.wind_gusts_10m) + " km/h";
    document.getElementById("wx-pressure").textContent =
      Math.round(cur.pressure_msl) + " hPa";
    document.getElementById("wx-cloud").textContent = cur.cloud_cover + "%";
    document.getElementById("wx-precip").textContent =
      cur.precipitation.toFixed(1) + " mm";
    document.getElementById("wx-uv").textContent =
      cur.uv_index != null ? cur.uv_index.toFixed(1) : "—";
    document.getElementById("wx-day").textContent =
      cur.is_day ? "DAYLIGHT" : "NIGHTSIDE";
  }

  /* ---- 6b. Render the air-quality card ---- */
  function renderAirQuality(air) {
    const cur = air.current;
    const aqi = cur.us_aqi;
    const cat = usaqiCategory(aqi);

    const valueEl = document.getElementById("aqi-value");
    valueEl.textContent = aqi;
    valueEl.style.color = cat.color;
    valueEl.style.textShadow = "0 0 22px " + cat.color + "66";

    document.getElementById("aqi-category").textContent =
      cat.label + " · US AQI " + aqi;
    document.getElementById("aqi-category").style.color = cat.color;
    document.getElementById("aqi-advice").textContent = cat.advice;
    document.getElementById("aqi-eu").textContent =
      cur.european_aqi != null ? cur.european_aqi : "—";

    // One horizontal gauge bar per pollutant.
    const wrap = document.getElementById("pollutants");
    wrap.innerHTML = "";
    POLLUTANTS.forEach((p) => {
      const value = cur[p.key];
      const row = document.createElement("div");
      row.className = "pollutant";
      row.innerHTML =
        '<div class="pollutant-head">' +
          '<span class="pollutant-name">' + p.label + "</span>" +
          '<span class="pollutant-value">' +
            (value != null ? value.toFixed(1) : "—") +
            " µg/m³</span>" +
        "</div>" +
        '<div class="aqi-bar-track"><div class="aqi-bar-fill" style="width:' +
          Math.min(100, ((value ?? 0) / p.max) * 100).toFixed(1) +
          "%; background:" + cat.color + '"></div></div>';
      wrap.appendChild(row);
    });
  }

  /* ---- 6c. Render the 24 h temperature chart (pure CSS bars) ---- */
  function renderHourlyChart(weather) {
    const chart = document.getElementById("temp-chart");
    const times = weather.hourly.time;               // "2026-10-13T18:00"
    const temps = weather.hourly.temperature_2m;

    /* Find the array index of the CURRENT hour. Because we asked for
       timezone=auto, the API's timestamps are in Bahrain local time —
       so we derive the key from the API's own current.time string
       instead of the visitor's clock. That keeps the chart correct
       for viewers in any country. */
    const startKey = weather.current.time.slice(0, 13) + ":00";
    let start = times.indexOf(startKey);
    if (start < 0) start = 0;                        // graceful fallback

    const next24 = [];
    for (let i = start; i < Math.min(start + 24, temps.length); i++) {
      next24.push({ time: times[i], temp: temps[i] });
    }

    const min = Math.min(...next24.map((h) => h.temp));
    const max = Math.max(...next24.map((h) => h.temp));

    chart.innerHTML = "";
    next24.forEach((hour) => {
      // Map the temperature into a 15%–100% bar-height range so even
      // the coldest hour stays visible on the chart.
      const ratio = max === min ? 0.5 : (hour.temp - min) / (max - min);
      const heightPct = (15 + ratio * 85).toFixed(1);

      const col = document.createElement("div");
      col.className = "chart-col";
      col.title = hour.time.replace("T", " ") + " — " +
        hour.temp.toFixed(1) + "°C";                 // native tooltip
      col.innerHTML =
        '<div class="chart-bar-area">' +
          '<div class="chart-bar" style="height:' + heightPct + '%">' +
            '<span class="chart-val">' + Math.round(hour.temp) + "°</span>" +
          "</div>" +
        "</div>" +
        '<span class="chart-hour">' + hour.time.slice(11, 16) + "</span>";
      chart.appendChild(col);
    });
  }

  /* ---- 6d. The main load cycle ---- */
  async function loadAtmospheric() {
    const refreshBtn = document.getElementById("wx-refresh");
    setPill(pill, "syncing", "SYNCING");
    alertBox.hidden = true;
    refreshBtn.disabled = true;

    try {
      /* VIVA NOTE — Promise.all:
         Both fetches start one after another WITHOUT waiting for each
         other, then `await` pauses here until BOTH are resolved.
         Parallel requests ≈ half the wait time of doing them in order. */
      const [weather, air] = await Promise.all([
        fetchJSON(CONFIG.WEATHER_URL),
        fetchJSON(CONFIG.AIR_QUALITY_URL),
      ]);

      renderCurrent(weather);
      renderAirQuality(air);
      renderHourlyChart(weather);

      setPill(pill, "online", "LIVE");
      document.getElementById("wx-updated").textContent = nowUTC() + " UTC";
    } catch (err) {
      setPill(pill, "error", "OFFLINE");
      alertBox.hidden = false;
      console.error("[TerraLive] Open-Meteo failed:", err);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  document.getElementById("wx-refresh")
    .addEventListener("click", loadAtmospheric);

  loadAtmospheric();
}

/* =====================================================================
   7. ORBITAL MODULE — iss.html
   ---------------------------------------------------------------------
   The spec: poll the ISS position EVERY 5 SECONDS with setInterval()
   and move the marker. We also draw a fading ground trail and the
   station's visibility footprint circle.
===================================================================== */
function initOrbitalPage() {

  if (typeof L === "undefined") {
    setPill(document.getElementById("iss-status"), "error", "NO LEAFLET");
    return;
  }

  /* ---- 7a. Map + custom ISS marker ---- */
  const map = L.map("iss-map", { worldCopyJump: true }).setView([20, 0], 2);

  L.tileLayer(CONFIG.TILES_URL, {
    attribution: CONFIG.TILES_ATTRIBUTION,
    subdomains: "abcd",
    maxZoom: 19,
  }).addTo(map);

  /* A divIcon lets us use our OWN HTML+CSS as the map marker instead
     of an image file — see the .iss-marker styles in style.css. */
  const issIcon = L.divIcon({
    className: "iss-marker",
    html: '<div class="iss-core"></div><div class="iss-label">ISS</div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],               // centre the icon on the coordinate
  });

  const issMarker = L.marker([0, 0], {
    icon: issIcon,
    title: "International Space Station",
  }).addTo(map);

  // The dashed circle = the area from which the ISS is visible (~2,250 km).
  const footprint = L.circle([0, 0], {
    radius: 2250000,                  // metres — updated live from the API
    color: "#22d3ee",
    weight: 1,
    dashArray: "4 8",
    fillOpacity: 0.04,
  }).addTo(map);

  // Ground trail: every fix adds a short polyline segment to this group.
  const trailLayer = L.layerGroup().addTo(map);

  /* ---- 7b. State ---- */
  let lastFix = null;      // [lat, lon] of the previous fix
  let fixCount = 0;        // how many successful fixes we have received
  let inFlight = false;    // same overlap-guard idea as the seismic module
  let firstFix = true;     // pan the camera only ONCE, on the first fix

  const followToggle = document.getElementById("follow-toggle");
  let followISS = followToggle ? followToggle.checked : true;

  followToggle.addEventListener("change", () => {
    followISS = followToggle.checked;
  });

  /* ---- 7c. One polling cycle ---- */
  async function pollISS() {
    if (inFlight) return;             // skip this tick if one is running
    inFlight = true;

    const pill = document.getElementById("iss-status");

    try {
      const d = await fetchJSON(CONFIG.ISS_URL);   // one position fix

      const latlng = [d.latitude, d.longitude];

      /* Move marker + footprint to the new position. */
      issMarker.setLatLng(latlng);
      footprint.setLatLng(latlng);
      footprint.setRadius((d.footprint * 1000) / 2);   // km diameter -> m radius

      /* Ground trail: draw a segment from the previous fix to this one —
         UNLESS the longitude jumped more than 90°, which means the station
         crossed the date line and a straight line would streak across the
         whole map. Skipping those jumps keeps the trail looking correct. */
      if (lastFix && Math.abs(d.longitude - lastFix[1]) < 90) {
        trailLayer.addLayer(
          L.polyline([lastFix, latlng], {
            color: "#22d3ee",
            weight: 2,
            opacity: 0.55,
            dashArray: "6 7",
          })
        );
        // Keep at most 90 segments (~7.5 minutes of flight) on screen.
        if (trailLayer.getLayers().length > 90) {
          trailLayer.removeLayer(trailLayer.getLayers()[0]);
        }
      }
      lastFix = latlng;
      fixCount++;

      /* Live popup content (updates even while the popup is open). */
      issMarker.setPopupContent(
        '<div class="popup-title">ISS · ZARYA</div>' +
        '<div class="popup-place">International Space Station</div>' +
        '<div class="popup-row"><span>Position</span><span>' +
          formatLatLon(d.latitude, true) + " " + formatLatLon(d.longitude, false) +
        "</span></div>" +
        '<div class="popup-row"><span>Altitude</span><span>' +
          d.altitude.toFixed(1) + " km</span></div>" +
        '<div class="popup-row"><span>Velocity</span><span>' +
          Math.round(d.velocity).toLocaleString("en-US") + " km/h</span></div>"
      );

      /* Telemetry readouts above the map. */
      document.getElementById("tms-lat").textContent =
        formatLatLon(d.latitude, true);
      document.getElementById("tms-lon").textContent =
        formatLatLon(d.longitude, false);
      document.getElementById("tms-alt").textContent =
        d.altitude.toFixed(1) + " km";
      document.getElementById("tms-vel").textContent =
        Math.round(d.velocity).toLocaleString("en-US") + " km/h";
      document.getElementById("tms-vis").textContent =
        d.visibility === "daylight" ? "☀ DAYLIGHT" : "◐ EARTH SHADOW";
      document.getElementById("tms-fixes").textContent = fixCount;
      document.getElementById("iss-updated").textContent =
        nowUTC() + " UTC";

      /* Camera behaviour: first fix zooms in; afterwards we only pan
         when the "keep camera locked" switch is on. */
      if (firstFix) {
        map.setView(latlng, 3);
        firstFix = false;
      } else if (followISS) {
        map.panTo(latlng, { animate: true });
      }

      setPill(pill, "online", "TRACKING · FIX #" + fixCount);
    } catch (err) {
      /* A missed fix is NOT fatal: setInterval keeps firing, so the next
         tick retries automatically. We just flag the momentary signal loss. */
      setPill(pill, "error", "SIGNAL LOST");
      console.error("[TerraLive] ISS poll failed:", err);
    } finally {
      inFlight = false;
    }
  }

  /* Bind an (initially empty) popup so setPopupContent has a target. */
  issMarker.bindPopup("");

  document.getElementById("iss-refresh").addEventListener("click", pollISS);

  /* ---- 7d. THE spec requirement: refresh every 5 seconds ----
     VIVA NOTE — setInterval vs a loop:
     setInterval schedules pollISS to be called every 5000 ms WITHOUT
     blocking anything (it just queues a callback on the event loop).
     We must NOT write `while(true){ await fetch(...) }` here — that
     would freeze the page. Also note each pollISS call is itself
     async, so the timer can fire while a request is mid-flight; the
     inFlight guard at the top of the function handles that. */
  pollISS();                                  // first fix right away
  setInterval(pollISS, CONFIG.ISS_POLL_MS);   // then every 5 seconds
}

/* =====================================================================
   8. APP ROUTER — run only what the current page needs
   ---------------------------------------------------------------------
   VIVA NOTE — DOMContentLoaded:
   The event fires when the whole HTML has been parsed. Listening for it
   (instead of running immediately) guarantees that every getElementById
   call below finds its element, even if this script is ever moved into
   the <head> without a defer attribute.
===================================================================== */
document.addEventListener("DOMContentLoaded", () => {
  initCommon();   // hamburger menu etc. — every page needs this

  // document.body.dataset.page reads the data-page attribute,
  // e.g. <body data-page="seismic">  ->  "seismic"
  const page = document.body.dataset.page;

  switch (page) {
    case "home":
      initHomePage();
      break;
    case "seismic":
      initSeismicPage();
      break;
    case "atmospheric":
      initAtmosphericPage();
      break;
    case "orbital":
      initOrbitalPage();
      break;
    case "about":
      // fully static page — only initCommon() runs
      break;
    default:
      console.warn("[TerraLive] Unknown data-page value:", page);
  }
});
