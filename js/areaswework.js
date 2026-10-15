const schools = [
  { name: 'PUPS Bettamugilalam', block: 'Kelamangalam', village: 'Bettamugilalam', students: 59, lat: 12.368930555555556, lng: 77.91008055555557 },
  { name: 'PUMS Kottaiyur', block: 'Kelamangalam', village: 'Kottaiyur', students: 172, lat: 12.376402777777779, lng: 77.87935277777777 },
  { name: 'PUMS Siddapuram', block: 'Kelamangalam', village: 'Siddapuram', students: 155, lat: 12.3657, lng: 77.88815277777779 },
  { name: 'PUMS Bollakollai', block: 'Kelamangalam', village: 'Bollakollai', students: 162, lat: 12.356819444444444, lng: 77.89015833333335 },
  { name: 'GHS Kodagarai', block: 'Thally', village: 'Kodagarai', students: 127, lat: 12.295530555555555, lng: 77.86153333333333 },
  { name: 'PUPS Kodagarai', block: 'Thally', village: 'Kodagarai', students: 122, lat: 12.290627777777777, lng: 77.86082222222221 },
  { name: 'PUPS Kotchavur', block: 'Thally', village: 'Kotchavur', students: 61, lat: 12.303291666666667, lng: 77.86097222222222 }
];

const map = L.map('school-map', { scrollWheelZoom: false, zoomControl: false });
const standardLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' });
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: 'Tiles &copy; Esri' });
const satelliteRoads = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { attribution: 'Road data &copy; Esri' });
const satellitePlaces = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { attribution: 'Places &copy; Esri' });
const satelliteReferenceOverlay = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}', { attribution: 'Reference data &copy; Esri' });
const satelliteReference = L.layerGroup([satelliteRoads, satellitePlaces, satelliteReferenceOverlay]);
satelliteLayer.addTo(map);
satelliteReference.addTo(map);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.control.layers({ 'Standard map': standardLayer, 'Satellite view': satelliteLayer }, { 'Roads and place names': satelliteReference }, { position: 'topright' }).addTo(map);

const bounds = L.latLngBounds();
const labels = document.getElementById('map-school-labels');
const shownPlaces = new Set();

schools.forEach((school, index) => {
  const position = [school.lat, school.lng];
  bounds.extend(position);
  const marker = L.marker(position, { icon: L.divIcon({ className: '', html: `<div class="school-pin"><span>${index + 1}</span></div>`, iconSize: [30, 30], iconAnchor: [8, 27], popupAnchor: [7, -25] }) }).addTo(map);
  marker.bindPopup(`<div class="map-popup"><h3>${school.name}</h3><p>${school.village}, ${school.block}<br>${school.students} students listed</p><a href="https://www.google.com/maps/search/?api=1&query=${school.lat},${school.lng}" target="_blank" rel="noopener">Open in Google Maps ↗</a></div>`);
  school.marker = marker;

  if (!shownPlaces.has(school.village)) {
    L.marker(position, { interactive: false, zIndexOffset: -100, icon: L.divIcon({ className: 'place-name-icon', html: `<span>${school.village}</span>`, iconSize: [0, 0], iconAnchor: [-10, 8] }) }).addTo(map);
    shownPlaces.add(school.village);
  }

  const label = document.createElement('button');
  label.className = 'map-school-label';
  label.type = 'button';
  label.innerHTML = `<span>${index + 1}</span>${school.name}`;
  label.addEventListener('click', () => {
    map.setView(position, 14, { animate: true });
    school.marker.openPopup();
  });
  labels.appendChild(label);
});

map.fitBounds(bounds, { padding: [28, 28] });