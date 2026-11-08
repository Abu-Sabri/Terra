/* =========================================================
   weather.js — the weather page.

   One city is shown at a time. When the city changes we ask
   Open-Meteo for two things at once:

     1. the forecast   (current + hourly + daily)
     2. the air quality

   …then hand each answer to a small "show…" function that
   writes it into the page.
   ========================================================= */

let currentCity = CITIES[0];   // Manama, from cities.js


/* ---------- 1. SMALL CONVERSIONS ------------------------ */

/* 69° of wind becomes "ENE". */
function compassDirection(degrees) {
  const points = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return points[Math.round(degrees / 22.5) % 16];
}

/* Sunrise and sunset times in → "13 h 12 m" out. */
function dayLength(sunrise, sunset) {
  const minutes = Math.round((new Date(sunset) - new Date(sunrise)) / 60000);
  return Math.floor(minutes / 60) + " h " + (minutes % 60) + " m";
}

/* The official US AQI bands, with the usual health advice. */
function aqiGrade(aqi) {
  if (aqi <= 50)  return { label: "Good", color: "#4CAF7D",
    advice: "Air quality is fine — enjoy being outside." };
  if (aqi <= 100) return { label: "Moderate", color: "#E6C055",
    advice: "Acceptable, though very sensitive people may notice it." };
  if (aqi <= 150) return { label: "Unhealthy for sensitive groups", color: "#E58E52",
    advice: "Children, older people and anyone with asthma should take it easy." };
  if (aqi <= 200) return { label: "Unhealthy", color: "#D3574E",
    advice: "Everyone may feel effects. Limit time spent outdoors." };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#9B4A7A",
    advice: "Health alert — avoid outdoor exertion." };
  return { label: "Hazardous", color: "#8B3A3A",
    advice: "Emergency conditions. Stay indoors." };
}


/* ---------- 2. THE CITY PICKER --------------------------
   The <datalist> gets one <option> per city, and the browser
   turns that into a searchable drop-down for us. */
function fillCityList() {
  $("city-options").innerHTML = CITIES.map(function (city) {
    return '<option value="' + escapeHTML(city.name) + '"></option>';
  }).join("");

  $("city-search").value = currentCity.name;
}

/* The visitor picked or typed a city name. */
function onCityPicked() {
  const query = $("city-search").value.trim().toLowerCase();

  // Exact name first, then "starts with", then "contains".
  const found =
    CITIES.find(function (city) { return city.name.toLowerCase() === query; }) ||
    CITIES.find(function (city) { return city.name.toLowerCase().startsWith(query); }) ||
    CITIES.find(function (city) { return city.name.toLowerCase().includes(query); });

  if (!found) {
    $("city-search").value = currentCity.name;   // no match — put it back
    return;
  }

  $("city-search").value = found.name;
  if (found.name !== currentCity.name) {
    currentCity = found;
    loadWeather();
  }
}


/* ---------- 3. FETCH BOTH FEEDS ------------------------- */
async function loadWeather() {
  const pill = $("weather-pill");
  setPill(pill, "loading", "loading");
  $("weather-banner").hidden = true;

  try {
    // Promise.all waits for both requests but runs them side by side.
    const [weather, air] = await Promise.all([
      fetchJSON(API.weather(currentCity.latitude, currentCity.longitude)),
      fetchJSON(API.air(currentCity.latitude, currentCity.longitude))
    ]);

    showCurrent(weather);
    showDetails(weather);
    showChart(weather);
    showWeek(weather);
    showAir(air);

    $("weather-updated").textContent = new Date().toLocaleTimeString();
    setPill(pill, "live", "live");
  } catch (error) {
    console.error(error);
    setPill(pill, "error", "offline");
    $("weather-banner").hidden = false;
  }
}


/* ---------- 4. CURRENT CONDITIONS ----------------------- */
function showCurrent(weather) {
  const now = weather.current;
  const sky = describeWeather(now.weather_code);

  $("temperature").textContent = Math.round(now.temperature_2m);
  $("sky").textContent = sky.label + (now.is_day === 1 ? " · daytime" : " · night");
  $("feels-like").textContent = "feels like " + Math.round(now.apparent_temperature) + "°C";
  $("weather-icon").innerHTML = weatherIcon(now.weather_code, now.is_day === 1);

  $("place").textContent = currentCity.name;
  // "Manama, Bahrain" → the second part is the country.
  $("place-note").textContent = currentCity.name.split(",")[1]
    ? currentCity.name.split(",")[1].trim()
    : "";
  $("observed-at").textContent = "observed " + hhmm(now.time);

  // Sun times for today are the first entry of the daily arrays.
  const daily = weather.daily;
  $("sunrise").textContent = hhmm(daily.sunrise[0]);
  $("sunset").textContent = hhmm(daily.sunset[0]);
  $("daylight").textContent = dayLength(daily.sunrise[0], daily.sunset[0]);
}


