function pointFromLocation(location) {
  const lat = Number(location?.latitude ?? location?.lat);
  const lng = Number(location?.longitude ?? location?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null;
}

function cleanPoint(point = {}) {
  return {
    place: String(point.place || '').slice(0, 180),
    address: String(point.address || '').slice(0, 300),
    city: String(point.city || '').slice(0, 120),
    location: pointFromLocation(point.location)
  };
}

async function resolvePoint(point, apiKey) {
  if (point.location) return point;
  const textQuery = [point.place, point.address, point.city].filter(Boolean).join(', ');
  if (!textQuery) return null;
  const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.googleMapsUri'
    },
    body: JSON.stringify({ textQuery, languageCode: 'ko', maxResultCount: 1 })
  });
  const payload = await upstream.json();
  if (!upstream.ok || !payload.places?.[0]?.location) return null;
  const place = payload.places[0];
  return {
    ...point,
    place: place.displayName?.text || point.place,
    address: place.formattedAddress || point.address,
    mapsUrl: place.googleMapsUri || null,
    location: pointFromLocation(place.location)
  };
}

function durationSeconds(value = '') {
  const match = String(value).match(/([0-9.]+)s/);
  return match ? Math.round(Number(match[1])) : 0;
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ message: 'POST 요청만 지원합니다.' });
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return response.status(503).json({ message: 'GOOGLE_MAPS_API_KEY 설정이 필요합니다.' });

  try {
    const requested = Array.isArray(request.body?.points) ? request.body.points.slice(0, 25).map(cleanPoint) : [];
    if (requested.length < 2) return response.status(400).json({ message: '경로에는 좌표가 있는 장소가 2곳 이상 필요합니다.' });
    const resolved = [];
    for (const point of requested) {
      const result = await resolvePoint(point, apiKey);
      if (!result?.location) continue;
      const previous = resolved.at(-1);
      if (previous && previous.location.latitude === result.location.latitude && previous.location.longitude === result.location.longitude) continue;
      resolved.push(result);
    }
    if (resolved.length < 2) return response.status(422).json({ message: '지도에 표시할 수 있는 장소 좌표를 충분히 찾지 못했습니다.', stops: resolved });

    const routeRequest = {
      origin: { location: { latLng: resolved[0].location } },
      destination: { location: { latLng: resolved.at(-1).location } },
      intermediates: resolved.slice(1, -1).map(point => ({ location: { latLng: point.location } })),
      travelMode: 'DRIVE',
      routingPreference: 'TRAFFIC_UNAWARE',
      polylineQuality: 'HIGH_QUALITY',
      polylineEncoding: 'ENCODED_POLYLINE',
      computeAlternativeRoutes: false,
      languageCode: 'ko',
      units: 'METRIC'
    };
    const upstream = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.legs.duration,routes.legs.distanceMeters'
      },
      body: JSON.stringify(routeRequest)
    });
    const payload = await upstream.json();
    if (!upstream.ok || !payload.routes?.[0]) throw new Error(payload.error?.message || 'Routes API 경로를 찾지 못했습니다.');
    const route = payload.routes[0];
    return response.status(200).json({
      stops: resolved,
      encodedPolyline: route.polyline?.encodedPolyline || null,
      distanceMeters: Number(route.distanceMeters || 0),
      durationSeconds: durationSeconds(route.duration),
      legs: (route.legs || []).map(leg => ({ distanceMeters: Number(leg.distanceMeters || 0), durationSeconds: durationSeconds(leg.duration) }))
    });
  } catch (error) {
    return response.status(502).json({ message: 'Routes API 경로를 불러오지 못했습니다.', detail: error.message });
  }
}
