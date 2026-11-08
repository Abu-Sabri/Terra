/* =========================================================
   home.js — the home page.

   Three jobs, each in its own function:

     startClock()      a clock, updated once a second
     loadEarthquakes() the count and strongest event of the day
     loadWeather()     today's weather for the default city
     loadISS()         where the space station is right now

   Each loader is "fetch the JSON, then write the values".
   ========================================================= */


/* ---------- 1. THE CLOCK --------------------------------
   setInterval() runs the same function every 1000 ms. */
function startClock() {
  function tick() {
    const now = new Date();

    // UTC is the same everywhere on Earth — good for comparing data.
    $("clock-utc").textContent = now.toISOString().slice(11, 19);
    $("clock-local").textContent = hhmmss(now);
    $("clock-date").textContent = now.toDateString().slice(4);   // "Fri Oct 23 2026" → "Oct 23 2026"
  }

  tick();                  // draw immediately, don't wait a second
  setInterval(tick, 1000);
}


/* ---------- 2. EARTHQUAKES ------------------------------
   The home page asks for the smaller "M2.5+" feed so it stays
   quick; the seismic page uses the full feed. */
async function loadEarthquakes() {
  const pill = $("pill-quakes");

  try {
    const data = await fetchJSON(API.quakesStrong);
    const quakes = data.features;

    // How many earthquakes? The array length is the answer.
    $("home-quakes").textContent = number(quakes.length);
    $("home-quakes-note").textContent = "events of M2.5+ in the last 24 hours";

    // The strongest one: compare magnitudes one by one.
    let strongest = quakes[0];
    for (const quake of quakes) {
      if (quake.properties.mag > strongest.properties.mag) strongest = quake;
    }

    const place = strongest.properties.place || "Unknown place";
    $("callout-mag").textContent = "M " + strongest.properties.mag.toFixed(1);
    $("callout-place").textContent = place;
    $("callout-meta").textContent =
      timeAgo(strongest.properties.time) + " · depth " +
      strongest.geometry.coordinates[2].toFixed(0) + " km";
    $("home-callout").hidden = false;

    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    $("home-quakes-note").textContent = "feed unavailable — check your connection";
    setPill(pill, "error", "offline");
  }
}


/* ---------- 3. WEATHER ----------------------------------
   CITIES[0] is Manama. Change the order of cities.js to
   make a different city the home station. */
async function loadWeather() {
  const pill = $("pill-weather");
  const city = CITIES[0];

  try {
    const data = await fetchJSON(API.weather(city.latitude, city.longitude));
    const now = data.current;
    const sky = describeWeather(now.weather_code);

    $("home-weather").textContent = Math.round(now.temperature_2m) + "°C";
    $("home-weather-note").textContent =
      city.name.split(",")[0] + " · " + sky.label;

    // Replace the placeholder sun with the icon that matches the sky.
    $("home-weather-icon").innerHTML = weatherIcon(now.weather_code, now.is_day === 1);

    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    $("home-weather-note").textContent = "Open-Meteo unavailable";
    setPill(pill, "error", "offline");
  }
}


/* ---------- 4. THE SPACE STATION ------------------------ */
async function loadISS() {
  const pill = $("pill-iss");

  try {
    const data = await fetchJSON(API.iss);

    $("home-iss").textContent =
      formatLatLon(data.latitude, true) + "  " + formatLatLon(data.longitude, false);
    $("home-iss-note").textContent =
      Math.round(data.altitude) + " km up · " +
      Math.round(data.velocity).toLocaleString("en-GB") + " km/h";

    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    $("home-iss-note").textContent = "no contact — check your connection";
    setPill(pill, "error", "offline");
  }
}


/* ---------- 5. START ------------------------------------
   The three loaders run at the same time: we do not wait for
   the first one before starting the second. */
startClock();
loadEarthquakes();
loadWeather();
loadISS();
