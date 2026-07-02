(() => {
  "use strict";

  const CONFIG_URL = "./config/data-sources.json";
  const ALIASES_URL = "./config/locality-aliases.json";
  const RECENT_KEY = "climateproyectar-v2-recientes";
  const CACHE_PREFIX = "climateproyectar-cache:";
  const ARGENTINA_TZ = "America/Argentina/Buenos_Aires";

  const COL = Object.freeze({
    id: 0,
    name: 1,
    department: 2,
    province: 3,
    type: 4,
    forecastId: 5,
    stationId: 6,
    sourceStationId: 7,
    stationName: 8,
    distanceKm: 9,
    lat: 10,
    lon: 11,
  });

  const PERIODS = [
    ["early_morning", "Madrugada"],
    ["morning", "Mañana"],
    ["afternoon", "Tarde"],
    ["night", "Noche"],
  ];

  const SOURCE_THRESHOLDS_MINUTES = {
    observations: 75,
    forecasts: 390,
    alerts: 150,
    radar: 50,
    satellite: 50,
  };

  const state = {
    config: null,
    aliases: {},
    rows: [],
    rowsById: new Map(),
    searchIndex: [],
    selectedId: null,
    suggestions: [],
    activeSuggestion: -1,
    catalogManifest: null,
    observationsManifest: null,
    forecastsManifest: null,
    stations: {},
    currentForecast: null,
    alertsManifest: null,
    alertsData: null,
    alertMapping: null,
    alertAreas: null,
    alertsLoaded: false,
    alertMap: null,
    alertLayer: null,
    localityMarker: null,
    radarManifest: null,
    radarLoaded: false,
    satelliteManifest: null,
    satelliteLoaded: false,
    activeTab: "summary",
  };

  const animation = {
    radar: { frames: [], index: 0, timer: null, playing: true, retries: 0 },
    satellite: { frames: [], index: 0, timer: null, playing: true, retries: 0 },
  };

  const $ = (id) => document.getElementById(id);
  const elements = {
    localityCount: $("locality-count"),
    searchInput: $("search-input"),
    clearSearch: $("clear-search"),
    suggestions: $("suggestions"),
    searchStatus: $("search-status"),
    locationButton: $("location-button"),
    recentSearches: $("recent-searches"),
    recentList: $("recent-list"),
    emptyState: $("empty-state"),
    errorState: $("error-state"),
    errorMessage: $("error-message"),
    retryButton: $("retry-button"),
    resultSection: $("result-section"),
    locationTitle: $("location-title"),
    locationSubtitle: $("location-subtitle"),
    shareButton: $("share-button"),
    currentGlyph: $("current-glyph"),
    currentTemperature: $("current-temperature"),
    currentDescription: $("current-description"),
    feelsLike: $("feels-like"),
    observationBadge: $("observation-badge"),
    stationSource: $("station-source"),
    observationTime: $("observation-time"),
    metricHumidity: $("metric-humidity"),
    metricWind: $("metric-wind"),
    metricPressure: $("metric-pressure"),
    metricVisibility: $("metric-visibility"),
    summaryAlertBanner: $("summary-alert-banner"),
    summaryForecastGrid: $("summary-forecast-grid"),
    forecastUpdated: $("forecast-updated"),
    forecastNotice: $("forecast-notice"),
    forecastGrid: $("forecast-grid"),
    alertsTabBadge: $("alerts-tab-badge"),
    alertDateFilter: $("alert-date-filter"),
    alertEventFilter: $("alert-event-filter"),
    localityAlerts: $("locality-alerts"),
    alertsList: $("alerts-list"),
    mapStatus: $("map-status"),
    radarProduct: $("radar-product"),
    radarImage: $("radar-image"),
    radarLoading: $("radar-loading"),
    radarPrev: $("radar-prev"),
    radarPlay: $("radar-play"),
    radarNext: $("radar-next"),
    radarFrameTime: $("radar-frame-time"),
    radarFrameCount: $("radar-frame-count"),
    radarStatus: $("radar-status"),
    satelliteImage: $("satellite-image"),
    satelliteLoading: $("satellite-loading"),
    satellitePrev: $("satellite-prev"),
    satellitePlay: $("satellite-play"),
    satelliteNext: $("satellite-next"),
    satelliteFrameTime: $("satellite-frame-time"),
    satelliteFrameCount: $("satellite-frame-count"),
    satelliteStatus: $("satellite-status"),
    satelliteUpdated: $("satellite-updated"),
  };

  function joinUrl(base, path) {
    return `${String(base).replace(/\/$/, "")}/${String(path).replace(/^\//, "")}`;
  }

  function withVersion(url, version = Date.now()) {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}v=${encodeURIComponent(version)}`;
  }

  function normalizeText(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es-AR")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function number(value, digits = 0) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat("es-AR", { maximumFractionDigits: digits }).format(Number(value));
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return "Fecha no informada";
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: ARGENTINA_TZ,
    }).format(date);
  }

  function formatDay(value) {
    const date = parseDate(`${value}T12:00:00-03:00`) || parseDate(value);
    if (!date) return value || "Fecha no informada";
    return new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: ARGENTINA_TZ,
    }).format(date);
  }

  function ageMinutes(value) {
    const date = parseDate(value);
    if (!date) return null;
    return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  }

  function relativeAge(value) {
    const minutes = ageMinutes(value);
    if (minutes === null) return "sin fecha";
    if (minutes < 2) return "ahora";
    if (minutes < 60) return `hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `hace ${hours} h`;
    return `hace ${Math.floor(hours / 24)} d`;
  }

  function displayName(row) {
    const alias = state.aliases[String(row[COL.id])];
    return alias?.display_name || row[COL.name] || "Localidad";
  }

  function weatherGlyph(description) {
    const text = normalizeText(description);
    if (/torment|electr/.test(text)) return "⛈️";
    if (/nieve|nevad|aguanieve/.test(text)) return "🌨️";
    if (/lluv|chaparr|precipit|lloviz/.test(text)) return "🌧️";
    if (/niebla|neblina|bruma/.test(text)) return "🌫️";
    if (/ventos|viento fuerte|rafaga/.test(text)) return "💨";
    if (/despejado|soleado/.test(text)) return "☀️";
    if (/algo nublado|parcial/.test(text)) return "🌤️";
    if (/nublado|cubierto/.test(text)) return "☁️";
    return "🌥️";
  }

  async function fetchJson(url, options = {}) {
    const cacheKey = options.cacheKey ? `${CACHE_PREFIX}${options.cacheKey}` : null;
    try {
      const response = await fetch(withVersion(url, options.version || Date.now()), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status} al cargar ${url}`);
      const value = await response.json();
      if (cacheKey) {
        try { localStorage.setItem(cacheKey, JSON.stringify(value)); } catch { /* sin espacio de caché */ }
      }
      return value;
    } catch (error) {
      if (cacheKey) {
        try {
          const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
          if (cached) return cached;
        } catch { /* caché inválida */ }
      }
      throw error;
    }
  }

  function sourceTimestamp(source, manifest) {
    if (!manifest) return null;
    if (source === "radar") {
      const products = Array.isArray(manifest.products) ? manifest.products : [];
      const values = products.map((item) => item.updated_at).filter(Boolean).sort();
      return values.at(-1) || manifest.generated_at;
    }
    return manifest.generated_at || manifest.last_success_at || manifest.updated_at;
  }

  function updateSourceCard(source, manifest, error = null) {
    const card = document.querySelector(`[data-source="${source}"]`);
    if (!card) return;
    const strong = card.querySelector("strong");
    card.classList.remove("delayed", "error");
    if (error || !manifest) {
      strong.textContent = "No disponible";
      card.classList.add("error");
      card.title = error?.message || "No se pudo cargar la fuente";
      return;
    }
    const timestamp = sourceTimestamp(source, manifest);
    const age = ageMinutes(timestamp);
    strong.textContent = timestamp ? `Actualizado ${relativeAge(timestamp)}` : "Fecha no informada";
    const threshold = SOURCE_THRESHOLDS_MINUTES[source];
    if (age !== null && threshold && age > threshold) card.classList.add("delayed");
    card.title = timestamp ? formatDateTime(timestamp) : "Fecha no informada";
  }

  function unpackCatalog(value) {
    if (Array.isArray(value?.records)) return value.records;
    if (Array.isArray(value?.localities)) {
      return value.localities.map((item) => [
        item.id, item.name, item.department, item.province, item.type,
        item.forecast_reference_id, item.operational_station_number,
        item.source_station_number, item.station_name, item.distance_km,
        item.lat ?? item.coord?.lat, item.lon ?? item.coord?.lon,
      ]);
    }
    if (Array.isArray(value)) return value;
    return [];
  }

  function buildSearchIndex() {
    state.rowsById.clear();
    state.searchIndex = state.rows.map((row) => {
      const id = String(row[COL.id]);
      const alias = state.aliases[id];
      const aliases = Array.isArray(alias?.search_aliases) ? alias.search_aliases : [];
      state.rowsById.set(Number(row[COL.id]), row);
      return normalizeText([
        row[COL.name], displayName(row), row[COL.department], row[COL.province], ...aliases,
      ].filter(Boolean).join(" "));
    });
  }

  function localityLabel(row) {
    return [displayName(row), row[COL.department], row[COL.province]].filter(Boolean).join(", ");
  }

  function searchRows(queryValue) {
    const query = normalizeText(queryValue);
    if (query.length < 2) return [];
    const tokens = query.split(" ").filter(Boolean);
    const matches = [];
    state.rows.forEach((row, index) => {
      const name = normalizeText(displayName(row));
      const sourceName = normalizeText(row[COL.name]);
      const full = state.searchIndex[index];
      let score = null;
      if (name === query || sourceName === query) score = 0;
      else if (name.startsWith(query) || sourceName.startsWith(query)) score = 1;
      else if (tokens.every((token) => full.split(" ").some((word) => word.startsWith(token)))) score = 2;
      else if (full.includes(query)) score = 3;
      else if (tokens.every((token) => full.includes(token))) score = 4;
      if (score !== null) matches.push({ row, score });
    });
    matches.sort((a, b) => a.score - b.score || displayName(a.row).localeCompare(displayName(b.row), "es-AR"));
    return matches.slice(0, 10).map((item) => item.row);
  }

  function hideSuggestions() {
    state.activeSuggestion = -1;
    elements.suggestions.hidden = true;
    elements.suggestions.innerHTML = "";
    elements.searchInput.setAttribute("aria-expanded", "false");
  }

  function renderSuggestions(rows) {
    state.suggestions = rows;
    elements.suggestions.innerHTML = "";
    if (!rows.length) {
      hideSuggestions();
      return;
    }
    rows.forEach((row, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "suggestion-item";
      button.setAttribute("role", "option");
      button.dataset.index = String(index);
      button.innerHTML = `
        <span><strong>${escapeHtml(displayName(row))}</strong><span>${escapeHtml([row[COL.department], row[COL.province]].filter(Boolean).join(" · "))}</span></span>
        <span class="suggestion-type">${escapeHtml(row[COL.type] || "Localidad")}</span>`;
      button.addEventListener("click", () => selectLocality(Number(row[COL.id])));
      elements.suggestions.append(button);
    });
    elements.suggestions.hidden = false;
    elements.searchInput.setAttribute("aria-expanded", "true");
  }

  function setActiveSuggestion(index) {
    const items = [...elements.suggestions.querySelectorAll(".suggestion-item")];
    if (!items.length) return;
    state.activeSuggestion = (index + items.length) % items.length;
    items.forEach((item, itemIndex) => {
      const active = itemIndex === state.activeSuggestion;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", active ? "true" : "false");
    });
    items[state.activeSuggestion].scrollIntoView({ block: "nearest" });
  }

  function getRecentIds() {
    try {
      const values = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
    } catch { return []; }
  }

  function saveRecent(id) {
    const values = [id, ...getRecentIds().filter((item) => item !== id)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(values));
    renderRecent();
  }

  function renderRecent() {
    const rows = getRecentIds().map((id) => state.rowsById.get(id)).filter(Boolean);
    elements.recentList.innerHTML = "";
    rows.forEach((row) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = displayName(row);
      button.title = localityLabel(row);
      button.addEventListener("click", () => selectLocality(Number(row[COL.id])));
      elements.recentList.append(button);
    });
    elements.recentSearches.hidden = !rows.length;
  }

  function setUrl(id) {
    const url = new URL(window.location.href);
    url.searchParams.set("id", String(id));
    history.pushState({ localityId: id }, "", url);
  }

  function setObservation(row) {
    const record = state.stations[String(row[COL.stationId])] || state.stations[String(row[COL.sourceStationId])];
    const payload = record?.payload || {};
    const hasData = Boolean(record?.payload);
    const delayed = !hasData || record?.status === "stale" || record?.fresh === false || (ageMinutes(payload.date) ?? 9999) > 300;
    const description = payload.weather?.description || "Sin observación disponible";

    elements.currentTemperature.textContent = payload.temperature === null || payload.temperature === undefined ? "—" : number(payload.temperature, 1);
    elements.currentDescription.textContent = description;
    elements.currentGlyph.textContent = weatherGlyph(description);
    elements.feelsLike.textContent = payload.feels_like === null || payload.feels_like === undefined ? "" : `Sensación térmica: ${number(payload.feels_like, 1)} °C`;
    elements.observationBadge.textContent = !hasData ? "Sin datos" : delayed ? "Dato demorado" : "Dato reciente";
    elements.observationBadge.className = `status-badge${delayed ? " delayed" : ""}`;

    const stationName = row[COL.stationName] || payload.location?.name || `Estación ${row[COL.stationId] ?? "sin identificar"}`;
    const distance = row[COL.distanceKm];
    elements.stationSource.textContent = distance === null || distance === undefined
      ? `Observación de ${stationName}.`
      : `Observación de ${stationName}, estación asociada a ${number(distance, 1)} km.`;
    elements.observationTime.textContent = payload.date ? `Observado el ${formatDateTime(payload.date)}.` : "Horario de observación no informado.";
    elements.metricHumidity.textContent = payload.humidity === null || payload.humidity === undefined ? "—" : `${number(payload.humidity)} %`;
    const wind = [];
    if (payload.wind?.direction) wind.push(payload.wind.direction);
    if (payload.wind?.speed !== null && payload.wind?.speed !== undefined) wind.push(`${number(payload.wind.speed)} km/h`);
    elements.metricWind.textContent = wind.length ? wind.join(" · ") : "—";
    elements.metricPressure.textContent = payload.pressure === null || payload.pressure === undefined ? "—" : `${number(payload.pressure, 1)} hPa`;
    elements.metricVisibility.textContent = payload.visibility === null || payload.visibility === undefined ? "—" : `${number(payload.visibility, 1)} km`;
  }

  function dayDescription(day) {
    for (const [key] of [["afternoon"], ["morning"], ["night"], ["early_morning"]]) {
      const period = day[key];
      if (period?.weather?.description) return period.weather.description;
      if (period?.description) return period.description;
    }
    return "Pronóstico disponible";
  }

  function rangeText(value, suffix = "") {
    if (!Array.isArray(value) || value.length < 2) return null;
    return Number(value[0]) === Number(value[1]) ? `${value[0]}${suffix}` : `${value[0]}–${value[1]}${suffix}`;
  }

  function renderSummaryForecast(days) {
    const visible = days.slice(0, 4);
    elements.summaryForecastGrid.innerHTML = visible.length ? visible.map((day) => {
      const description = dayDescription(day);
      return `<article class="mini-day">
        <strong>${escapeHtml(formatDay(day.date).split(",")[0])}</strong>
        <span class="mini-date">${escapeHtml(formatDay(day.date).split(",").slice(1).join(",").trim())}</span>
        <span class="mini-icon">${weatherGlyph(description)}</span>
        <span class="mini-temp"><strong>${day.temp_max ?? "—"}°</strong> / ${day.temp_min ?? "—"}°</span>
      </article>`;
    }).join("") : '<p class="loading-text">No hay días disponibles.</p>';
  }

  function periodHtml(key, label, period) {
    if (!period) return "";
    const description = period.weather?.description || period.description || "Sin descripción";
    const details = [];
    if (period.temperature !== null && period.temperature !== undefined) details.push(`${number(period.temperature)} °C`);
    const rain = rangeText(period.rain_prob_range, "% lluvia");
    if (rain) details.push(rain);
    const speed = rangeText(period.wind?.speed_range, " km/h");
    if (speed) details.push(`Viento ${speed}`);
    if (period.wind?.direction) details.push(period.wind.direction);
    const gust = rangeText(period.gust_range, " km/h");
    if (gust) details.push(`Ráfagas ${gust}`);
    return `<div class="period">
      <div class="period-head"><span>${escapeHtml(label)}</span><span>${weatherGlyph(description)}</span></div>
      <p>${escapeHtml(description)}${details.length ? ` · ${escapeHtml(details.join(" · "))}` : ""}</p>
    </div>`;
  }

  function forecastDayHtml(day) {
    const description = dayDescription(day);
    const periods = PERIODS.map(([key, label]) => periodHtml(key, label, day[key])).filter(Boolean).join("");
    return `<article class="forecast-day">
      <div class="forecast-day-head">
        <div><h4>${escapeHtml(formatDay(day.date).split(",")[0])}</h4><p>${escapeHtml(formatDay(day.date).split(",").slice(1).join(",").trim())}</p></div>
        <span class="forecast-icon">${weatherGlyph(description)}</span>
      </div>
      <div class="temp-range">
        <div><span>Máxima</span><strong>${day.temp_max ?? "—"}°</strong></div>
        <div><span>Mínima</span><strong>${day.temp_min ?? "—"}°</strong></div>
      </div>
      <div class="period-list">${periods || '<p class="muted">Sin detalle por período.</p>'}</div>
    </article>`;
  }

  function setForecast(record) {
    state.currentForecast = record;
    const payload = record?.payload || {};
    const days = Array.isArray(payload.forecast) ? payload.forecast : [];
    elements.forecastGrid.innerHTML = days.length ? days.map(forecastDayHtml).join("") : '<p class="loading-text">No hay pronóstico disponible.</p>';
    renderSummaryForecast(days);
    elements.forecastUpdated.textContent = payload.updated ? `${record.historical ? "Emitido" : "Actualizado"}: ${formatDateTime(payload.updated)}` : "Fecha de emisión no informada";
    elements.forecastNotice.innerHTML = "";
    if (record?.historical) {
      elements.forecastNotice.innerHTML = `<div class="notice"><strong>Último pronóstico oficial disponible.</strong> Fue emitido el ${escapeHtml(formatDateTime(payload.updated))} y puede no representar las condiciones actuales.</div>`;
    } else if (record?.status === "stale" || record?.fresh === false) {
      elements.forecastNotice.innerHTML = '<div class="notice"><strong>Pronóstico demorado.</strong> Se muestra el último pronóstico válido recibido.</div>';
    }
  }

  async function loadForecast(row) {
    elements.forecastGrid.innerHTML = '<p class="loading-text">Cargando pronóstico…</p>';
    elements.summaryForecastGrid.innerHTML = '<p class="loading-text">Cargando pronóstico…</p>';
    try {
      const directory = state.forecastsManifest?.files?.forecasts?.directory || "pronosticos";
      const url = joinUrl(state.config.forecasts.base_url, `${directory}/${Number(row[COL.forecastId])}.json`);
      const record = await fetchJson(url, {
        cacheKey: `forecast-${row[COL.forecastId]}`,
        version: state.forecastsManifest?.generated_at || Date.now(),
      });
      if (state.selectedId === Number(row[COL.id])) setForecast(record);
    } catch (error) {
      console.error(error);
      elements.forecastGrid.innerHTML = '<div class="notice">No se pudo cargar el pronóstico. La observación sigue disponible.</div>';
      elements.summaryForecastGrid.innerHTML = '<p class="loading-text">Pronóstico temporalmente no disponible.</p>';
    }
  }

  function alertLevelClass(level) {
    return ({ 3: "yellow", 4: "orange", 5: "red" })[Number(level)] || "";
  }

  function alertLevelName(level) {
    return state.alertsData?.levels?.[String(level)] || ({ 3: "Amarillo", 4: "Naranja", 5: "Rojo" })[Number(level)] || `Nivel ${level}`;
  }

  function alertEventName(event) {
    return event?.name || state.alertsData?.phenomena?.[String(event?.id)] || `Fenómeno ${event?.id ?? "sin identificar"}`;
  }

  function localityAreaIds(localityId) {
    const mapping = state.alertMapping?.by_locality_id || state.alertMapping?.localities || {};
    const value = mapping[String(localityId)] ?? mapping[Number(localityId)] ?? [];
    if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
    if (Array.isArray(value?.area_ids)) return value.area_ids.map(Number).filter(Number.isFinite);
    if (value?.area_id !== undefined) return [Number(value.area_id)].filter(Number.isFinite);
    return [];
  }

  function filteredAlerts() {
    const records = Array.isArray(state.alertsData?.alerts) ? state.alertsData.alerts : [];
    const date = elements.alertDateFilter.value;
    const event = elements.alertEventFilter.value;
    return records.filter((record) => {
      if (date && String(record.date) !== date) return false;
      if (event && !(record.events || []).some((item) => String(item.id) === event)) return false;
      return true;
    });
  }

  function alertsForLocality(localityId, applyFilters = false) {
    const areaSet = new Set(localityAreaIds(localityId));
    const source = applyFilters ? filteredAlerts() : (state.alertsData?.alerts || []);
    return source.filter((record) => areaSet.has(Number(record.area_id)));
  }

  function renderAlertFilters() {
    const records = Array.isArray(state.alertsData?.alerts) ? state.alertsData.alerts : [];
    const dates = [...new Set(records.map((item) => item.date).filter(Boolean))].sort();
    const events = new Map();
    records.forEach((record) => (record.events || []).forEach((event) => events.set(String(event.id), alertEventName(event))));
    elements.alertDateFilter.innerHTML = '<option value="">Todas</option>' + dates.map((date) => `<option value="${escapeHtml(date)}">${escapeHtml(formatDay(date))}</option>`).join("");
    elements.alertEventFilter.innerHTML = '<option value="">Todos</option>' + [...events.entries()].sort((a, b) => a[1].localeCompare(b[1], "es-AR")).map(([id, name]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`).join("");
  }

  function renderLocalityAlerts() {
    if (!state.selectedId || !state.alertsLoaded) return;
    const row = state.rowsById.get(state.selectedId);
    const areaIds = localityAreaIds(state.selectedId);
    const records = alertsForLocality(state.selectedId, true);
    const allRecords = alertsForLocality(state.selectedId, false);
    const maxLevel = allRecords.length ? Math.max(...allRecords.map((item) => Number(item.level) || 1)) : 1;
    const names = [...new Set(allRecords.flatMap((item) => (item.events || []).map(alertEventName)))];

    elements.alertsTabBadge.hidden = !allRecords.length;
    elements.alertsTabBadge.textContent = allRecords.length ? String(allRecords.length) : "";

    if (!areaIds.length) {
      elements.localityAlerts.innerHTML = `<div class="locality-alert-summary"><h4>${escapeHtml(displayName(row))}</h4><p>No quedó asociada a un polígono de alerta. La ausencia de asociación no reemplaza la consulta oficial.</p></div>`;
      elements.summaryAlertBanner.innerHTML = "";
      return;
    }

    if (!allRecords.length) {
      elements.localityAlerts.innerHTML = `<div class="locality-alert-summary"><h4>Sin alertas activas para ${escapeHtml(displayName(row))}</h4><p>Áreas asociadas: ${areaIds.join(", ")}.</p></div>`;
      elements.summaryAlertBanner.innerHTML = "";
      return;
    }

    const levelClass = alertLevelClass(maxLevel);
    elements.localityAlerts.innerHTML = `<div class="locality-alert-summary ${levelClass}">
      <h4>Alerta ${escapeHtml(alertLevelName(maxLevel))} para ${escapeHtml(displayName(row))}</h4>
      <p>${escapeHtml(names.join(" · ") || "Fenómeno no informado")} · ${records.length || allRecords.length} registro(s) visible(s).</p>
    </div>`;
    elements.summaryAlertBanner.innerHTML = `<div class="alert-banner ${levelClass}">
      <span class="alert-symbol">⚠️</span>
      <span><strong>Alerta ${escapeHtml(alertLevelName(maxLevel))}</strong><span>${escapeHtml(names.join(" · ") || "Fenómeno no informado")}</span></span>
      <button type="button" data-open-tab="alerts">Ver alertas</button>
    </div>`;
  }

  function renderAlertsList() {
    const records = filteredAlerts();
    elements.alertsList.innerHTML = records.length ? records.map((record) => {
      const events = (record.events || []).map(alertEventName);
      return `<article class="alert-record ${alertLevelClass(record.level)}">
        <strong>${escapeHtml(alertLevelName(record.level))} · ${escapeHtml(events.join(" · ") || "Fenómeno no informado")}</strong>
        <span>${escapeHtml(formatDay(record.date))} · Área ${escapeHtml(record.area_id)}</span>
      </article>`;
    }).join("") : '<p class="loading-text">No hay alertas para los filtros elegidos.</p>';
  }

  function areaIdFromFeature(feature) {
    return Number(feature?.properties?.gid ?? feature?.properties?.area_id ?? feature?.properties?.id ?? feature?.id);
  }

  function refreshAlertMap() {
    if (!state.alertMap || !state.alertAreas || !window.L) return;
    const levels = new Map();
    filteredAlerts().forEach((record) => {
      const id = Number(record.area_id);
      levels.set(id, Math.max(levels.get(id) || 1, Number(record.level) || 1));
    });
    if (state.alertLayer) state.alertLayer.remove();
    state.alertLayer = window.L.geoJSON(state.alertAreas, {
      style: (feature) => {
        const level = levels.get(areaIdFromFeature(feature)) || 1;
        const color = ({ 3: "#d6b900", 4: "#e97813", 5: "#d52d27" })[level] || "#637b8c";
        return { color, weight: level >= 3 ? 1.4 : .4, fillColor: color, fillOpacity: level >= 3 ? .48 : .035 };
      },
      onEachFeature: (feature, layer) => {
        const id = areaIdFromFeature(feature);
        const level = levels.get(id) || 1;
        layer.bindPopup(`<strong>Área ${escapeHtml(id)}</strong><br>${escapeHtml(level >= 3 ? alertLevelName(level) : "Sin alerta activa")}`);
      },
    }).addTo(state.alertMap);
    elements.mapStatus.textContent = `${filteredAlerts().length} registros activos para los filtros seleccionados.`;
  }

  function ensureAlertMap() {
    if (state.alertMap || !window.L || !state.alertAreas) return;
    state.alertMap = window.L.map("alert-map", { minZoom: 3 }).setView([-38.4, -64.2], 4);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "© OpenStreetMap contributors",
    }).addTo(state.alertMap);
    refreshAlertMap();
    focusSelectedLocalityOnMap();
  }

  function focusSelectedLocalityOnMap() {
    if (!state.alertMap || !state.selectedId || !window.L) return;
    const row = state.rowsById.get(state.selectedId);
    const lat = Number(row?.[COL.lat]);
    const lon = Number(row?.[COL.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (state.localityMarker) state.localityMarker.remove();
    state.localityMarker = window.L.marker([lat, lon]).addTo(state.alertMap).bindPopup(escapeHtml(displayName(row)));
    if (state.activeTab === "alerts") state.alertMap.setView([lat, lon], 7);
  }

  async function loadAlerts() {
    if (state.alertsLoaded || state.config.alerts?.enabled === false) return;
    const source = state.config.alerts;
    try {
      const [manifest, alerts, mapping, areas] = await Promise.all([
        state.alertsManifest || fetchJson(joinUrl(source.base_url, source.manifest || "manifiesto.json"), { cacheKey: "alerts-manifest" }),
        fetchJson(joinUrl(source.base_url, source.alerts || "alertas.json"), { cacheKey: "alerts-data" }),
        fetchJson(joinUrl(source.base_url, source.locality_map || "localidades_alerta.min.json"), { cacheKey: "alerts-mapping" }),
        fetchJson(joinUrl(source.base_url, source.areas || "areas_alerta.geojson"), { cacheKey: "alerts-areas" }),
      ]);
      state.alertsManifest = manifest;
      state.alertsData = alerts;
      state.alertMapping = mapping;
      state.alertAreas = areas;
      state.alertsLoaded = true;
      updateSourceCard("alerts", manifest);
      renderAlertFilters();
      renderAlertsList();
      renderLocalityAlerts();
      if (state.activeTab === "alerts") ensureAlertMap();
    } catch (error) {
      console.error(error);
      updateSourceCard("alerts", null, error);
      elements.localityAlerts.innerHTML = '<div class="notice">No se pudieron cargar las alertas.</div>';
      elements.alertsList.innerHTML = '<p class="loading-text">Alertas temporalmente no disponibles.</p>';
    }
  }

  function normalizeFrames(value) {
    const source = Array.isArray(value) ? value : [];
    return source.filter((frame) => frame?.url).map((frame) => ({
      url: frame.url,
      timestamp: frame.timestamp_argentina || frame.timestamp_utc || frame.date || null,
      filename: frame.filename || "",
    }));
  }

  function setViewerStatus(kind, text, className = "") {
    const element = kind === "radar" ? elements.radarStatus : elements.satelliteStatus;
    element.textContent = text;
    element.className = `status-badge${className ? ` ${className}` : ""}`;
  }

  function renderFrame(kind, index, attempt = 0) {
    const model = animation[kind];
    if (!model.frames.length) return;
    model.index = (index + model.frames.length) % model.frames.length;
    const frame = model.frames[model.index];
    const image = kind === "radar" ? elements.radarImage : elements.satelliteImage;
    const loading = kind === "radar" ? elements.radarLoading : elements.satelliteLoading;
    const time = kind === "radar" ? elements.radarFrameTime : elements.satelliteFrameTime;
    const count = kind === "radar" ? elements.radarFrameCount : elements.satelliteFrameCount;
    const preload = new Image();
    preload.referrerPolicy = "no-referrer";
    if (!image.src) loading.hidden = false;
    preload.onload = () => {
      image.src = frame.url;
      image.referrerPolicy = "no-referrer";
      image.alt = `${kind === "radar" ? "Radar" : "Satélite"} · ${formatDateTime(frame.timestamp)}`;
      loading.hidden = true;
      time.textContent = frame.timestamp ? formatDateTime(frame.timestamp) : frame.filename;
      count.textContent = `Cuadro ${model.index + 1} de ${model.frames.length}`;
      setViewerStatus(kind, "Actualizado");
    };
    preload.onerror = () => {
      if (attempt < 3) {
        window.setTimeout(() => renderFrame(kind, model.index, attempt + 1), 900 * (attempt + 1));
      } else {
        loading.hidden = Boolean(image.src);
        setViewerStatus(kind, "Cuadro demorado", "delayed");
      }
    };
    preload.src = withVersion(frame.url, Date.now());
  }

  function startAnimation(kind) {
    const model = animation[kind];
    stopAnimation(kind);
    model.playing = true;
    const play = kind === "radar" ? elements.radarPlay : elements.satellitePlay;
    play.textContent = "Pausar";
    model.timer = window.setInterval(() => renderFrame(kind, model.index + 1), 1050);
  }

  function stopAnimation(kind) {
    const model = animation[kind];
    if (model.timer) window.clearInterval(model.timer);
    model.timer = null;
  }

  function toggleAnimation(kind) {
    const model = animation[kind];
    const play = kind === "radar" ? elements.radarPlay : elements.satellitePlay;
    if (model.playing) {
      stopAnimation(kind);
      model.playing = false;
      play.textContent = "Reproducir";
    } else {
      startAnimation(kind);
    }
  }

  function chooseRadarProduct(id) {
    const products = Array.isArray(state.radarManifest?.products) ? state.radarManifest.products : [];
    const product = products.find((item) => String(item.id) === String(id)) || products.find((item) => (item.animation_frames || []).length) || products[0];
    if (!product) return;
    elements.radarProduct.value = String(product.id);
    animation.radar.frames = normalizeFrames(product.animation_frames?.length ? product.animation_frames : product.frames);
    animation.radar.index = Math.max(0, animation.radar.frames.length - 1);
    elements.radarLoading.hidden = false;
    elements.radarLoading.textContent = animation.radar.frames.length ? "Cargando radar…" : "Este producto no tiene cuadros disponibles.";
    setViewerStatus("radar", product.status === "ok" ? "Disponible" : product.status === "delayed" ? "Demorado" : "Sin datos", product.status === "ok" ? "" : "delayed");
    if (animation.radar.frames.length) {
      renderFrame("radar", animation.radar.index);
      startAnimation("radar");
    } else {
      stopAnimation("radar");
    }
  }

  async function loadRadar() {
    if (state.radarLoaded || state.config.radar?.enabled === false) return;
    try {
      const manifest = state.radarManifest || await fetchJson(joinUrl(state.config.radar.base_url, state.config.radar.manifest || "manifiesto.json"), { cacheKey: "radar-manifest" });
      state.radarManifest = manifest;
      state.radarLoaded = true;
      updateSourceCard("radar", manifest);
      const products = Array.isArray(manifest.products) ? manifest.products : [];
      const groups = {
        mosaic: products.filter((item) => item.type === "mosaic"),
        radar: products.filter((item) => item.type !== "mosaic"),
      };
      elements.radarProduct.innerHTML = [
        groups.mosaic.length ? `<optgroup label="Mosaicos">${groups.mosaic.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.status === "no_data" ? " · sin datos" : ""}</option>`).join("")}</optgroup>` : "",
        groups.radar.length ? `<optgroup label="Radares individuales">${groups.radar.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.province ? ` · ${escapeHtml(item.province)}` : ""}${item.status === "no_data" ? " · sin datos" : ""}</option>`).join("")}</optgroup>` : "",
      ].join("");
      chooseRadarProduct(products.find((item) => item.id === "COMP_ARG")?.id || products[0]?.id);
    } catch (error) {
      console.error(error);
      updateSourceCard("radar", null, error);
      elements.radarLoading.textContent = "No se pudo cargar el radar.";
      setViewerStatus("radar", "Error", "error");
    }
  }

  async function loadSatellite() {
    if (state.satelliteLoaded || state.config.satellite?.enabled === false) return;
    try {
      const manifest = state.satelliteManifest || await fetchJson(joinUrl(state.config.satellite.base_url, state.config.satellite.manifest || "manifiesto.json"), { cacheKey: "satellite-manifest" });
      state.satelliteManifest = manifest;
      state.satelliteLoaded = true;
      updateSourceCard("satellite", manifest);
      animation.satellite.frames = normalizeFrames(manifest.animation_frames?.length ? manifest.animation_frames : manifest.frames);
      animation.satellite.index = Math.max(0, animation.satellite.frames.length - 1);
      elements.satelliteUpdated.textContent = manifest.latest?.timestamp_argentina ? `Último cuadro: ${formatDateTime(manifest.latest.timestamp_argentina)}` : `Catálogo: ${formatDateTime(manifest.generated_at)}`;
      if (animation.satellite.frames.length) {
        renderFrame("satellite", animation.satellite.index);
        startAnimation("satellite");
      } else {
        elements.satelliteLoading.textContent = "No hay cuadros satelitales disponibles.";
        setViewerStatus("satellite", "Sin datos", "delayed");
      }
    } catch (error) {
      console.error(error);
      updateSourceCard("satellite", null, error);
      elements.satelliteLoading.textContent = "No se pudo cargar el satélite.";
      setViewerStatus("satellite", "Error", "error");
    }
  }

  async function loadBackgroundManifests() {
    const jobs = ["alerts", "radar", "satellite"].map(async (sourceName) => {
      const source = state.config[sourceName];
      if (!source || source.enabled === false) return;
      try {
        const manifest = await fetchJson(joinUrl(source.base_url, source.manifest || "manifiesto.json"), { cacheKey: `${sourceName}-manifest` });
        if (sourceName === "alerts") state.alertsManifest = manifest;
        if (sourceName === "radar") state.radarManifest = manifest;
        if (sourceName === "satellite") state.satelliteManifest = manifest;
        updateSourceCard(sourceName, manifest);
      } catch (error) {
        updateSourceCard(sourceName, null, error);
      }
    });
    await Promise.allSettled(jobs);
  }

  function openTab(name) {
    state.activeTab = name;
    document.querySelectorAll(".tab").forEach((button) => {
      const active = button.dataset.tab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const active = panel.id === `tab-${name}`;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    if (name === "alerts") {
      loadAlerts().then(() => {
        ensureAlertMap();
        window.setTimeout(() => state.alertMap?.invalidateSize(), 100);
      });
    }
    if (name === "radar") loadRadar();
    if (name === "satellite") loadSatellite();
  }

  async function selectLocality(id, options = {}) {
    const row = state.rowsById.get(Number(id));
    if (!row) {
      elements.searchStatus.textContent = "La localidad solicitada no existe en el catálogo.";
      return;
    }
    state.selectedId = Number(id);
    hideSuggestions();
    elements.searchInput.value = displayName(row);
    elements.clearSearch.hidden = false;
    elements.searchStatus.textContent = localityLabel(row);
    elements.emptyState.hidden = true;
    elements.errorState.hidden = true;
    elements.resultSection.hidden = false;
    elements.locationTitle.textContent = displayName(row);
    elements.locationSubtitle.textContent = [row[COL.type], row[COL.department], row[COL.province]].filter(Boolean).join(" · ");
    if (!options.skipUrl) setUrl(Number(id));
    saveRecent(Number(id));
    setObservation(row);
    loadForecast(row);
    loadAlerts().then(() => {
      renderLocalityAlerts();
      focusSelectedLocalityOnMap();
    });
    if (!options.instant) elements.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function nearestLocality(lat, lon) {
    let nearest = null;
    let best = Infinity;
    const toRad = (value) => value * Math.PI / 180;
    state.rows.forEach((row) => {
      const rowLat = Number(row[COL.lat]);
      const rowLon = Number(row[COL.lon]);
      if (!Number.isFinite(rowLat) || !Number.isFinite(rowLon)) return;
      const dLat = toRad(rowLat - lat);
      const dLon = toRad(rowLon - lon);
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat)) * Math.cos(toRad(rowLat)) * Math.sin(dLon / 2) ** 2;
      const distance = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (distance < best) { best = distance; nearest = row; }
    });
    return { row: nearest, distance: best };
  }

  function useLocation() {
    if (!navigator.geolocation) {
      elements.searchStatus.textContent = "El navegador no permite obtener la ubicación.";
      return;
    }
    elements.locationButton.disabled = true;
    elements.locationButton.textContent = "Localizando…";
    navigator.geolocation.getCurrentPosition((position) => {
      const result = nearestLocality(position.coords.latitude, position.coords.longitude);
      elements.locationButton.disabled = false;
      elements.locationButton.textContent = "Usar mi ubicación";
      if (result.row) {
        elements.searchStatus.textContent = `Localidad más cercana, a ${number(result.distance, 1)} km.`;
        selectLocality(Number(result.row[COL.id]));
      }
    }, (error) => {
      elements.locationButton.disabled = false;
      elements.locationButton.textContent = "Usar mi ubicación";
      elements.searchStatus.textContent = error.code === 1 ? "No se concedió permiso de ubicación." : "No se pudo obtener la ubicación.";
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  async function shareCurrent() {
    const row = state.rowsById.get(state.selectedId);
    if (!row) return;
    const data = { title: `Clima en ${displayName(row)}`, text: `Consultá el clima de ${displayName(row)} en ClimateProyectar.`, url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(window.location.href);
        elements.shareButton.textContent = "Enlace copiado";
        window.setTimeout(() => { elements.shareButton.textContent = "Compartir"; }, 1600);
      }
    } catch { /* acción cancelada */ }
  }

  function showFatal(error) {
    console.error(error);
    elements.resultSection.hidden = true;
    elements.emptyState.hidden = true;
    elements.errorState.hidden = false;
    elements.errorMessage.textContent = error instanceof Error ? error.message : String(error);
    elements.searchStatus.textContent = "No se pudo cargar el catálogo.";
  }

  async function initialize() {
    elements.errorState.hidden = true;
    elements.emptyState.hidden = false;
    try {
      const [config, aliasesValue] = await Promise.all([
        fetchJson(CONFIG_URL),
        fetchJson(ALIASES_URL).catch(() => ({ localities: {} })),
      ]);
      state.config = config;
      state.aliases = aliasesValue.localities || {};

      const catalogManifest = await fetchJson(joinUrl(config.catalog.base_url, config.catalog.manifest || "manifiesto.json"));
      state.catalogManifest = catalogManifest;
      const localityPath = catalogManifest.files?.localities?.path || "localidades.min.json";

      const [localitiesValue, observationsManifest, forecastsManifest] = await Promise.all([
        fetchJson(joinUrl(config.catalog.base_url, localityPath), { cacheKey: "catalog-localities", version: catalogManifest.generated_at }),
        fetchJson(joinUrl(config.observations.base_url, config.observations.manifest || "manifiesto.json"), { cacheKey: "observations-manifest" }),
        fetchJson(joinUrl(config.forecasts.base_url, config.forecasts.manifest || "manifiesto.json"), { cacheKey: "forecasts-manifest" }),
      ]);

      state.rows = unpackCatalog(localitiesValue);
      state.observationsManifest = observationsManifest;
      state.forecastsManifest = forecastsManifest;
      buildSearchIndex();

      const stationsPath = observationsManifest.files?.stations?.path || "estaciones.min.json";
      const stationsValue = await fetchJson(joinUrl(config.observations.base_url, stationsPath), { cacheKey: "observations-stations", version: observationsManifest.generated_at });
      state.stations = stationsValue.records || stationsValue.stations || stationsValue || {};

      elements.localityCount.textContent = `${new Intl.NumberFormat("es-AR").format(state.rows.length)} localidades`;
      elements.searchStatus.textContent = "Escribí al menos dos letras para buscar.";
      updateSourceCard("observations", observationsManifest);
      updateSourceCard("forecasts", forecastsManifest);
      renderRecent();
      loadBackgroundManifests();

      const id = Number(new URL(window.location.href).searchParams.get("id"));
      if (Number.isFinite(id) && state.rowsById.has(id)) selectLocality(id, { skipUrl: true, instant: true });
    } catch (error) {
      showFatal(error);
    }
  }

  elements.searchInput.addEventListener("input", () => {
    const value = elements.searchInput.value;
    elements.clearSearch.hidden = !value;
    if (normalizeText(value).length < 2) {
      hideSuggestions();
      elements.searchStatus.textContent = "Escribí al menos dos letras para buscar.";
      return;
    }
    const rows = searchRows(value);
    renderSuggestions(rows);
    elements.searchStatus.textContent = rows.length ? `${rows.length} coincidencia(s) destacada(s).` : "No encontramos coincidencias.";
  });

  elements.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActiveSuggestion(state.activeSuggestion + 1); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActiveSuggestion(state.activeSuggestion - 1); }
    if (event.key === "Enter") {
      event.preventDefault();
      const row = state.suggestions[state.activeSuggestion >= 0 ? state.activeSuggestion : 0];
      if (row) selectLocality(Number(row[COL.id]));
    }
    if (event.key === "Escape") hideSuggestions();
  });

  elements.clearSearch.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.clearSearch.hidden = true;
    hideSuggestions();
    elements.searchInput.focus();
  });
  elements.locationButton.addEventListener("click", useLocation);
  elements.shareButton.addEventListener("click", shareCurrent);
  elements.retryButton.addEventListener("click", () => window.location.reload());

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-wrap")) hideSuggestions();
    const tabButton = event.target.closest("[data-tab]");
    if (tabButton) openTab(tabButton.dataset.tab);
    const openButton = event.target.closest("[data-open-tab]");
    if (openButton) openTab(openButton.dataset.openTab);
  });

  elements.alertDateFilter.addEventListener("change", () => { renderAlertsList(); renderLocalityAlerts(); refreshAlertMap(); });
  elements.alertEventFilter.addEventListener("change", () => { renderAlertsList(); renderLocalityAlerts(); refreshAlertMap(); });
  elements.radarProduct.addEventListener("change", () => chooseRadarProduct(elements.radarProduct.value));
  elements.radarPrev.addEventListener("click", () => renderFrame("radar", animation.radar.index - 1));
  elements.radarNext.addEventListener("click", () => renderFrame("radar", animation.radar.index + 1));
  elements.radarPlay.addEventListener("click", () => toggleAnimation("radar"));
  elements.satellitePrev.addEventListener("click", () => renderFrame("satellite", animation.satellite.index - 1));
  elements.satelliteNext.addEventListener("click", () => renderFrame("satellite", animation.satellite.index + 1));
  elements.satellitePlay.addEventListener("click", () => toggleAnimation("satellite"));

  window.addEventListener("popstate", (event) => {
    const id = Number(event.state?.localityId || new URL(window.location.href).searchParams.get("id"));
    if (Number.isFinite(id) && state.rowsById.has(id)) selectLocality(id, { skipUrl: true, instant: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation("radar");
      stopAnimation("satellite");
    } else {
      if (animation.radar.playing && animation.radar.frames.length) startAnimation("radar");
      if (animation.satellite.playing && animation.satellite.frames.length) startAnimation("satellite");
    }
  });

  initialize();
})();
