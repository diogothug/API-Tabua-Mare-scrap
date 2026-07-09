#!/usr/bin/env node
const http = require('http');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 12000);

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function normalizeNoaaPredictions(predictions) {
  return (predictions || []).map((row) => ({
    time: row.t,
    height_m: Number(row.v),
    type: row.type || null,
    source: 'noaa'
  }));
}

function monthToPtBr(value) {
  const map = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  if (/^\d+$/.test(String(value))) {
    const idx = Number(value);
    if (idx >= 1 && idx <= 12) return map[idx - 1];
    if (idx >= 0 && idx <= 11) return map[idx];
  }
  const normalized = String(value || '').slice(0, 3).toLowerCase();
  const found = map.find((m) => m.toLowerCase() === normalized);
  if (!found) throw new Error('Invalid month. Use 1-12 or Jan/Fev/...');
  return found;
}

function assertNumeric(value, fieldName) {
  if (!/^[-+]?\d+(\.\d+)?$/.test(String(value))) {
    throw new Error(`Invalid numeric value for ${fieldName}`);
  }
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...(options || {}), signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options) {
  const response = await fetchWithTimeout(url, options);
  const payload = await response.json();
  return { response, payload };
}

async function fetchText(url, options) {
  const response = await fetchWithTimeout(url, options);
  const payload = await response.text();
  return { response, payload };
}

async function fetchNoaaTides(params) {
  const station = params.station;
  if (!station) {
    throw new Error('Missing required query param: station (NOAA station id)');
  }

  if (!/^\d+$/.test(String(station))) {
    throw new Error('Invalid station. Expected only digits');
  }

  const beginDate = params.begin_date || params.date || new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const range = params.range || '24';
  const interval = params.interval || 'hilo';
  const units = params.units || 'metric';
  const timeZone = params.time_zone || 'gmt';

  const noaaUrl = new URL('https://api.tidesandcurrents.noaa.gov/api/prod/datagetter');
  noaaUrl.searchParams.set('product', 'predictions');
  noaaUrl.searchParams.set('application', 'api-tabua-mare-scrap');
  noaaUrl.searchParams.set('format', 'json');
  noaaUrl.searchParams.set('datum', 'MLLW');
  noaaUrl.searchParams.set('station', station);
  noaaUrl.searchParams.set('time_zone', timeZone);
  noaaUrl.searchParams.set('units', units);
  noaaUrl.searchParams.set('interval', interval);
  noaaUrl.searchParams.set('begin_date', beginDate);
  noaaUrl.searchParams.set('range', range);

  const { response, payload } = await fetchJson(noaaUrl);

  if (!response.ok || payload.error) {
    throw new Error(payload?.error?.message || 'NOAA request failed');
  }

  return {
    source: 'noaa',
    station,
    datum: 'MLLW',
    interval,
    units,
    time_zone: timeZone,
    data: normalizeNoaaPredictions(payload.predictions)
  };
}

function parseDhnHtml(html) {
  const cleaned = html.replace(/\n+/g, ' ').replace(/\s+/g, ' ');
  const rowRegex = /([0-3]?\d\/[0-1]?\d\/[0-9]{4}).*?([0-2]\d:[0-5]\d).*?(-?\d+[\.,]\d+).*?([0-2]\d:[0-5]\d).*?(-?\d+[\.,]\d+)/g;
  const rows = [];
  let match;

  while ((match = rowRegex.exec(cleaned)) !== null) {
    rows.push({
      date: match[1],
      events: [
        { time: match[2], height_m: Number(match[3].replace(',', '.')) },
        { time: match[4], height_m: Number(match[5].replace(',', '.')) }
      ],
      source: 'dhn_scraping'
    });
  }

  return rows;
}

async function fetchDhnScraping(params) {
  const dhnCode = params.dhn_code;
  const year = params.year || new Date().getFullYear();
  const month = monthToPtBr(params.month || (new Date().getMonth() + 1));

  if (!dhnCode) {
    throw new Error('Missing required query param: dhn_code (ex.: 40140)');
  }

  if (!/^\d+$/.test(String(dhnCode))) {
    throw new Error('Invalid dhn_code. Expected only digits');
  }

  const url = `https://www.mar.mil.br/dhn/chm/box-previsao-mare/tabuas/${dhnCode}${month}${year}.htm`;
  const { response, payload } = await fetchText(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 API-Tabua-Mare-Integration'
    }
  });

  if (!response.ok) {
    throw new Error(`DHN scraping failed with status ${response.status}`);
  }

  const parsed = parseDhnHtml(payload);

  return {
    source: 'dhn_scraping',
    dhn_code: dhnCode,
    year: Number(year),
    month,
    fetched_url: url,
    records: parsed,
    raw_size: payload.length
  };
}

