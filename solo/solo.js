"use strict";

let map, streetView, svService;
let correctLatLng = null;
let guessMarker = null;

let round = 0;
let score = 0;

// DOM refs
const roundSpan = document.getElementById("round");
const scoreSpan = document.getElementById("score");
const resultPanel = document.getElementById("resultPanel");
const resultText = document.getElementById("resultText");
const startBtn = document.getElementById("startBtn");

// ---- INIT (called by Google Maps) ----
function initSolo() {
  svService = new google.maps.StreetViewService();

  map = new google.maps.Map(document.getElementById("map"), {
    center: { lat: 20, lng: 0 },
    zoom: 2,
    gestureHandling: "greedy"
  });

  map.addListener("click", onMapClick);

  startBtn.addEventListener("click", startRound);
}

// 🔴 REQUIRED: expose callback globally
window.initSolo = initSolo;

// ---- GAME FLOW ----
function startRound() {
  round++;
  roundSpan.textContent = round;
  resultPanel.style.display = "none";

  if (guessMarker) {
    guessMarker.setMap(null);
    guessMarker = null;
  }

  map.setCenter({ lat: 20, lng: 0 });
  map.setZoom(2);

  pickRandomStreetView();
}

function pickRandomStreetView() {
  const lat = Math.random() * 170 - 85;
  const lng = Math.random() * 360 - 180;

  svService.getPanorama(
    { location: { lat, lng }, radius: 50000 },
    (data, status) => {
      if (status !== "OK") {
        pickRandomStreetView(); // try again
        return;
      }

      correctLatLng = {
        lat: data.location.latLng.lat(),
        lng: data.location.latLng.lng()
      };

      streetView = new google.maps.StreetViewPanorama(
        document.getElementById("streetView"),
        {
          position: correctLatLng,
          pov: { heading: 0, pitch: 0 },
          zoom: 1,
          disableDefaultUI: true,
          clickToGo: false
        }
      );
    }
  );
}

// ---- GUESS HANDLING ----
function onMapClick(e) {
  if (!correctLatLng) return;

  const guess = {
    lat: e.latLng.lat(),
    lng: e.latLng.lng()
  };

  if (guessMarker) guessMarker.setMap(null);

  guessMarker = new google.maps.Marker({
    position: guess,
    map
  });

  scoreGuess(guess);
}

function scoreGuess(guess) {
  const dist = google.maps.geometry.spherical.computeDistanceBetween(
    new google.maps.LatLng(guess.lat, guess.lng),
    new google.maps.LatLng(correctLatLng.lat, correctLatLng.lng)
  );

  const miles = dist / 1609.34;
  const points = miles <= 1 ? 1000 : Math.max(0, 1000 - Math.round(miles));

  score += points;
  scoreSpan.textContent = score;

  // Show correct location
  new google.maps.Marker({
    position: correctLatLng,
    map,
    icon: "http://maps.google.com/mapfiles/ms/icons/green-dot.png"
  });

  resultPanel.style.display = "";
  resultText.innerHTML = `
    Distance: <b>${Math.round(dist)} m</b><br>
    Points: <b>${points}</b>
  `;

  correctLatLng = null;
}
