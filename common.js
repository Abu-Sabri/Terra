/* =========================================================
   common.js — helpers used by more than one page.
   Loaded first, on every page:

     <script src="common.js"></script>
     <script src="seismic.js"></script>

   Nothing here runs by itself except the mobile menu.
   ========================================================= */


/* ---------- 1. THE API ADDRESSES -------------------------
   Every web address the project talks to, in one place. */
const API = {
  // USGS — every earthquake recorded in the last 24 hours
  quakes: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  // USGS — only events of magnitude 2.5+, used by the home page
  quakesStrong: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",

  // Open-Meteo — weather + air quality (free, no key needed)
  weather(lat, lon) {
    return "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" + lat + "&longitude=" + lon +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day," +
      "precipitation,weather_code,cloud_cover,pressure_msl,uv_index," +
      "wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
      "&hourly=temperature_2m,is_day" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset" +
      "&forecast_days=7&timezone=auto";
  },

  air(lat, lon) {
    return "https://air-quality-api.open-meteo.com/v1/air-quality" +
      "?latitude=" + lat + "&longitude=" + lon +
      "&current=us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide" +
      "&timezone=auto";
  },

  // Where the ISS at? — one position per request
  iss: "https://api.wheretheiss.at/v1/satellites/25544"
};

/* The map background, shared by the seismic and orbital pages.
   "lyrs=y" is Google's hybrid layer: imagery + place names. */
const BASEMAP = {
  url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
  attribution: "Imagery © Google"
};


/* ---------- 2. SMALL HELPERS ---------------------------- */

/* Shortcut for document.getElementById. */
function $(id) {
  return document.getElementById(id);
}

/* Fetch a URL and return the JSON. Throws if the request fails,
   so the caller's try/catch can show an error message. */
async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Request failed: " + response.status);
  }
  return response.json();
}

/* Turn a status pill on or off.
   state = "loading" | "live" | "error" */
function setPill(element, state, text) {
  element.className = "pill is-" + state;
  element.textContent = text;
}

/* Make text safe before putting it in innerHTML.
   (Earthquake place names, for example, come from the internet.) */
