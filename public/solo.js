// Make initSolo global so Google Maps can call it
window.initSolo = function() {
  let pickerLatLng = null;
  let round = 0;
  let score = 0;

  const streetViewDiv = document.getElementById('streetView');
  const mapDiv = document.getElementById('map');
  const startBtn = document.getElementById('startBtn');
  const roundSpan = document.getElementById('round');
  const scoreSpan = document.getElementById('score');
  const resultPanel = document.getElementById('resultPanel');
  const resultText = document.getElementById('resultText');

  let svPanorama, map, marker;

  function startRound() {
    round++;
    roundSpan.textContent = round;
    resultPanel.style.display = 'none';

    // Pick random lat/lng
    const lat = (Math.random() - 0.5) * 180;
    const lng = (Math.random() - 0.5) * 360;
    pickerLatLng = { lat, lng };

    // Street View
    svPanorama = new google.maps.StreetViewPanorama(streetViewDiv, {
      position: pickerLatLng,
      pov: { heading: 0, pitch: 0 },
      zoom: 1,
      disableDefaultUI: true,
    });

    // Map
    map = new google.maps.Map(mapDiv, {
      center: { lat: 0, lng: 0 },
      zoom: 2,
    });

    if(marker) marker.setMap(null);
    marker = null;
  }

  startBtn.onclick = () => {
    startRound();

    map.addListener('click', e => {
      if(marker) marker.setMap(null);
      marker = new google.maps.Marker({
        position: { lat: e.latLng.lat(), lng: e.latLng.lng() },
        map: map
      });

      // Calculate distance
      const dist = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(e.latLng.lat(), e.latLng.lng()),
        new google.maps.LatLng(pickerLatLng.lat, pickerLatLng.lng)
      );

      // Update score
      const points = Math.max(0, 1000 - Math.round(dist / 1609.34));
      score += points;
      scoreSpan.textContent = score;

      resultText.innerHTML = `Distance: ${Math.round(dist)} m — Points: ${points}`;
      resultPanel.style.display = '';
    });
  };
};