async function fetchMarineOpenMeteo(params) {
  const latitude = params.lat;
  const longitude = params.lon;

  if (!latitude || !longitude) {
    throw new Error('Missing required query params: lat, lon');
  }

  assertNumeric(latitude, 'lat');
  assertNumeric(longitude, 'lon');

  const marineUrl = new URL('https://marine-api.open-meteo.com/v1/marine');
  marineUrl.searchParams.set('latitude', latitude);
  marineUrl.searchParams.set('longitude', longitude);
  marineUrl.searchParams.set('hourly', 'wave_height,wave_direction,wave_period,sea_surface_temperature');
  marineUrl.searchParams.set('timezone', params.timezone || 'UTC');

  const { response, payload } = await fetchJson(marineUrl);

  if (!response.ok || payload.error) {
    throw new Error(payload?.reason || 'Open-Meteo marine request failed');
  }

  return {
    source: 'openmeteo_marine',
    latitude: Number(latitude),
    longitude: Number(longitude),
    timezone: payload.timezone,
    hourly: payload.hourly
  };
}

function listSources() {
  return [
    {
      key: 'noaa',
      type: 'tide_api',
      description: 'NOAA CO-OPS Tides & Currents API (public)'
    },
    {
      key: 'dhn_scraping',
      type: 'scraping',
      description: 'Scraping da tabela de maré da Marinha do Brasil (DHN/CHM)'
    },
    {
      key: 'openmeteo_marine',
      type: 'marine_api',
      description: 'Open-Meteo Marine API para variáveis oceânicas (ondas/temperatura)'
    }
  ];
}

async function routeRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      error: 'Method not allowed',
      allowed_methods: ['GET', 'OPTIONS']
    });
  }

  const requestUrl = new URL(req.url, `http://${req.headers.host}`);

  if (requestUrl.pathname === '/api/v1/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'api-tabua-mare-integration',
      timeout_ms: REQUEST_TIMEOUT_MS,
      timestamp: new Date().toISOString()
    });
  }

  if (requestUrl.pathname === '/api/v1/sources') {
    return sendJson(res, 200, { sources: listSources() });
  }

  if (requestUrl.pathname === '/api/v1/tides') {
    const params = Object.fromEntries(requestUrl.searchParams.entries());
    const source = params.source || 'auto';

    try {
      if (source === 'noaa') {
        return sendJson(res, 200, await fetchNoaaTides(params));
      }

      if (source === 'dhn_scraping') {
        return sendJson(res, 200, await fetchDhnScraping(params));
      }

      const errors = [];

      if (params.station) {
        try {
          const noaa = await fetchNoaaTides(params);
          return sendJson(res, 200, noaa);
        } catch (error) {
          errors.push({ source: 'noaa', message: error.message });
        }
      }

      if (params.dhn_code) {
        try {
          const dhn = await fetchDhnScraping(params);
          return sendJson(res, 200, dhn);
        } catch (error) {
          errors.push({ source: 'dhn_scraping', message: error.message });
        }
      }

      return sendJson(res, 502, {
        error: 'Unable to load tide data from available sources',
        hint: 'Use ?source=noaa&station=... or ?source=dhn_scraping&dhn_code=...&month=...&year=...',
        attempts: errors
      });
    } catch (error) {
      return sendJson(res, 500, {
        error: 'Unexpected tide API failure',
        message: error.message
      });
    }
  }

  if (requestUrl.pathname === '/api/v1/marine') {
    const params = Object.fromEntries(requestUrl.searchParams.entries());

    try {
      return sendJson(res, 200, await fetchMarineOpenMeteo(params));
    } catch (error) {
      return sendJson(res, 502, {
        error: 'Failed to fetch marine conditions',
        message: error.message
      });
    }
  }

  sendJson(res, 404, {
    error: 'Not found',
    routes: ['/api/v1/health', '/api/v1/sources', '/api/v1/tides', '/api/v1/marine']
  });
}

const server = http.createServer((req, res) => {
  routeRequest(req, res).catch((error) => {
    sendJson(res, 500, {
      error: 'Unhandled server error',
      message: error.message
    });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`API Tabua Mare integration server listening on http://localhost:${PORT}`);
  });
}

module.exports = {
  normalizeNoaaPredictions,
  monthToPtBr,
  parseDhnHtml,
  listSources,
  fetchNoaaTides,
  fetchDhnScraping,
  fetchMarineOpenMeteo,
  routeRequest,
  server
};