function escapeHTML(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* "just now", "12 min ago", "3 h ago" — from a millisecond timestamp. */
function timeAgo(timestamp) {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min ago";
  const hours = Math.round(minutes / 60);
  return hours + " h ago";
}

/* Two digits: 9 becomes "09". */
function pad(number) {
  return String(number).padStart(2, "0");
}

/* 14:07:02 from a Date object. */
function hhmmss(date) {
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

/* 14:07 from a Date object or an ISO string. */
function hhmm(value) {
  const date = new Date(value);
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
}

/* 26.22 becomes "26.2° N", -46.63 becomes "46.6° S". */
function formatLatLon(value, isLatitude) {
  const direction = isLatitude
    ? (value >= 0 ? "N" : "S")
    : (value >= 0 ? "E" : "W");
  return Math.abs(value).toFixed(1) + "° " + direction;
}

/* A number with thousands separators: 1234 becomes "1,234". */
function number(value) {
  return value.toLocaleString("en-GB");
}


/* ---------- 3. WEATHER CODES ----------------------------
   Open-Meteo reports the weather as a number (the "WMO code").
   This table turns the number into words, and into an icon name. */
function describeWeather(code) {
  if (code === 0)                return { label: "Clear sky",            icon: "sun" };
  if (code === 1)                return { label: "Mainly clear",         icon: "sun" };
  if (code === 2)                return { label: "Partly cloudy",         icon: "partly" };
  if (code === 3)                return { label: "Overcast",              icon: "cloud" };
  if (code === 45 || code === 48) return { label: "Fog",                  icon: "fog" };
  if (code >= 51 && code <= 57)  return { label: "Drizzle",               icon: "rain" };
  if (code >= 61 && code <= 67)  return { label: "Rain",                  icon: "rain" };
  if (code >= 71 && code <= 77)  return { label: "Snow",                  icon: "snow" };
  if (code >= 80 && code <= 82)  return { label: "Rain showers",          icon: "rain" };
  if (code >= 85 && code <= 86)  return { label: "Snow showers",          icon: "snow" };
  if (code >= 95)                return { label: "Thunderstorm",          icon: "storm" };
  return { label: "Unknown", icon: "cloud" };
}

/* Draw a weather icon as SVG and return it as a string.
   Every shape is drawn with lines, so it stays sharp at any size. */
function weatherIcon(code, isDay = true) {
  let kind = describeWeather(code).icon;

  // A clear sky looks different at night — show a moon instead.
  if (kind === "sun" && !isDay) kind = "moon";
  if (kind === "partly" && !isDay) kind = "moon";

  const cloud = '<path d="M17.5 9.5h-1.1A7 7 0 1 0 9 18.5h8.5a4.5 4.5 0 0 0 0-9z"/>';
  const shapes = {
    sun: '<circle cx="12" cy="12" r="4.5"/>' +
         '<path d="M12 1.8v2.4M12 19.8v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7' +
         'M1.8 12h2.4M19.8 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7"/>',
    moon: '<path d="M20.5 13.3A8.6 8.6 0 1 1 10.7 3.5a6.8 6.8 0 0 0 9.8 9.8z"/>',
    partly: '<circle cx="8" cy="8" r="3.2"/>' +
            '<path d="M8 2.4v1.6M2.4 8H4M4 4l1.1 1.1"/>' +
            '<path d="M18.5 11.5h-1.1A6 6 0 1 0 11 19.5h7.5a4 4 0 0 0 0-8z"/>',
    cloud: cloud,
    rain: cloud + '<path d="M9 20.2l-.7 2M13 20.2l-.7 2M17 20.2l-.7 2"/>',
    snow: cloud + '<circle cx="9" cy="20.6" r="1" fill="currentColor" stroke="none"/>' +
                  '<circle cx="13" cy="20.6" r="1" fill="currentColor" stroke="none"/>' +
                  '<circle cx="17" cy="20.6" r="1" fill="currentColor" stroke="none"/>',
    storm: cloud + '<path d="M12.6 18.6l-2.8 4.6h3.6l-1.2 3.4"/>',
    fog: '<path d="M4 9.5h13M6.5 13.5h11M4 17.5h9"/>'
  };

  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' + shapes[kind] + "</svg>";
}


/* ---------- 4. THE MAP ----------------------------------
   Two pages draw a map. Both want the same dark basemap,
   so the setup lives here once.

   If Leaflet did not load (no internet), we write a message
   into the box instead of leaving it empty. */
function createMap(elementId, center, zoom) {
  const container = $(elementId);
  if (!container) return null;

  if (typeof L === "undefined") {
    container.innerHTML =
      '<div class="map-fallback"><strong>Map unavailable</strong>' +
      "<span>Leaflet is loaded from a CDN, so the map needs an internet connection. " +
      "The numbers and lists on this page still work.</span></div>";
    return null;
  }

  const map = L.map(container, {
    center: center,
    zoom: zoom,
    minZoom: 2,
    worldCopyJump: true,
    zoomControl: true
  });

  // The map background: Google's "hybrid" layer — satellite
  // imagery with place names painted on top. Leaflet fills in
  // {x}, {y} and {z} for every tile it needs.
  L.tileLayer(BASEMAP.url, {
    attribution: BASEMAP.attribution,
    maxZoom: 20
  }).addTo(map);

  return map;
}


/* ---------- 5. THE MOBILE MENU --------------------------
   On small screens the nav is hidden behind a hamburger,
   so bind one click to open and close it. */
function initMenu() {
  const toggle = $("nav-toggle");
  const links = $("nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", function () {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

document.addEventListener("DOMContentLoaded", initMenu);
