const featureClipSources = [
  'assets/feature-clips/route-planning.png',
  'assets/feature-clips/budget-ledger.png',
  'assets/feature-clips/trip-checklist.png',
  'assets/feature-clips/safety-guide.png',
];

document.querySelectorAll('.mini .icon').forEach((slot, index) => {
  const image = document.createElement('img');
  image.src = featureClipSources[index];
  image.alt = '';
  image.loading = 'lazy';
  slot.replaceChildren(image);
  slot.classList.add('feature-clip');
});
