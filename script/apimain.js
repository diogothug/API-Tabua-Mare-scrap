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
  var bareUrl = fileUrl;

  candidates.push(prefix + bareUrl);

  if (bareUrl.indexOf("tables2021/") === 0) {
    candidates.push(prefix + bareUrl.replace("tables2021/", "tables2023/"));
  }

  if (bareUrl.indexOf("tables2023/") === 0) {
    candidates.push(prefix + bareUrl.replace("tables2023/", "tables2021/"));
  }

  return uniqueArray(candidates);
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

function cacheTideData(idlocation, data){
  if (!window.localStorage) return;

  try {
    localStorage.setItem("tide-cache-" + idlocation, JSON.stringify(data));
  } catch (error) {
    console.warn("Unable to cache tide data", error);
  }
}

function deliverCachedTideData(idlocation){
  if (!window.localStorage) return false;

  try {
    var cached = localStorage.getItem("tide-cache-" + idlocation);
    if (!cached) return false;

    var parsedCache = JSON.parse(cached);
    if (parsedCache && parsedCache.length) {
      APIready(parsedCache);
      return true;
    }
  } catch (error) {
    console.warn("Unable to load cached tide data", error);
  }

  return false;
}
