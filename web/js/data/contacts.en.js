// Public emergency contacts in Korea (English). Built into the app, so they show offline too.
// Mirrors contacts.js: keep the same order, numbers, links and shape.
// When changing a number, confirm it against the agency's official notice.

export const HOTLINE_GROUPS_EN = [
  {
    title: 'Emergency reports',
    items: [
      { number: '119', name: 'Fire & ambulance (fire, rescue, medical)', note: 'Fires, accidents, medical emergencies. Text and video reports also accepted' },
      { number: '112', name: 'Police', note: 'Crime, missing persons, urgent danger' },
      { number: '122', name: 'Korea Coast Guard', note: 'Accidents at sea or on the coast' },
    ],
  },
  {
    title: 'Disaster & everyday safety',
    items: [
      { number: '110', name: 'Government Call Center', note: 'When you don\'t know which agency to ask' },
      { number: '1339', name: 'KDCA call center (disease control)', note: 'Infectious disease symptoms, testing and quarantine guidance' },
      { number: '123', name: 'KEPCO (power faults)', note: 'Power outages, power line accidents' },
      { number: '121', name: 'Water supply fault line', note: 'Water outages, burst pipes (connects to your local waterworks)' },
      { number: '1544-4500', name: 'Korea Gas Safety Corporation', note: 'Suspected gas leaks' },
    ],
  },
  {
    title: 'Family & counseling',
    items: [
      { number: '182', name: 'Missing Children Center', note: 'When a child or a family member with dementia goes missing' },
      { number: '129', name: 'Health & Welfare Call Center', note: 'Emergency welfare and living-cost support' },
      { number: '109', name: 'Suicide prevention hotline', note: 'If you are struggling emotionally after a disaster, 24 hours' },
    ],
  },
];

export const USEFUL_LINKS_EN = [
  { name: 'National Disaster Safety Portal (Safe Korea)', href: 'https://www.safekorea.go.kr', note: 'Find shelters, disaster action guides' },
  { name: 'Safety Didimdol app', href: 'https://www.safekorea.go.kr', note: 'Review past emergency alert texts, nearby shelters (search "안전디딤돌" or "Safety Didimdol" in your app store)' },
  { name: 'KMA Weather Nuri (Korea Meteorological Administration)', href: 'https://www.weather.go.kr', note: 'Typhoon, heavy rain and earthquake warnings' },
];
