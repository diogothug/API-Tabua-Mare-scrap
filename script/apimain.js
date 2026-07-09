var TIDE_CACHE_STORE_KEY = "tide-cache-v2";
var TIDE_CACHE_MAX_BYTES = 3 * 1024 * 1024;

function startAPI(idlocation, dir){
      var prefix = dir || "";

      if (!arrLocations[idlocation]) {
        throw new Error("Invalid location id: " + idlocation);
      }

      var locationData = arrLocations[idlocation];
      var input = document.getElementById("input");
      var processor = document.getElementById("processor");
      var candidates = buildFileCandidates(prefix, locationData.url);

      if (window.__tideApiMessageHandler) {
        window.removeEventListener("message", window.__tideApiMessageHandler, true);
      }

      window.__tideApiMessageHandler = function(event){
        if (event.source != processor.contentWindow) return;

        switch (event.data){
          case "ready":
            loadPdfWithFallback(candidates, function(resolvedFile, response) {
              input.src = resolvedFile;
              console.log(resolvedFile);
              processor.contentWindow.postMessage(response, "*");
            }, function() {
              deliverCachedTideData(idlocation);
            });
          break;

          default:
            var parsed = parseText(event.data.replace(/\s+/g, " "));
            if (parsed && parsed.length) {
              cacheTideData(idlocation, parsed);
              APIready(parsed);
            } else {
              deliverCachedTideData(idlocation);
            }
          break;
        }
      };

      window.addEventListener("message", window.__tideApiMessageHandler, true);
}

function buildFileCandidates(prefix, fileUrl) {
  var candidates = [];
  var filename = fileUrl.substring(fileUrl.lastIndexOf("/") + 1);
  var sources = resolveDataSources();

  candidates.push(prefix + fileUrl);

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];

    if (source.type === "localFolder") {
      candidates.push(prefix + source.value + "/" + filename);
    }

    if (source.type === "baseUrl") {
      candidates.push(source.value + filename);
    }
  }

  return uniqueArray(candidates);
}

function resolveDataSources(){
  if (typeof tideDataSources !== "undefined" && tideDataSources && tideDataSources.length) {
    return tideDataSources;
  }

  return [
    {type: "localFolder", value: "tables2021"},
    {type: "localFolder", value: "tables2023"}
  ];
}

function uniqueArray(values){
  var unique = [];
  for (var i = 0; i < values.length; i++) {
    if (unique.indexOf(values[i]) === -1) {
      unique.push(values[i]);
    }
  }
  return unique;
}

function loadPdfWithFallback(candidates, onSuccess, onError){
  function tryLoad(index){
    if (index >= candidates.length) {
      onError();
      return;
    }

    var xhr = new XMLHttpRequest();
    xhr.open("GET", candidates[index], true);
    xhr.responseType = "arraybuffer";

    xhr.onload = function() {
      if (xhr.status >= 200 && xhr.status < 300 && xhr.response && xhr.response.byteLength > 0) {
        onSuccess(candidates[index], xhr.response);
      } else {
        tryLoad(index + 1);
      }
    };

    xhr.onerror = function() {
      tryLoad(index + 1);
    };

    xhr.send();
  }

  tryLoad(0);
}

function encodeCompactTideRows(data){
  var rows = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i] || {};
    rows.push([
      row.date || null,
      row.day || null,
      row.hour1 || null,
      row.height1 || null,
      row.hour2 || null,
      row.height2 || null,
      row.hour3 || null,
      row.height3 || null,
      row.hour4 || null,
      row.height4 || null
    ]);
  }
  return rows;
}

function decodeCompactTideRows(compactRows){
  var rows = [];
  for (var i = 0; i < compactRows.length; i++) {
    var row = compactRows[i];
    rows.push({
      date: row[0],
      day: row[1],
      hour1: row[2],
      height1: row[3],
      hour2: row[4],
      height2: row[5],
      hour3: row[6],
      height3: row[7],
      hour4: row[8],
      height4: row[9]
    });
  }
  return rows;
}

function getUtf8ByteSize(text){
  try {
    return new TextEncoder().encode(text).length;
  } catch (error) {
    return text.length * 2;
  }
}

function trimCacheToLimit(store){
  var keys = Object.keys(store);
  var serialized = JSON.stringify(store);
  var totalBytes = getUtf8ByteSize(serialized);

  if (totalBytes <= TIDE_CACHE_MAX_BYTES) {
    return store;
  }

  keys.sort(function(a, b){
    return (store[a].updatedAt || 0) - (store[b].updatedAt || 0);
  });

  while (keys.length && totalBytes > TIDE_CACHE_MAX_BYTES) {
    var oldestKey = keys.shift();
    delete store[oldestKey];
    serialized = JSON.stringify(store);
    totalBytes = getUtf8ByteSize(serialized);
  }

  return store;
}

function readCompactCacheStore(){
  if (!window.localStorage) return {};

  try {
    var raw = localStorage.getItem(TIDE_CACHE_STORE_KEY);
    if (!raw) return {};

    var parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch (error) {
    console.warn("Unable to read tide compact cache", error);
  }

  return {};
}

function writeCompactCacheStore(store){
  if (!window.localStorage) return;

  try {
    var trimmed = trimCacheToLimit(store);
    localStorage.setItem(TIDE_CACHE_STORE_KEY, JSON.stringify(trimmed));
  } catch (error) {
    console.warn("Unable to persist tide compact cache", error);
  }
}

function cacheTideData(idlocation, data){
  if (!window.localStorage) return;

  var compactRows = encodeCompactTideRows(data);
  var store = readCompactCacheStore();

  store[String(idlocation)] = {
    updatedAt: Date.now(),
    rows: compactRows
  };

  writeCompactCacheStore(store);
}

function readLegacyCache(idlocation){
  try {
    var legacy = localStorage.getItem("tide-cache-" + idlocation);
    if (!legacy) return null;

    var parsedLegacy = JSON.parse(legacy);
    if (parsedLegacy && parsedLegacy.length) {
      cacheTideData(idlocation, parsedLegacy);
      return parsedLegacy;
    }
  } catch (error) {
    console.warn("Unable to read legacy tide cache", error);
  }

  return null;
}

function deliverCachedTideData(idlocation){
  if (!window.localStorage) return false;

  try {
    var store = readCompactCacheStore();
    var bucket = store[String(idlocation)];

    if (bucket && bucket.rows && bucket.rows.length) {
      APIready(decodeCompactTideRows(bucket.rows));
      return true;
    }

    var legacyData = readLegacyCache(idlocation);
    if (legacyData) {
      APIready(legacyData);
      return true;
    }
  } catch (error) {
    console.warn("Unable to load cached tide data", error);
  }

  return false;
}
