export default function handler(_request, response) {
  // 브라우저용 키는 Google Cloud Console에서 이 배포 도메인으로 HTTP referrer 제한을 걸어야 합니다.
  const apiKey = process.env.GOOGLE_MAPS_BROWSER_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return response.status(503).json({ message: 'Google Maps 브라우저 API 키 설정이 필요합니다.' });
  response.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return response.status(200).json({ apiKey });
}