/* ---------- 5. THE EIGHT MEASUREMENTS ------------------- */
function showDetails(weather) {
  const now = weather.current;

  $("humidity").textContent = Math.round(now.relative_humidity_2m) + " %";
  $("wind").textContent = Math.round(now.wind_speed_10m) + " km/h";
  $("gusts").textContent = Math.round(now.wind_gusts_10m) + " km/h";
  $("wind-direction").textContent =
    compassDirection(now.wind_direction_10m) + " " + Math.round(now.wind_direction_10m) + "°";
  $("pressure").textContent = Math.round(now.pressure_msl) + " hPa";
  $("clouds").textContent = Math.round(now.cloud_cover) + " %";
  $("rain").textContent = now.precipitation.toFixed(1) + " mm";
  $("uv").textContent = Math.round(now.uv_index);
}


/* ---------- 6. THE 24-HOUR CHART ------------------------
   The API gives 7 days of hours. We find the hour we are in
   and take the next 24 values from there. Each bar's height
   is its temperature between the day's low and high. */
function showChart(weather) {
  const hourly = weather.hourly;

  let start = hourly.time.indexOf(weather.current.time);
  if (start < 0) start = 0;

  const times = hourly.time.slice(start, start + 24);
  const temps = hourly.temperature_2m.slice(start, start + 24);
  const isDay = hourly.is_day.slice(start, start + 24);

  const low = Math.min.apply(null, temps);
  const high = Math.max.apply(null, temps);
  const range = Math.max(1, high - low);

  $("temp-chart").innerHTML = temps.map(function (temperature, i) {
    // 12% tall for the coldest hour, 100% for the warmest.
    const height = 12 + ((temperature - low) / range) * 88;
    // Label every sixth hour so the labels never collide.
    const hourLabel = i % 6 === 0 ? times[i].slice(11, 13) + ":00" : "";

    return '<div class="temp-col" title="' + hourLabel + " · " + temperature.toFixed(1) + '°C">' +
      '<div class="temp-bar ' + (isDay[i] === 1 ? "" : "night") + '" style="height:' + height.toFixed(1) + '%"></div>' +
      '<div class="temp-hour">' + hourLabel + "</div>" +
    "</div>";
  }).join("");

  $("chart-low").textContent = "low " + Math.round(low) + "°C";
  $("chart-high").textContent = "high " + Math.round(high) + "°C · bars in blue are night hours";
}


/* ---------- 7. THE SEVEN-DAY STRIP ---------------------- */
function showWeek(weather) {
  const daily = weather.daily;
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  $("daily-strip").innerHTML = daily.time.map(function (date, i) {
    const day = new Date(date + "T12:00:00");     // noon avoids time-zone slips
    const name = i === 0 ? "Today" : weekdays[day.getDay()];

    return '<div class="day-card">' +
      '<div class="day-name">' + name + "</div>" +
      '<div class="day-icon">' + weatherIcon(daily.weather_code[i]) + "</div>" +
      '<div class="day-max">' + Math.round(daily.temperature_2m_max[i]) + "°</div>" +
      '<div class="day-min">' + Math.round(daily.temperature_2m_min[i]) + "°</div>" +
    "</div>";
  }).join("");
}


/* ---------- 8. AIR QUALITY ------------------------------ */
function showAir(air) {
  const aqi = air.current.us_aqi;

  if (aqi === null || aqi === undefined) {
    $("aqi-category").textContent = "no reading for this city";
    return;
  }

  const grade = aqiGrade(aqi);

  $("aqi").textContent = Math.round(aqi);
  $("aqi").style.color = grade.color;
  $("aqi-category").textContent = grade.label;
  $("aqi-category").style.color = grade.color;
  $("aqi-advice").textContent = grade.advice;

  // Put the marker where this reading sits on the 0–500 scale.
  $("aqi-scale").hidden = false;
  $("aqi-marker").style.left = Math.min(aqi / 500, 1) * 100 + "%";

  // One bar per pollutant. Each bar is scaled to its own
  // maximum for readability (not an official limit).
  const pollutants = [
    { key: "pm2_5", label: "PM2.5", max: 100 },
    { key: "pm10", label: "PM10", max: 200 },
    { key: "ozone", label: "O₃", max: 200 },
    { key: "nitrogen_dioxide", label: "NO₂", max: 200 },
    { key: "sulphur_dioxide", label: "SO₂", max: 300 },
    { key: "carbon_monoxide", label: "CO", max: 8000 }
  ];

  $("pollutants").innerHTML = pollutants.map(function (item) {
    const value = air.current[item.key] || 0;
    const percent = Math.min(value / item.max, 1) * 100;

    return '<div class="pollutant">' +
      '<span class="pollutant-name">' + item.label + "</span>" +
      '<span class="pollutant-track">' +
        '<span class="pollutant-fill" style="width:' + percent.toFixed(1) + '%"></span>' +
      "</span>" +
      '<span class="pollutant-value">' + Math.round(value) + "</span>" +
    "</div>";
  }).join("");
}


/* ---------- 9. START ------------------------------------ */
fillCityList();
loadWeather();

$("city-search").addEventListener("change", onCityPicked);
$("city-search").addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    event.preventDefault();
    onCityPicked();
  }
});
$("refresh-button").addEventListener("click", loadWeather);
