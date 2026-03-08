function startAPI(idlocation, dir){
      var prefix = dir || "";

      if (!arrLocations[idlocation]) {
        throw new Error("Invalid location id: " + idlocation);
      }

      var namefile = prefix + arrLocations[idlocation].url;
      console.log(namefile);

      var input = document.getElementById("input");
      input.src = namefile;

      var processor = document.getElementById("processor");

      window.addEventListener("message", function(event){
        if (event.source != processor.contentWindow) return;

        switch (event.data){
          case "ready":
            var xhr = new XMLHttpRequest();
            xhr.open("GET", input.getAttribute("src"), true);
            xhr.responseType = "arraybuffer";

            xhr.onload = function() {
              processor.contentWindow.postMessage(this.response, "*");
            };

            xhr.send();
          break;

          default:
            APIready(parseText(event.data.replace(/\s+/g, " ")));
          break;
        }
      }, true);
}
