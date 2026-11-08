/* =========================================================
   seismic.js — the seismic page.

   The whole page runs on one list of earthquakes:

     quakes  = the raw events from the USGS feed

   From that list we draw three things:

     the map     one circle per event
     the log     one row per event
     the chart   a count per hour

   Filtering and sorting never change `quakes`; they only
   decide what gets drawn. That is why "Refresh" and the
   buttons can't lose the original data.
   ========================================================= */

let quakes = [];          // every event from the feed
let minMagnitude = -99;   // current filter (-99 = show everything)
let sortOrder = "newest"; // "newest" or "strongest"
let map = null;           // the Leaflet map
let markerLayer = null;   // a bucket we can empty and refill


/* ---------- 1. COLOUR AND SIZE BY MAGNITUDE ------------- */
function magnitudeColor(magnitude) {
  if (magnitude >= 6) return "#E2795F";    // severe
  if (magnitude >= 4.5) return "#E58E52";  // strong
  if (magnitude >= 2.5) return "#E9B44C";  // light
  return "#7FB3D5";                        // micro
}

function magnitudeRadius(magnitude) {
  // Bigger magnitude → bigger circle, but never smaller than 3 px.
  return Math.min(30, Math.max(3, 2 + magnitude * 2.2));
}


/* ---------- 2. LOAD THE FEED ---------------------------- */
async function loadQuakes() {
  const pill = $("quake-pill");
  setPill(pill, "loading", "syncing");

  try {
    const data = await fetchJSON(API.quakes);

    // Keep only events that actually have a magnitude.
    quakes = data.features.filter(function (quake) {
      return quake.properties.mag !== null;
    });

    updateStats();
    drawMap();
    drawLog();
    drawHourChart();

    $("quake-updated").textContent = new Date().toLocaleTimeString();
    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    setPill(pill, "error", "offline");
    $("quake-count").textContent = "Could not reach the USGS feed — is the connection up?";
  }
}


/* ---------- 3. THE FOUR STATS ---------------------------
   These describe the whole day, so they ignore the filter. */
function updateStats() {
  $("stat-total").textContent = number(quakes.length);

  if (quakes.length === 0) return;

  let strongest = quakes[0];
  let newest = quakes[0];

  for (const quake of quakes) {
    if (quake.properties.mag > strongest.properties.mag) strongest = quake;
    if (quake.properties.time > newest.properties.time) newest = quake;
  }

  $("stat-strongest").textContent = "M " + strongest.properties.mag.toFixed(1);
  $("stat-strongest-place").textContent = strongest.properties.place || "unknown place";
  $("stat-recent").textContent = timeAgo(newest.properties.time);
}


/* ---------- 4. WHICH EVENTS PASS THE FILTER? ------------ */
function visibleQuakes() {
  // .filter() keeps the events we want…
  const list = quakes.filter(function (quake) {
    return quake.properties.mag >= minMagnitude;
  });

  // …then .sort() puts them in order.
  list.sort(function (a, b) {
    if (sortOrder === "strongest") {
      return b.properties.mag - a.properties.mag;
    }
    return b.properties.time - a.properties.time;   // newest first
  });

  return list;
}


/* ---------- 5. THE MAP ---------------------------------- */
function drawMap() {
  // Build the map once; after that we only refill the markers.
  if (!map) {
    map = createMap("quake-map", [20, 10], 2);
    if (!map) return;                      // Leaflet did not load
    markerLayer = L.layerGroup().addTo(map);
  }

  markerLayer.clearLayers();

  for (const quake of visibleQuakes()) {
    const [longitude, latitude, depth] = quake.geometry.coordinates;
    const magnitude = quake.properties.mag;

    L.circleMarker([latitude, longitude], {
      radius: magnitudeRadius(magnitude),
      color: magnitudeColor(magnitude),
      weight: 2,
      fillColor: magnitudeColor(magnitude),
      fillOpacity: 0.6
    })
      .bindPopup(popupHTML(quake, depth))
      .addTo(markerLayer);
  }
}

