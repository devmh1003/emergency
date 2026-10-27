// Default emergency protocols (English).
// Mirrors protocols.js item for item: keep the same order, ids, keys and array lengths.
// Checklist item ids are the keys that store checked state, so never change them.

const NOW = 'Right now';
const HOURS = 'Within a few hours';
const DAYS = 'Over the next few days';

export const DEFAULT_PROTOCOLS_EN = [
  {
    id: 'basics',
    order: 1,
    icon: '📌',
    title: 'Ground rules (our family promise)',
    summary: 'The promises our whole family keeps, whatever the emergency.',
    keyPoints: ['Even if you can\'t reach anyone, go to meeting place #1', 'Tap "I\'m safe" first — if that fails, send a text', 'If the agreed time passes, move on to the next meeting place'],
    steps: [
      { phase: NOW, items: [
        'Get yourself safe first. Leave the dangerous area before anything else.',
        'Tap "I\'m safe" on this site. If there is no internet, use "Send by text".',
        'Texts get through more reliably than calls. Only call when you really need to, and keep it short.',
        'Follow emergency alert text messages, TV and radio disaster broadcasts (KBS), and instructions from officials, the military and the police.',
      ] },
      { phase: HOURS, items: [
        'Even if you can\'t reach anyone, go to meeting place #1 as agreed. If not everyone has arrived by the agreed time, move on to the next meeting place.',
        'When you reach a meeting place, use "Leave a note" to record your arrival time and what you will do next.',
        'Save your phone battery: turn on power-saving mode, set the screen brightness to minimum, and close apps you are not using.',
      ] },
      { phase: DAYS, items: [
        'Check in again every day at 9 a.m. and 9 p.m.',
        'Each time you move, use "Save checkpoint" to record where you have been.',
        'If a family member is still out of contact, report it to 112 or 119, or to your local city/county/district disaster response headquarters.',
      ] },
    ],
    checklist: [
      { id: 'b1', text: 'I added this site to my phone\'s home screen and turned on notifications' },
      { id: 'b2', text: 'I printed the emergency card and put it in my wallet and backpack' },
      { id: 'b3', text: 'I wrote down family phone numbers on paper' },
      { id: 'b4', text: 'I have walked the route to meeting places #1–#3 myself' },
      { id: 'b5', text: 'I know where the nearest civil defense shelter is (Safety Didimdol app)' },
      { id: 'b6', text: 'I always keep a power bank charged' },
      { id: 'b7', text: 'I registered my medical info (conditions, medications, allergies)' },
    ],
  },
  {
    id: 'gobag',
    order: 2,
    icon: '🎒',
    title: 'Emergency go-bag',
    summary: 'The bag you grab when you have to leave home right away. Prepare one per person.',
    keyPoints: ['One bag per person, kept near the front door', 'Check expiry dates on water, food and medicine every 6 months', 'Always include cash and a paper list of family contacts'],
    steps: [
      { phase: 'Ahead of time', items: [
        'Keep it near the front door, and check expiry dates on water, food and medicine every 6 months.',
        'Keep it light enough that you can carry it and walk for at least an hour.',
      ] },
    ],
    checklist: [
      { id: 'g1', text: 'Water (at least 2 L per person per day, for 3 days)' },
      { id: 'g2', text: 'Emergency food for 3 days (energy bars, canned food, hard crackers)' },
      { id: 'g3', text: 'Flashlight and spare batteries' },
      { id: 'g4', text: 'Portable radio' },
      { id: 'g5', text: 'Power bank and charging cable' },
      { id: 'g6', text: 'First-aid medicine and prescription drugs (at least 1 week\'s supply)' },
      { id: 'g7', text: 'Masks (KF94)' },
      { id: 'g8', text: 'Cash (mostly small bills)' },
      { id: 'g9', text: 'Copy of your ID and a paper list of family contacts' },
      { id: 'g10', text: 'Raincoat and an emergency (foil) blanket' },
      { id: 'g11', text: 'Whistle' },
      { id: 'g12', text: 'Wet wipes, tissues, hygiene products' },
      { id: 'g13', text: 'A change of clothes and socks' },
      { id: 'g14', text: 'Work gloves, multi-tool knife' },
      { id: 'g15', text: 'Family photo (helps others find you if someone goes missing)' },
    ],
  },
  {
    id: 'war',
    order: 3,
    icon: '🚨',
    title: 'War / air raid',
    summary: 'The air raid alarm is a siren that rises and falls for 3 minutes. Take shelter underground.',
    keyPoints: ['Air raid alarm (3-minute wavering siren): go underground at once', 'Do not go outside until the all-clear', 'If ordered to evacuate, take your go-bag and follow the announced route'],
    steps: [
      { phase: NOW, items: [
        'Go to the nearest underground shelter. Subway stations, underground parking garages and building basements serve as shelters.',
        'If you cannot get underground, go to a windowless spot in the middle of a sturdy building.',
        'If you are driving, pull over to the right side of the road, leave the key in the car and take shelter.',
        'Shut off the gas and electricity when you leave home.',
        'Check in once you reach the shelter.',
      ] },
      { phase: HOURS, items: [
        'Do not go outside until the alarm is lifted.',
        'Follow the situation on the radio and emergency alert texts, and follow instructions from civil defense, the military and the police.',
        'Once it is confirmed safe, head to the meeting place.',
      ] },
      { phase: DAYS, items: [
        'If an evacuation order is issued, take your go-bag and follow the announced route.',
        'Check with your local community service center for water and food distribution and temporary housing.',
        'Save a checkpoint each time you move.',
      ] },
    ],
    checklist: [
      { id: 'w1', text: 'I know where the shelters near home and work/school are' },
      { id: 'w2', text: 'I can tell apart the alert, air raid and CBRN (chemical/biological/radiological) warning sirens' },
      { id: 'w3', text: 'My go-bag is ready' },
      { id: 'w4', text: 'I keep cash and ID where I can grab them quickly' },
    ],
  },
  {
    id: 'cbrn',
    order: 4,
    icon: '☢️',
    title: 'Chemical, biological, nuclear',
    summary: 'Toxic gas collects in low places; shelter indoors from radioactive fallout.',
    keyPoints: ['Chemical: move upwind or to the side, and to upper floors of a building', 'Nuclear flash: drop down, cover eyes and ears, keep your mouth open', 'Fallout: stay in the middle of a building for at least 24 hours'],
    steps: [
      { phase: NOW, items: [
        'Put on a gas mask. If you don\'t have one, cover your nose and mouth with a wet towel or a mask.',
        'Chemical attack: get away from the gas by moving upwind or to the side, and go to an upper floor of a building. Gas collects in low places.',
        'If you see the flash of a nuclear explosion, drop down immediately, cover your eyes and ears and keep your mouth open. Once the blast wave has passed, get underground or into the middle of a building.',
        'Radioactive fallout: stay underground or in the middle of a building for at least 24 hours. Close windows and vents and seal them with tape.',
      ] },
      { phase: HOURS, items: [
        'If you were outside, take off your outer clothes and seal them in a plastic bag, then wash your body and hair with soap.',
        'Do not eat or drink any food or water that was not sealed.',
        'Listen to the radio for official instructions.',
      ] },
      { phase: DAYS, items: [
        'Move only when the authorities order an evacuation, and keep your skin covered when you do.',
      ] },
    ],
    checklist: [
      { id: 'c1', text: 'Gas mask or KF94 masks' },
      { id: 'c2', text: 'Plastic sheeting and tape to seal windows' },
      { id: 'c3', text: 'Large plastic bags (for contaminated clothing)' },
      { id: 'c4', text: 'Sealed bottled water' },
    ],
  },
  {
    id: 'earthquake',
    order: 5,
    icon: '🌏',
    title: 'Earthquake',
    summary: 'Protect yourself while it shakes; when it stops, move to a wide open space.',
    keyPoints: ['While shaking: get under a table, protect your head', 'When it stops: shut off gas and power, take the stairs outside', 'Go to a wide open space away from buildings and signs'],
    steps: [
      { phase: NOW, items: [
        'While it shakes, get under a table, protect your head and hold on tight to a table leg.',
        'When the shaking stops, shut off the gas and electricity and open the door to keep an exit clear.',
        'Do not use elevators; take the stairs.',
        'Outside, stay away from buildings, utility poles and signs, and go to a wide open space such as a sports field or park.',
        'Check in once you are somewhere safe.',
      ] },
      { phase: HOURS, items: [
        'Aftershocks may follow, so do not enter cracked buildings.',
        'If you are near the coast, check for tsunami warnings and move to high ground.',
        'Head to the meeting place.',
      ] },
      { phase: DAYS, items: [
        'Do not go back into your home until it has passed a safety inspection.',
        'Check the temporary housing your local government provides.',
      ] },
    ],
    checklist: [
      { id: 'e1', text: 'Heavy furniture and appliances are secured to the wall' },
      { id: 'e2', text: 'Nothing can fall onto the beds' },
      { id: 'e3', text: 'Everyone in the family knows where the gas valve and the circuit breaker box are' },
      { id: 'e4', text: 'I know our outdoor earthquake evacuation site' },
    ],
  },
  {
    id: 'flood',
    order: 6,
    icon: '🌊',
    title: 'Typhoon / flood',
    summary: 'Get out of basements and low ground first. Move before the water rises.',
    keyPoints: ['Leave semi-basement homes, underground parking and underpasses at once', 'Never cross moving water, even if it is only ankle-deep', 'If your car starts to flood, get out before the water is halfway up the wheels'],
    steps: [
      { phase: NOW, items: [
        'Leave semi-basement homes, underground parking garages, underpasses and riversides immediately and go to higher ground.',
        'If water gets into a basement, get out before it reaches knee height. Once it rises, water pressure can keep the door from opening.',
        'If your car starts to flood, get out before the water is halfway up the wheels. If the door won\'t open, break a corner of the window with the metal rods of the headrest.',
        'Stay away from fallen power lines and flooded electrical equipment.',
        'Check in.',
      ] },
      { phase: HOURS, items: [
        'Never walk through moving water, even if it is only ankle-deep.',
        'Avoid hillsides and retaining walls because of the risk of landslides.',
        'If the meeting place is in a flooded area, go straight to the next one.',
      ] },
      { phase: DAYS, items: [
        'Throw away any food that was underwater, and boil tap water before drinking it.',
        'Before going home, check for gas leaks and electrical safety.',
      ] },
    ],
    checklist: [
      { id: 'f1', text: 'I turned on weather warning and emergency alert notifications' },
      { id: 'f2', text: 'I cleared the drains around the house' },
      { id: 'f3', text: 'I keep an emergency escape hammer in the car' },
      { id: 'f4', text: 'I know the flood-prone areas in our neighborhood' },
    ],
  },
  {
    id: 'fire',
    order: 7,
    icon: '🔥',
    title: 'Fire / wildfire',
    summary: 'Stay low to avoid the smoke and get out by the stairs.',
    keyPoints: ['Shout "Fire!" and call 119 — no elevators', 'Cover your nose and mouth with a wet towel and stay low', 'If a door handle is hot, take another way out'],
    steps: [
      { phase: NOW, items: [
        'Shout "Fire!" loudly, press the fire alarm, then call 119.',
        'Cover your nose and mouth with a wet towel, stay low and go down the stairs. Do not take the elevator.',
        'Before opening a door, touch the handle; if it is hot, take another way out.',
        'If you cannot go down, head to the roof or to your apartment\'s evacuation space or breakable partition wall (to the next unit).',
        'Wildfire: move away from the direction the wind is blowing, to an area that has already burned or a wide open space.',
      ] },
      { phase: HOURS, items: [
        'Do not go back inside until you are told the fire is out.',
        'Check in and head to the meeting place.',
      ] },
    ],
    checklist: [
      { id: 'r1', text: 'We have a fire extinguisher at home and I know how to use it' },
      { id: 'r2', text: 'I know where our apartment\'s evacuation space or breakable partition wall is' },
      { id: 'r3', text: 'Our smoke detectors work' },
    ],
  },
  {
    id: 'pandemic',
    order: 8,
    icon: '🦠',
    title: 'Infectious disease',
    summary: 'Follow guidance from the Korea Disease Control and Prevention Agency (1339), and keep your distance from family if you have symptoms.',
    keyPoints: ['Follow KDCA (1339) guidance', 'If you have symptoms, use a separate room and dishes', 'Even if you can\'t meet, share how you are with a daily check-in'],
    steps: [
      { phase: NOW, items: [
        'Check guidance from the KDCA and your local government. Call 1339 for advice.',
        'If you have symptoms, stop going out and get tested as instructed.',
        'Wear a KF94 mask and wash your hands with soap for at least 30 seconds.',
      ] },
      { phase: HOURS, items: [
        'If someone gets sick, they use a separate room and separate dishes.',
        'Note symptoms and condition in your check-in note.',
      ] },
      { phase: DAYS, items: [
        'Stock up on enough food, daily necessities and medicine to last 2 weeks.',
        'Even if you can\'t meet in person, check on each other with a check-in at the agreed times every day.',
      ] },
    ],
    checklist: [
      { id: 'p1', text: 'Thermometer' },
      { id: 'p2', text: 'At least 30 masks' },
      { id: 'p3', text: 'Hand sanitizer' },
      { id: 'p4', text: 'Fever reducers and basic medicine for 2 weeks' },
      { id: 'p5', text: 'Extra prescription medication' },
    ],
  },
  {
    id: 'blackout',
    order: 9,
    icon: '📵',
    title: 'Power or phone/internet outage',
    summary: 'Even if you can\'t reach each other, meet as agreed. This matters most.',
    keyPoints: ['If communications go down, don\'t wait to hear from anyone — meet as agreed', 'Use a flashlight, not candles', 'If calls don\'t go through, try texting'],
    steps: [
      { phase: NOW, items: [
        'Use a flashlight instead of candles.',
        'If you are stuck in an elevator, press the emergency button and do not force the doors open.',
        'Keep the fridge door closed. It will stay cold for a few hours if you do.',
        'Switch your phone to power-saving mode.',
      ] },
      { phase: HOURS, items: [
        'If communications go down, don\'t wait to hear from anyone — go to meeting place #1 as agreed.',
        'Texts may work even when calls don\'t. Try "Send by text".',
        'Get information from a portable radio.',
      ] },
      { phase: DAYS, items: [
        'Card payments may not work, so use cash.',
        'When the internet comes back, any queued check-ins are sent automatically. Open the site once to confirm.',
      ] },
    ],
    checklist: [
      { id: 'o1', text: 'Portable radio and batteries' },
      { id: 'o2', text: 'Fully charged power bank' },
      { id: 'o3', text: 'Cash' },
      { id: 'o4', text: 'Paper map and contact list' },
    ],
  },
  {
    id: 'heat',
    order: 10,
    icon: '🌡️',
    title: 'Heat wave',
    summary: 'Avoid outdoor activity in the middle of the day (12–5 p.m.), and cool down right away if you see signs of heat illness.',
    keyPoints: [
      'Avoid outdoor activity from 12 to 5 p.m.',
      'Drink water often, even if you are not thirsty',
      'If dizzy or nauseous, get somewhere cool; if confused or drowsy, call 119'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'Stop outdoor work and exercise during the hottest hours (12–5 p.m.).',
          'Drink water often. Avoid alcohol and caffeinated drinks.',
          'If your home is too hot, go to a nearby cooling shelter (community service center, senior center, etc.).',
          'Check in on older relatives, children and family members with health conditions.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'If you feel dizzy, have a headache, nausea or muscle cramps, get somewhere cool, loosen your clothes and cool your body with water.',
          'A very high body temperature with confusion may be heatstroke. Call 119 right away, and never force water on someone who is unconscious.',
          'Never leave a child or pet alone in a car.'
        ]
      },
      {
        phase: 'Over the next few days',
        items: [
          'Keep a portable fan and a power bank charged in case of a power outage.',
          'If you run the air conditioner for a long time, air out the room as well.'
        ]
      }
    ],
    checklist: [
      {
        id: 'h1',
        text: 'I know where the nearest cooling shelter is'
      },
      {
        id: 'h2',
        text: 'Portable fan and plenty of drinking water'
      },
      {
        id: 'h3',
        text: 'Wide-brimmed hat and sun umbrella'
      },
      {
        id: 'h4',
        text: 'We agreed to contact family members who live alone every day'
      }
    ]
  },
  {
    id: 'cold',
    order: 11,
    icon: '❄️',
    title: 'Cold wave / heavy snow',
    summary: 'Keep warm, and prepare for frozen pipes and for being cut off or roofs collapsing under heavy snow.',
    keyPoints: [
      'Dress in layers and wear a hat and gloves to stay warm',
      'Don\'t rub frostbitten skin — warm it in lukewarm water',
      'Avoid unnecessary driving in heavy snow'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'Go out less, and when you do, wear several thin layers plus a hat, gloves and a scarf.',
          'Wrap the water meter box with old clothes or similar, and on very cold nights leave a tap running slightly.',
          'In heavy snow, put off driving; if you must drive, bring snow chains, a blanket and water.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'Frostbite: move somewhere warm and soak the area in lukewarm water (about 38–42 °C). Do not rub it or hold it directly to a fire.',
          'Hypothermia (violent shivering, slurred speech): remove wet clothing, wrap the person in a blanket and call 119.',
          'If heavy snow has piled up on a roof or greenhouse, don\'t climb up to clear it; get out of any building at risk of collapse.'
        ]
      },
      {
        phase: 'Over the next few days',
        items: [
          'Ventilate often when using a heater, and install a carbon monoxide alarm.',
          'In case you get cut off, keep 3 days of food, water and basic medicine on hand.'
        ]
      }
    ],
    checklist: [
      {
        id: 'k1',
        text: 'Water meter is insulated'
      },
      {
        id: 'k2',
        text: 'Snow chains or winter tires for the car'
      },
      {
        id: 'k3',
        text: 'Cold-weather gear (hat, gloves, hand warmers, blankets)'
      },
      {
        id: 'k4',
        text: 'Carbon monoxide alarm'
      }
    ]
  },
  {
    id: 'landslide',
    order: 12,
    icon: '⛰️',
    title: 'Landslide',
    summary: 'If you see warning signs, don\'t hesitate — move immediately to high ground off to the side of the slide path.',
    keyPoints: [
      'Cracks in a slope, muddy water or leaning trees mean evacuate',
      'Move to high ground off to the side of the slide path',
      'Stay away from valleys and streams'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'Evacuate immediately if you notice any of these signs: cracks in a slope, spring water suddenly turning muddy or stopping, trees leaning, or a rumbling sound from the ground.',
          'Move to high ground off to the side, not straight in the path of the sliding earth.',
          'Once safe, check in and let your family know where you are.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'Landslides can happen even after the rain stops, so do not go back right away.',
          'Stay out of valleys and streams, and away from the base of retaining walls.'
        ]
      },
      {
        phase: 'Over the next few days',
        items: [
          'Do not go back into your home until the local government confirms it is safe.'
        ]
      }
    ],
    checklist: [
      {
        id: 'l1',
        text: 'I know the landslide risk areas and shelters in our neighborhood'
      },
      {
        id: 'l2',
        text: 'I checked the condition of the slope and retaining wall behind our house'
      }
    ]
  },
  {
    id: 'tsunami',
    order: 13,
    icon: '🌊',
    title: 'Tsunami',
    summary: 'If you feel strong shaking at the coast or a warning is issued, move to high ground right away.',
    keyPoints: [
      'Strong earthquake at the coast = head for high ground without waiting for a warning',
      'If the sea suddenly pulls back, do not go to look',
      'Tsunamis come in several waves — do not return before the all-clear'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'If you feel strong shaking at the coast, don\'t wait for a warning — move away from the shore to high ground at once.',
          'If high ground is too far, go to the 3rd floor or higher of a sturdy reinforced-concrete building.',
          'The sea suddenly pulling back is a sign a tsunami is coming. Never go to look.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'Tsunamis arrive in several waves, and the first may not be the largest. Do not go back down until the warning is lifted.',
          'Check in, and if your meeting place is on the coast, go to the next inland one.'
        ]
      }
    ],
    checklist: [
      {
        id: 't1',
        text: 'I know the tsunami evacuation sites at beaches we often visit'
      },
      {
        id: 't2',
        text: 'Our coastal meeting place has an inland alternative'
      }
    ]
  },
  {
    id: 'crowd',
    order: 14,
    icon: '👥',
    title: 'Crowd crush',
    summary: 'Leave early when it gets too crowded; if you get trapped, protect the space in front of your chest.',
    keyPoints: [
      'As soon as you start getting pushed, move out to the edge',
      'Use your arms to keep space in front of your chest so you can breathe',
      'If you fall, curl up on your side and protect your head and neck'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'When it gets crowded enough that people are touching you, stop going further in and move out to the edge or to an open area.',
          'Don\'t push straight against the flow; work your way out a little at a time on a diagonal.',
          'If you are trapped, bring both arms up in front of your chest (like a boxer) to keep room to breathe.',
          'If you fall, lie on your side, curl up and wrap your arms around your head and neck.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'If you sense danger, call 112 or 119, and get people around you to shout "Move back!" together.',
          'Check in once you are somewhere safe.'
        ]
      }
    ],
    checklist: [
      {
        id: 'c1x',
        text: 'At events, I check the exits and open spaces first'
      },
      {
        id: 'c2x',
        text: 'We agree in advance where to meet if we get separated at an event'
      }
    ]
  },
  {
    id: 'separated',
    order: 15,
    icon: '🧒',
    title: 'Separated from family / missing person',
    summary: 'Children stay where they are; adults call 182 or 112 right away.',
    keyPoints: [
      'Children: stay put and ask a police officer or staff member for help',
      'Adults: call 112 or 182 right away and have a recent photo ready',
      'Children memorize their parents\' phone numbers'
    ],
    steps: [
      {
        phase: 'Right now',
        items: [
          'Teach children ahead of time: if you get lost, stay where you are and ask a police officer, a store employee, or an adult who is with children for help.',
          'Adults: if you can\'t find a child or an older family member, call 112 (police) or 182 (Missing Children Center) right away.',
          'Note where and when you last saw them and what they were wearing, and have a recent photo ready.'
        ]
      },
      {
        phase: 'Within a few hours',
        items: [
          'Post a check-in and a note on this site so the whole family knows what is happening.',
          'In an emergency, one person stays at the agreed meeting place and waits.'
        ]
      },
      {
        phase: 'Ahead of time',
        items: [
          'Pre-register fingerprints and photos of children and family members with dementia on the National Police Agency\'s "Safe Dream" service.',
          'Keep an up-to-date family photo on your phone and in your go-bag.'
        ]
      }
    ],
    checklist: [
      {
        id: 's1',
        text: 'Our children know their parents\' phone numbers by heart'
      },
      {
        id: 's2',
        text: 'Pre-registered with Safe Dream (children, family members with dementia)'
      },
      {
        id: 's3',
        text: 'A recent family photo is on my phone and in my bag'
      }
    ]
  },
];
