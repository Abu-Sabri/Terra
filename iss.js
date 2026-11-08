/* =========================================================
   iss.js — the orbital page.

   The API gives us ONE position per request, so the page
   polls it every five seconds:

     setInterval(fetchISS, 5000)

   Each answer moves the marker, grows the trail and updates
   the numbers at the top.
   ========================================================= */

const POLL_INTERVAL = 5000;   // milliseconds
const TRAIL_LENGTH = 20;      // how many past positions to remember

let map = null;
let marker = null;
let trail = null;
let footprint = null;

let pastPositions = [];       // [[lat, lon], …] oldest first
let fixCount = 0;
let followStation = true;


/* ---------- 1. BUILD THE MAP ----------------------------
   The station's own icon is a small <div> styled in CSS,
   which is easier than drawing a picture for it. */
function buildMap() {
  map = createMap("iss-map", [0, 0], 2);
  if (!map) return;                       // Leaflet is missing

  // The dashed line behind the station.
  trail = L.polyline([], {
    color: "#E9B44C",
    weight: 3,
    opacity: 0.9,
    dashArray: "6 8"
  }).addTo(map);

  // The circle showing how much of the Earth is in view.
  footprint = L.circle([0, 0], {
    radius: 2250000,                      // metres
    color: "#E9B44C",
    weight: 2,
    opacity: 0.8,
    fillColor: "#E9B44C",
    fillOpacity: 0.06,
    dashArray: "3 8"
  }).addTo(map);

  const stationIcon = L.divIcon({
    className: "",                         // no default Leaflet styling
    html: '<div class="iss-marker"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]                     // the centre of the dot
  });

  marker = L.marker([0, 0], { icon: stationIcon }).addTo(map);
}


/* ---------- 2. ASK FOR A NEW POSITION ------------------- */
async function fetchISS() {
  const pill = $("iss-pill");

  try {
    const data = await fetchJSON(API.iss);

    updateReadouts(data);
    moveStation(data);

    fixCount += 1;
    $("iss-fixes").textContent = fixCount;
    $("iss-updated").textContent = new Date().toLocaleTimeString();

    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    setPill(pill, "error", "no contact");
  }
}


/* ---------- 3. THE NUMBERS AT THE TOP ------------------- */
function updateReadouts(data) {
  $("iss-lat").textContent = formatLatLon(data.latitude, true);
  $("iss-lon").textContent = formatLatLon(data.longitude, false);
  $("iss-alt").textContent = Math.round(data.altitude) + " km";
  $("iss-speed").textContent = Math.round(data.velocity).toLocaleString("en-GB") + " km/h";
  $("iss-light").textContent = data.visibility === "daylight" ? "Daylight" : "Eclipse";
}


/* ---------- 4. MOVE EVERYTHING ON THE MAP --------------- */
function moveStation(data) {
  if (!map) return;

  const position = [data.latitude, data.longitude];

  /* The map shows longitude from -180 to 180. When the station
     crosses that line the trail would jump right across the
     world, so we start a new trail instead. */
  if (pastPositions.length > 0) {
    const last = pastPositions[pastPositions.length - 1];
    if (Math.abs(last[1] - position[1]) > 180) pastPositions = [];
  }

  // Remember this position, but never more than TRAIL_LENGTH.
  pastPositions.push(position);
  if (pastPositions.length > TRAIL_LENGTH) pastPositions.shift();

  trail.setLatLngs(pastPositions);
  marker.setLatLng(position);
  marker.bindPopup(
    '<div class="popup-title">International Space Station</div>' +
    '<div class="popup-line">Altitude <b>' + Math.round(data.altitude) + ' km</b></div>' +
    '<div class="popup-line">Speed <b>' + Math.round(data.velocity).toLocaleString("en-GB") + ' km/h</b></div>'
  );

  footprint.setLatLng(position);
  footprint.setRadius(data.footprint * 1000 / 2);   // the API gives a diameter

  // Only move the camera if the visitor left the box ticked,
  // otherwise the map would fight them while they explore.
  if (followStation) {
    map.panTo(position, { animate: true, duration: 0.6 });
  } else if (fixCount === 0) {
    map.setView(position, 3);
  }
}


/* ---------- 5. START ------------------------------------ */
buildMap();
fetchISS();

// A new position every five seconds.
setInterval(fetchISS, POLL_INTERVAL);

$("refresh-button").addEventListener("click", fetchISS);

$("follow").addEventListener("change", function (event) {
  followStation = event.target.checked;
  // Jump straight to the station when the visitor re-ticks the box.
  if (followStation && pastPositions.length > 0) {
    map.setView(pastPositions[pastPositions.length - 1], 3);
  }
});