/* The little box that opens when a circle is clicked. */
function popupHTML(quake, depth) {
  const properties = quake.properties;
  const time = new Date(properties.time).toISOString().slice(11, 16);

  return (
    '<div class="popup-title" style="color:' + magnitudeColor(properties.mag) + '">' +
      "M " + properties.mag.toFixed(1) +
    "</div>" +
    '<div class="popup-place">' + escapeHTML(properties.place || "Unknown place") + "</div>" +
    '<div class="popup-line">Depth <b>' + depth.toFixed(0) + " km</b></div>" +
    '<div class="popup-line">' + time + " UTC · " + timeAgo(properties.time) + "</div>" +
    '<div class="popup-line"><a href="' + properties.url +
      '" target="_blank" rel="noopener">USGS event page →</a></div>'
  );
}


/* ---------- 6. THE EVENT LOG ----------------------------
   One <button> per event. Clicking a row flies the map to it. */
function drawLog() {
  const list = visibleQuakes();
  const rows = list.map(function (quake) {
    const [longitude, latitude] = quake.geometry.coordinates;
    const magnitude = quake.properties.mag;

    return (
      '<li>' +
        '<button class="quake-row" data-lat="' + latitude + '" data-lon="' + longitude + '">' +
          '<span class="quake-mag" style="color:' + magnitudeColor(magnitude) + '">M ' +
            magnitude.toFixed(1) + "</span>" +
          '<span class="quake-place">' + escapeHTML(quake.properties.place || "Unknown place") + "</span>" +
          '<span class="quake-age">' + timeAgo(quake.properties.time) + "</span>" +
        "</button>" +
      "</li>"
    );
  });

  $("quake-list").innerHTML = rows.join("") ||
    '<li class="log-foot">No events match this filter.</li>';

  $("quake-count").textContent =
    list.length + " of " + quakes.length + " events shown";
}

/* Clicking anywhere in the list: find out which row was clicked.
   (One listener on the list is cheaper than 250 listeners.) */
$("quake-list").addEventListener("click", function (event) {
  const row = event.target.closest(".quake-row");
  if (!row || !map) return;

  const position = [Number(row.dataset.lat), Number(row.dataset.lon)];
  map.flyTo(position, 5, { duration: 0.8 });
});


/* ---------- 7. EVENTS PER HOUR --------------------------
   Count how many events fall into each of the last 24 hours. */
function drawHourChart() {
  const now = Date.now();
  const counts = new Array(24).fill(0);

  for (const quake of quakes) {
    const hoursAgo = Math.floor((now - quake.properties.time) / 3600000);
    if (hoursAgo >= 0 && hoursAgo < 24) {
      counts[23 - hoursAgo] += 1;          // newest hour on the right
    }
  }

  const highest = Math.max.apply(null, counts.concat([1]));

  $("hour-chart").innerHTML = counts.map(function (count) {
    const height = (count / highest) * 100;
    return '<div class="hour-bar" style="height:' + height.toFixed(1) +
      '%" title="' + count + ' events"></div>';
  }).join("");

  $("chart-total").textContent = number(quakes.length) + " events";
}


/* ---------- 8. THE BUTTONS ------------------------------
   One listener per group; the clicked chip says what it means. */
function initButtons() {
  $("magnitude-filters").addEventListener("click", function (event) {
    const chip = event.target.closest(".chip");
    if (!chip) return;

    minMagnitude = Number(chip.dataset.minMag);

    // Move the "active" ring to the chip that was clicked.
    document.querySelectorAll("#magnitude-filters .chip").forEach(function (button) {
      button.classList.toggle("active", button === chip);
    });

    drawMap();
    drawLog();
  });

  $("sort-filters").addEventListener("click", function (event) {
    const chip = event.target.closest(".chip");
    if (!chip) return;

    sortOrder = chip.dataset.sort;
    document.querySelectorAll("#sort-filters .chip").forEach(function (button) {
      button.classList.toggle("active", button === chip);
    });

    drawLog();
  });

  $("refresh-button").addEventListener("click", loadQuakes);
}


/* ---------- 9. START ------------------------------------
   Load now, then again every five minutes in the background. */
loadQuakes();
initButtons();
setInterval(loadQuakes, 5 * 60 * 1000);
