export default async function handler(request, response) {
  const input = String(request.query.input || '').trim();
  if (input.length < 2) return response.status(200).json({ suggestions: [] });
  if (!process.env.GOOGLE_MAPS_API_KEY) {
    return response.status(503).json({ message: '목적지 검색 서비스 설정이 필요합니다.' });
  }

  try {
    const placesResponse = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      },
      body: JSON.stringify({
        input,
        includedPrimaryTypes: ['(regions)'],
        languageCode: 'ko',
        regionCode: 'KR',
      }),
    });
    const payload = await placesResponse.json();
    if (!placesResponse.ok) throw new Error(payload.error?.message || 'Places API error');

    const suggestions = (payload.suggestions || [])
      .map(({ placePrediction }) => placePrediction)
      .filter(Boolean)
      .map((place) => ({
        name: place.text?.text || place.structuredFormat?.mainText?.text,
        secondaryText: place.structuredFormat?.secondaryText?.text || '',
      }))
      .filter((place) => place.name)
      .slice(0, 6);

    response.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
    return response.status(200).json({ suggestions });
  } catch {
    return response.status(502).json({ message: 'Google Places 자동완성을 불러오지 못했습니다.' });
  }
}
