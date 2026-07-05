(() => {
  "use strict";

  const DEFAULT_LOCALITY_ID = 4864;
  const CATALOG_URL = "./data/localidades.min.json";
  const COL = Object.freeze({
    id: 0,
    lat: 10,
    lon: 11,
  });

  const state = {
    coordinates: new Map([
      [DEFAULT_LOCALITY_ID, { lat: -34.6037, lon: -58.3816 }],
    ]),
    catalogLoaded: false,
    updatingIcon: false,
  };

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-AR")
      .trim();
  }

  function currentLocalityId() {
    const id = Number(new URL(window.location.href).searchParams.get("id"));
    return Number.isFinite(id) ? id : DEFAULT_LOCALITY_ID;
  }

  function dayOfYearUtc(date) {
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const current = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    return Math.floor((current - start) / 86400000);
  }

  function solarElevationDegrees(lat, lon, date = new Date()) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 90;

    const radians = Math.PI / 180;
    const day = dayOfYearUtc(date);
    const utcMinutes =
      date.getUTCHours() * 60 +
      date.getUTCMinutes() +
      date.getUTCSeconds() / 60;

    const gamma =
      (2 * Math.PI / 365) *
      (day - 1 + (utcMinutes / 60 - 12) / 24);

    const equationOfTime =
      229.18 *
      (
        0.000075 +
        0.001868 * Math.cos(gamma) -
        0.032077 * Math.sin(gamma) -
        0.014615 * Math.cos(2 * gamma) -
        0.040849 * Math.sin(2 * gamma)
      );

    const declination =
      0.006918 -
      0.399912 * Math.cos(gamma) +
      0.070257 * Math.sin(gamma) -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma);

    let trueSolarMinutes = utcMinutes + equationOfTime + 4 * lon;
    trueSolarMinutes = ((trueSolarMinutes % 1440) + 1440) % 1440;

    let hourAngle = trueSolarMinutes / 4 - 180;
    if (hourAngle < -180) hourAngle += 360;

    const latitudeRadians = lat * radians;
    const hourAngleRadians = hourAngle * radians;

    const cosineZenith =
      Math.sin(latitudeRadians) * Math.sin(declination) +
      Math.cos(latitudeRadians) *
        Math.cos(declination) *
        Math.cos(hourAngleRadians);

    const boundedCosine = Math.max(-1, Math.min(1, cosineZenith));
    return 90 - Math.acos(boundedCosine) / radians;
  }

  function isNightAtSelectedLocality() {
    const id = currentLocalityId();
    const coordinates =
      state.coordinates.get(id) ||
      state.coordinates.get(DEFAULT_LOCALITY_ID);

    return (
      solarElevationDegrees(
        coordinates.lat,
        coordinates.lon,
        new Date(),
      ) < -0.833
    );
  }

  function weatherCategory(description) {
    const text = normalizeText(description);

    if (/torment|electr|trueno/.test(text)) return "storm";
    if (/nieve|nevad|aguanieve/.test(text)) return "snow";
    if (/lluv|chaparr|precipit|lloviz/.test(text)) return "rain";
    if (/niebla|neblina|bruma/.test(text)) return "fog";
    if (/ventos|viento fuerte|rafaga/.test(text)) return "wind";
    if (/despejado|soleado/.test(text)) return "clear";
    if (/algo nublado|parcial|mayormente despejado/.test(text)) return "partly";
    if (/nublado|cubierto/.test(text)) return "cloudy";
    return "unknown";
  }

  function sunSvg(withCloud = false) {
    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <g class="sun-group">
          <g stroke="#f3b619" stroke-width="5" stroke-linecap="round">
            <path d="M48 8v10M48 78v10M8 48h10M78 48h10"/>
            <path d="m19.7 19.7 7.1 7.1M69.2 69.2l7.1 7.1"/>
            <path d="m19.7 76.3 7.1-7.1M69.2 26.8l7.1-7.1"/>
          </g>
          <circle class="sun-core" cx="48" cy="48" r="19"
            fill="#ffd84c" stroke="#f3a713" stroke-width="4"/>
        </g>
        ${
          withCloud
            ? `<g class="cloud-group" transform="translate(26 48)">
                <path d="M12 27h42c8 0 14-5 14-12S62 3 55 3c-3 0-6 1-8 3C43-1 36-5 28-5 17-5 8 3 7 14 1 15-3 20-3 26c0 1 0 1 1 1Z"
                  fill="#f7fbfd" stroke="#7693a4" stroke-width="3"/>
              </g>`
            : ""
        }
      </svg>
    `;
  }

  function moonSvg(withCloud = false) {
    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <defs>
          <filter id="moonGlow">
            <feGaussianBlur stdDeviation="2.5" result="blur"/>
            <feMerge>
              <feMergeNode in="blur"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g class="moon-group" filter="url(#moonGlow)">
          <path d="M66 18c-20 3-31 23-23 41 7 17 27 25 43 16-7 12-20 20-35 20-23 0-42-19-42-42S28 11 51 11c5 0 10 1 15 3Z"
            transform="translate(6 -5)"
            fill="#f6f2c8" stroke="#d9d394" stroke-width="3"/>
          <circle cx="72" cy="22" r="2.5" fill="#d8f3ff"/>
          <circle cx="83" cy="35" r="1.8" fill="#d8f3ff"/>
          <circle cx="74" cy="48" r="1.4" fill="#d8f3ff"/>
        </g>
        ${
          withCloud
            ? `<g class="cloud-group" transform="translate(24 52)">
                <path d="M12 27h42c8 0 14-5 14-12S62 3 55 3c-3 0-6 1-8 3C43-1 36-5 28-5 17-5 8 3 7 14 1 15-3 20-3 26c0 1 0 1 1 1Z"
                  fill="#eaf2f6" stroke="#6f8898" stroke-width="3"/>
              </g>`
            : ""
        }
      </svg>
    `;
  }

  function cloudSvg(mode = "cloudy") {
    const extra =
      mode === "rain"
        ? `<g stroke="#278dc2" stroke-width="5" stroke-linecap="round">
             <path class="rain-drop" d="M31 67l-4 12"/>
             <path class="rain-drop" d="M49 67l-4 12"/>
             <path class="rain-drop" d="M67 67l-4 12"/>
           </g>`
        : mode === "storm"
          ? `<path class="lightning" d="M48 61 36 79h12l-4 15 19-25H51l6-8Z"
               fill="#ffc928" stroke="#d79400" stroke-width="2"/>`
          : mode === "snow"
            ? `<g fill="#66b9d7" stroke="#66b9d7" stroke-width="2">
                 <path class="snow-flake" d="M28 68v17M20 76h16M22 70l12 12M34 70 22 82"/>
                 <path class="snow-flake" d="M58 68v17M50 76h16M52 70l12 12M64 70 52 82"/>
               </g>`
            : "";

    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <g class="cloud-group">
          <path d="M23 65h49c10 0 18-7 18-17 0-9-7-16-16-17-5-13-17-21-31-19-13 2-23 12-25 25C8 38 2 45 2 54c0 7 5 11 11 11Z"
            fill="#eaf2f6" stroke="#688393" stroke-width="4"/>
          <path d="M24 57h45" stroke="#ffffff" stroke-width="4" stroke-linecap="round" opacity=".7"/>
        </g>
        ${extra}
      </svg>
    `;
  }

  function fogSvg() {
    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <g class="cloud-group">
          <path d="M22 50h51c9 0 16-6 16-15s-7-15-15-15c-5-11-16-17-28-15C35 7 27 15 25 26 14 27 7 34 7 42c0 5 4 8 15 8Z"
            fill="#eaf2f6" stroke="#78909d" stroke-width="4"/>
        </g>
        <g stroke="#78909d" stroke-width="5" stroke-linecap="round">
          <path class="fog-line" d="M17 63h62"/>
          <path class="fog-line" d="M10 75h52"/>
          <path class="fog-line" d="M34 87h48"/>
        </g>
      </svg>
    `;
  }

  function windSvg() {
    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <g fill="none" stroke="#3aa4c5" stroke-width="6" stroke-linecap="round">
          <path class="fog-line" d="M12 31h51c12 0 12-18 1-18-7 0-9 5-9 8"/>
          <path class="fog-line" d="M12 49h67c14 0 14 20 0 20-8 0-11-6-11-10"/>
          <path class="fog-line" d="M12 68h36"/>
        </g>
      </svg>
    `;
  }

  function unknownSvg() {
    return `
      <svg class="wx-icon" viewBox="0 0 96 96" aria-hidden="true">
        <circle cx="48" cy="48" r="35" fill="#edf5f8" stroke="#7f98a7" stroke-width="4"/>
        <path d="M36 37c1-9 8-14 18-14 11 0 18 7 18 16 0 8-5 12-12 16-6 4-8 7-8 13"
          fill="none" stroke="#557080" stroke-width="6" stroke-linecap="round"/>
        <circle cx="50" cy="77" r="4" fill="#557080"/>
      </svg>
    `;
  }

  function currentIconMarkup(description) {
    const category = weatherCategory(description);
    const night = isNightAtSelectedLocality();

    if (category === "clear") return night ? moonSvg(false) : sunSvg(false);
    if (category === "partly") return night ? moonSvg(true) : sunSvg(true);
    if (category === "cloudy") return cloudSvg("cloudy");
    if (category === "rain") return cloudSvg("rain");
    if (category === "storm") return cloudSvg("storm");
    if (category === "snow") return cloudSvg("snow");
    if (category === "fog") return fogSvg();
    if (category === "wind") return windSvg();
    return unknownSvg();
  }

  function updateCurrentIcon() {
    if (state.updatingIcon) return;

    const glyph = document.getElementById("current-glyph");
    const description = document.getElementById("current-description");
    if (!glyph || !description) return;

    const text = description.textContent.trim();
    if (!text || /cargando/i.test(text)) return;

    state.updatingIcon = true;
    glyph.dataset.weatherCategory = weatherCategory(text);
    glyph.dataset.isNight = isNightAtSelectedLocality() ? "true" : "false";
    glyph.innerHTML = currentIconMarkup(text);
    state.updatingIcon = false;
  }

  function classifyEmoji(text) {
    if (/⛈|⚡/.test(text)) return "weather-storm";
    if (/🌧|☔|💧/.test(text)) return "weather-rain";
    if (/❄|🌨/.test(text)) return "weather-snow";
    if (/🌫/.test(text)) return "weather-fog";
    if (/💨/.test(text)) return "weather-wind";
    if (/🌙/.test(text)) return "weather-night";
    if (/☀/.test(text)) return "weather-clear";
    if (/⛅|🌤/.test(text)) return "weather-partly";
    if (/☁/.test(text)) return "weather-cloudy";
    return "";
  }

  function animateForecastIcons() {
    document
      .querySelectorAll(".mini-icon, .forecast-icon")
      .forEach((element) => {
        element.classList.add("weather-icon-animated");
        const category = classifyEmoji(element.textContent);
        if (category) element.classList.add(category);
      });
  }

  async function loadCoordinates() {
    if (state.catalogLoaded) return;

    try {
      const response = await fetch(CATALOG_URL, {
        cache: "force-cache",
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const value = await response.json();
      const records = Array.isArray(value?.records)
        ? value.records
        : [];

      records.forEach((row) => {
        const id = Number(row[COL.id]);
        const lat = Number(row[COL.lat]);
        const lon = Number(row[COL.lon]);

        if (
          Number.isFinite(id) &&
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          state.coordinates.set(id, { lat, lon });
        }
      });

      state.catalogLoaded = true;
      updateCurrentIcon();
    } catch (error) {
      console.warn(
        "No se cargaron coordenadas para el cálculo solar:",
        error,
      );
    }
  }

  function dispatchLocationChange() {
    window.dispatchEvent(new Event("climate-location-change"));
  }

  function wrapHistoryMethod(name) {
    const original = history[name];
    history[name] = function wrappedHistoryMethod(...args) {
      const result = original.apply(this, args);
      dispatchLocationChange();
      return result;
    };
  }

  function installObservers() {
    wrapHistoryMethod("pushState");
    wrapHistoryMethod("replaceState");

    const currentDescription =
      document.getElementById("current-description");
    const currentTitle =
      document.getElementById("location-title");
    const summaryForecast =
      document.getElementById("summary-forecast-grid");
    const forecastGrid =
      document.getElementById("forecast-grid");

    const weatherObserver = new MutationObserver(() => {
      window.requestAnimationFrame(() => {
        updateCurrentIcon();
        animateForecastIcons();
      });
    });

    [currentDescription, currentTitle, summaryForecast, forecastGrid]
      .filter(Boolean)
      .forEach((element) => {
        weatherObserver.observe(element, {
          childList: true,
          subtree: true,
          characterData: true,
        });
      });

    window.addEventListener("popstate", () => {
      window.setTimeout(updateCurrentIcon, 80);
    });

    window.addEventListener("climate-location-change", () => {
      window.setTimeout(updateCurrentIcon, 80);
    });

    window.setInterval(updateCurrentIcon, 10 * 60 * 1000);
  }

  function initializeEnhancements() {
    installObservers();
    loadCoordinates();
    updateCurrentIcon();
    animateForecastIcons();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initializeEnhancements,
      { once: true },
    );
  } else {
    initializeEnhancements();
  }
})();
