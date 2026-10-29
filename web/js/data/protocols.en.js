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
  // ---------- Practical survival (written for when the ambulance or rescue team is late) ----------
  {
    id: 'firstaid',
    order: 2.1,
    icon: '🩹',
    title: 'First aid: bleeding, burns, fractures, cardiac arrest',
    summary: 'Only what you can do with your hands, assuming the ambulance will be late.',
    keyPoints: ['Bleeding: press a clean cloth hard for 10+ minutes — do not peek', 'Heavy limb bleeding: tourniquet, write down the time', 'Burns: 20 minutes under running tap water, no ice or toothpaste', 'Unresponsive and not breathing: 30 chest compressions + 2 breaths'],
    steps: [
      { phase: 'Bleeding', items: [
        'Put a clean cloth (clothing if nothing else) on the wound and press hard with your palm for at least 10 minutes. If blood soaks through, do not lift it; add more on top.',
        'If blood spurts from an arm or leg and pressure does not stop it, wrap a belt or cloth 5–7 cm above the wound (toward the heart), slide a stick in and twist until the bleeding stops. Write the time on the skin and do not loosen it until a hospital.',
        'Do not pull out embedded objects (glass, metal). Pad around them with cloth so they cannot move.',
        'Nosebleed: lean forward and pinch the soft part of the nose for 10 minutes. Do not tilt the head back.',
      ] },
      { phase: 'Burns', items: [
        'Cool under lukewarm running tap water for 20 minutes. Ice, toothpaste, soybean paste and alcohol make it worse.',
        'Do not peel off clothing stuck to the burn; cut around it. Take off rings and watches before swelling starts.',
        'Do not pop blisters. Cover loosely with clean plastic wrap or a dry cloth.',
        'Go to a hospital at once for burns bigger than a palm, burns on the face, joints or genitals, or breathing burns (singed nose hair, hoarse voice).',
      ] },
      { phase: 'Fractures and sprains', items: [
        'Do not ask them to move it; splint it in the position you find it. Use newspaper, a magazine or a branch tied with cloth, and include the joints above and below the injury.',
        'If the fingers or toes beyond the injury are white, cold or numb, a blood vessel is pinched. That person is the most urgent.',
        'Sprain: cold pack for 20 minutes, raise it above the heart. If they cannot bear weight or it looks deformed, treat it as a fracture.',
      ] },
      { phase: 'Cardiac arrest', items: [
        'If they do not respond when you tap their shoulders and call, and are not breathing or only gasping, call 119 and put it on speaker.',
        'Put the heel of one hand in the centre of the chest (between the nipples), the other hand on top, arms straight, and press 5 cm deep at 100–120 per minute (the beat of "Baby Shark"). 30 compressions, then 2 breaths; if you cannot do breaths, keep compressing.',
        'If there is an AED nearby, have someone fetch it and switch it on. Do what the machine says.',
        'Swap with someone every 2 minutes if you can. Not stopping is what matters most.',
      ] },
      { phase: 'Choking, hypothermia, dehydration', items: [
        'If they cannot speak and clutch their throat, stand behind them and pull your fist sharply inward and upward above the navel (Heimlich). For pregnant or large people, press the chest. Under 1 year old: face down, 5 back blows.',
        'Shivering and slurred speech is hypothermia. Remove wet clothes and put something warm in the armpits, chest and groin. If shivering stops and they get sleepy, it is critical.',
        'Dehydration (dark, scanty urine): mix half a teaspoon of salt and 6 teaspoons of sugar in 1 L of water and sip often.',
      ] },
    ],
    checklist: [
      { id: 'fa1', text: 'The first-aid kit has a pressure bandage (or a stack of pads/gauze), a belt for a tourniquet, scissors, gloves and a triangular bandage' },
      { id: 'fa2', text: 'Someone in the family has taken a CPR course (Red Cross or fire station, free)' },
      { id: 'fa3', text: 'We know the nearest AED at home and at work' },
      { id: 'fa4', text: 'Everyone\'s conditions, medications and allergies are entered in this app' },
      { id: 'fa5', text: 'We keep at least 2 weeks of prescription medicine on hand' },
    ],
  },
  {
    id: 'water',
    order: 2.2,
    icon: '💧',
    title: 'Water: storing and purifying',
    summary: 'People rarely last 3 days without water. How to store it before the supply stops, and how to make doubtful water safe.',
    keyPoints: ['3 L per person per day × family × 3 days', 'When you hear of a water cut, fill the bathtub, pots and bottles first', 'Boiling for 1 minute is surest; otherwise 2 drops of bleach per litre', 'Water in the toilet tank and the water heater is tap water and drinkable'],
    steps: [
      { phase: NOW, items: [
        'When you hear of a water cut, earthquake or war, fill the bathtub, pots, buckets and bottles with tap water at once. One bathtub is a week of household water for a family of 4.',
        'Water in the purifier tank, the water heater (boiler tank) and the toilet tank (the tank behind the bowl, not the bowl) is clean tap water. Do not drink it if you use tank cleaning tablets.',
        'Take at least 2 L per person when leaving home. Water weighs 1 kg per litre.',
      ] },
      { phase: HOURS, items: [
        'Use in this order: fridge, bottled and stored water → tank water → last, purified rain or stream water.',
        'Separate drinking water from washing water. Replace hand washing with wet wipes and sanitiser.',
        'Purifying step 1 (filter): strain muddy water through cloth, a coffee filter or a T-shirt and let it settle. Filtering alone does not kill germs.',
        'Purifying step 2 (disinfect, one of two): ① bring to a rolling boil and keep it boiling 1 more minute. ② add 2 drops of unscented household bleach (4–6%) per litre (8 drops per 4 L) and wait 30 minutes. A faint chlorine smell means it is right. Double the dose if the water is cloudy.',
        'Sunlight: clear water in a clear plastic bottle left in direct sun for 6 hours (2 days if cloudy) kills most germs.',
      ] },
      { phase: DAYS, items: [
        'Minimum per day: 2 L to drink, 1 L for cooking and teeth. Drink more if you sweat a lot. Going thirsty to save water is more dangerous.',
        'Rain: discard the first 10 minutes, then collect. Boil water that ran off a roof.',
        'Never drink: flood water, water beside factories or roads, water with odd colour or smell, seawater (it makes thirst worse). Pool water only boiled, in a pinch.',
        'Once diarrhoea starts, dehydration is the biggest danger. Keep drinking 1 L of water with half a teaspoon of salt and 6 teaspoons of sugar (oral rehydration).',
      ] },
    ],
    checklist: [
      { id: 'wa1', text: 'We have bottled water for 3 L × 3 days per person (36 L, or 18 two-litre bottles, for 4)' },
      { id: 'wa2', text: 'Water and food expiry dates are written in the emergency supplies list' },
      { id: 'wa3', text: 'We have unscented household bleach and a dropper (or a medicine bottle)' },
      { id: 'wa4', text: 'We can boil water (camping stove with 3+ gas canisters)' },
      { id: 'wa5', text: 'We checked that the bathtub plug seals properly' },
      { id: 'wa6', text: 'A straw-type water filter is in the go bag' },
    ],
  },
  {
    id: 'comms',
    order: 2.3,
    icon: '📡',
    title: 'Staying in touch when the network is down',
    summary: 'Calls die first and texts die last. The rules that let the family find each other with no network at all.',
    keyPoints: ['Text instead of calling; if texts fail, relay through a relative on another carrier', 'Where there is Wi-Fi, use KakaoTalk, this app or Wi-Fi calling', 'Check the note board at meeting place #1 at 9 a.m. and 9 p.m. daily', 'Leave paper notes at the front door and the meeting place'],
    steps: [
      { phase: NOW, items: [
        'If calls fail, text at once. Texts get through minutes or hours later. Keep it short: "Safe. At work. Heading home 3 pm".',
        'If texts fail too, switch the phone off and on (it reconnects to a cell tower). Try again from high ground, a window or a rooftop.',
        'Wherever there is Wi-Fi (subway stations, cafés, public offices), KakaoTalk, this app and Wi-Fi calling work. The carrier network and Wi-Fi fail separately.',
        '112 and 119 get priority even when calls are blocked. If they are swamped, report to 119 by text.',
      ] },
      { phase: HOURS, items: [
        'Relay through a family member on a different carrier (SKT, KT, LG U+). Often only one carrier is down.',
        'People instead of phones: ask neighbours or co-workers to pass a message when they get home.',
        'Stick paper notes inside the front door and at the agreed spot at meeting place #1 (for example the gate pillar): date, time, where you are going, when you will check next.',
        'Radio: KBS Radio 1 (FM 97.3 in Seoul; differs by region) or the car radio. Government announcements come here first.',
      ] },
      { phase: DAYS, items: [
        'Even with no contact at all, follow the ground rules: meeting place #1 until the agreed time, then the next one. Check the note board at 9 a.m. and 9 p.m. every day.',
        'When the network returns, check in on this app first. Check-ins you could not send upload automatically.',
        'Report missing people to the police (112, 182) or the city or district disaster headquarters. Every shelter keeps a register.',
      ] },
    ],
    checklist: [
      { id: 'cm1', text: 'The family is split across at least two carriers' },
      { id: 'cm2', text: 'We know family phone numbers by heart or carry them on paper or the emergency card' },
      { id: 'cm3', text: 'We agreed where to leave notes at meeting place #1' },
      { id: 'cm4', text: 'We have a battery radio and wrote down our local KBS Radio 1 frequency' },
      { id: 'cm5', text: 'Everyone knows the home Wi-Fi password, and we agreed to share Wi-Fi with neighbours in an emergency' },
    ],
  },
  {
    id: 'evacuate',
    order: 2.4,
    icon: '🚪',
    title: 'Leave or stay? Deciding, and leaving the house',
    summary: 'A bad evacuation can be more dangerous than staying. How to decide, and what to do in the 10 minutes before you go.',
    keyPoints: ['An evacuation order from officials or police: leave at once', 'If the building is sound and there is no order, home is the safest shelter', 'When leaving: gas off, breaker off, note on the door', 'Keep the car above half a tank'],
    steps: [
      { phase: 'Deciding', items: [
        'Leave: an evacuation order, gas smell, cracks or tilting in the house, fire, water or smoke approaching, water entering a basement, or an earthy smell and rumbling below a hillside.',
        'Stay: the building is undamaged and outside is more dangerous (air raid, chemical or nuclear event, blizzard, riots, flooding at night). Getting lost outside is often worse than holding out at home.',
        'Avoid moving at night if at all possible. Leave at first light.',
      ] },
      { phase: '10 minutes before leaving', items: [
        'Take only these six: go bag, prescription medicine, cash, ID, phone and power bank, water. Photos and keepsakes come second.',
        'Close the gas valve and switch off the main breaker. Leave the water on unless there is flooding or freezing.',
        'Leave a note inside the front door or on the fridge: who, what time, where to (meeting place #1), contact number. Family searching for you and rescuers will read it.',
        'In this app, save a checkpoint: "Left home, heading to ○○".',
        'Wear long sleeves, long trousers and sneakers. Nights are cold even in summer.',
      ] },
      { phase: 'On the move', items: [
        'Take main roads you know. Avoid shortcuts, alleys, underpasses and riverbanks.',
        'Drive only with more than half a tank and empty roads. Once traffic jams, be ready to abandon the car and walk. Leave the key in it.',
        'Tell children: "If we get separated, wait at this spot (a landmark building)". Write their name and your number on their arm.',
        'Save a checkpoint every hour. It uploads when there is a connection, even if there was none when you pressed it.',
        'At a shelter, register your name first. That is how family will find you.',
      ] },
    ],
    checklist: [
      { id: 'ev1', text: 'Go bag, medicine, cash and ID are in one place we can grab within 5 minutes' },
      { id: 'ev2', text: 'Everyone knows where the gas valve and the main breaker are' },
      { id: 'ev3', text: 'We never let the car drop below half a tank' },
      { id: 'ev4', text: 'We know at least two walking routes from home to meeting place #1' },
      { id: 'ev5', text: 'The children\'s clothes or bags carry their name and a guardian\'s phone number' },
    ],
  },
  {
    id: 'trapped',
    order: 2.5,
    icon: '🧱',
    title: 'Building collapse: when you are trapped',
    summary: 'Rescue teams search for survivors for up to 72 hours. Do not shout — tap, and do not breathe the dust.',
    keyPoints: ['Cover your mouth and nose with cloth — dust is the biggest enemy', 'Tap pipes or walls 3 times; shout only when you hear rescuers', 'No lighters (gas)', 'Keep the phone in airplane mode and check for signal once an hour'],
    steps: [
      { phase: NOW, items: [
        'Do not move until the shaking and noise stop. Pushing debris off yourself can bring more down.',
        'Cover your mouth and nose with cloth. Breathing a lot of dust can choke you hours later.',
        'Do not strike a lighter or match. Gas may be leaking. Use the phone screen for light.',
        'Press on bleeding to stop it. If a leg is pinned, do not force it free. Freeing a limb crushed for a long time can release toxins, so rescuers should do it.',
      ] },
      { phase: HOURS, items: [
        'Phone: keep it in airplane mode and switch it on for 10 seconds once an hour to check for signal. If there is signal, text rather than call (to 119: "location, floor, trapped"), and send a help request from this app.',
        'Tap a pipe, wall or metal 3 times with a stone at regular intervals (rest a minute, repeat). Rescue dogs and listening devices pick this up. Shouting wastes strength and raises dust; do it only when you hear rescuers.',
        'If you have a whistle, give 3 long blasts. It carries much farther than your voice. The "Rescue signals" page in this app has a whistle sound too.',
        'Ration any water and food. Do not drink urine.',
      ] },
      { phase: 'Stuck in a lift', items: [
        'Press every floor button. If the doors stay shut, press the emergency call (bell) button and wait. If that fails, call 119.',
        'Do not force the doors and climb out. People fall between floors.',
        'Never take a lift when there is a fire. If you are already in one, get out at the nearest floor.',
      ] },
    ],
    checklist: [
      { id: 'tr1', text: 'There is a whistle in the go bag and beside the bed' },
      { id: 'tr2', text: 'Shoes and a torch are kept beside the bed (broken glass)' },
      { id: 'tr3', text: 'Heavy furniture is anchored to the walls' },
      { id: 'tr4', text: 'We know where the "triangle of life" spaces beside sturdy tables and beds are at home' },
    ],
  },
  {
    id: 'shelterin',
    order: 2.6,
    icon: '🏠',
    title: 'Sealing in: chemical spills and nuclear fallout',
    summary: 'For factory explosions, toxic gas and fallout the answer is not "get out" but "get in, go up, seal, wait".',
    keyPoints: ['Upwind, upper floor, a room with no windows', 'Seal windows, vents and door gaps with tape and wet towels', 'Fallout is most dangerous in the first 24 hours; after 48 hours it is down to 1/100', 'Coming indoors: bag your clothes and shower, no conditioner'],
    steps: [
      { phase: NOW, items: [
        'Chemical incident (gas smell, factory explosion, "toxic gas" alert): move at right angles to the wind, or if you cannot get away, go to an upper floor of a building. Heavy gases pool low. Not the basement.',
        'Nuclear: if you see a flash, drop within 10 seconds, open your mouth and cover your ears (blast wave). Then within 10–15 minutes get inside the thickest building you can (concrete, basement). This time the basement is good.',
        'Inside, close windows and doors and switch off fans, air conditioning and the boiler. Gather in the innermost room with no windows (bathroom, dressing room).',
        'Seal door gaps, window frames and vents with tape, plastic and wet towels. Open a gap for 5 minutes every 2 hours so you do not suffocate (family of 4, small room).',
      ] },
      { phase: HOURS, items: [
        'Anyone who was outside: take off outer clothes at the door, put them in a plastic bag, tie it and leave it far away (removing clothes removes 90% of contamination). Shower with soap from the head down; no conditioner, it binds fallout to the hair. If you cannot shower, wipe face, hands and neck with wet wipes.',
        'Do not eat food or water that was outside. Sealed food in the fridge and cupboards, and tap water early on, are fine.',
        'Wait for the "all clear" by radio or alert text. For fallout, stay in at least 24 hours; 48–72 if there is no word.',
        'Potassium iodide (KI) only protects the thyroid from radioactive iodine. Take it only when the authorities say so, at the stated dose. Never drink antiseptic iodine.',
      ] },
      { phase: DAYS, items: [
        'If told to evacuate, go upwind along the designated route wearing a mask, raincoat and gloves. In a car, switch off outside air intake.',
        'Vomiting, diarrhoea or reddened skin within hours means a high dose. Tell the health centre or hospital.',
        'Children and pregnant women are evacuated first.',
      ] },
    ],
    checklist: [
      { id: 'sh1', text: 'We have duct tape and large plastic sheets to seal windows and vents' },
      { id: 'sh2', text: 'The innermost room can hold a radio, water, snacks and a phone charger' },
      { id: 'sh3', text: 'We know the thickest building or basement shelter near home' },
      { id: 'sh4', text: 'We have at least 5 KF94 masks per person' },
      { id: 'sh5', text: 'We know whether there is a chemical plant or gas depot near home' },
    ],
  },
  {
    id: 'longblackout',
    order: 2.7,
    icon: '🕯️',
    title: 'When a blackout lasts more than a day',
    summary: 'Day one is inconvenient; day three is survival. Fridge, heating, cooking and carbon monoxide.',
    keyPoints: ['Fridge 4 hours, full freezer 48 hours — keep the doors shut', 'Never charcoal, briquettes or a gas generator indoors: carbon monoxide', 'Everyone in one room for warmth; LED lanterns over candles', 'Cash and a radio are how you pay and how you learn'],
    steps: [
      { phase: NOW, items: [
        'Keep the fridge shut. The fridge holds 4 hours, a full freezer 48 hours (24 if half full). Moving frozen food into a cool box stretches it further.',
        'Unplug heaters, induction hobs and electric blankets. When power returns, everything switching on at once causes fires and overloads.',
        'Phone brightness to minimum, battery saver on, unused apps closed. Power banks go to phones only.',
        'Listen for restoration news on the radio (KBS Radio 1, FM 97.3 in Seoul, differs by region). The car radio works too.',
      ] },
      { phase: HOURS, items: [
        'Eat in this order: fridge → freezer → shelf-stable food. Throw out meat and milk that have been lukewarm for more than 2 hours. When in doubt, throw it out.',
        'Food needing no cooking: canned food, hardtack, nuts, cereal, fruit, chocolate bars. Use a camping stove briefly with a window open.',
        'Never indoors: charcoal, briquettes, camping stoves meant for outdoors, gas generators, or a running car in the garage. Carbon monoxide has no smell and kills people in their sleep. Headache or nausea: get outside at once.',
        'Heat: the whole family in one room, blankets or cardboard over the windows. Layer clothes, hats and socks. A tent pitched indoors traps body heat.',
        'Candles are the top cause of fires. Use LED lanterns and headlamps; if you must use a candle, put it in a glass.',
      ] },
      { phase: DAYS, items: [
        'The water supply may stop (apartment pumps shut down). Fill containers as soon as the power goes (see Water).',
        'Cards and app payments stop working. You need cash, especially small notes.',
        'Powered doors (apartment lobby, garage) have a manual release lever. Find it ahead of time.',
        'Throw out frozen food that thawed and refroze. Only food that still had ice crystals when refrozen is safe.',
        'Check charging and meal information at the community centre or shelter. Anyone depending on medical equipment (oxygen concentrator, refrigerated insulin) should tell the hospital or health centre first.',
      ] },
    ],
    checklist: [
      { id: 'lb1', text: 'We have LED lanterns or headlamps and spare batteries' },
      { id: 'lb2', text: 'A camping stove and 6+ gas canisters' },
      { id: 'lb3', text: '3 days of no-cook food (cans, hardtack, nuts)' },
      { id: 'lb4', text: 'A 20,000 mAh+ power bank or a solar charger' },
      { id: 'lb5', text: 'A battery radio, and we know the frequency' },
      { id: 'lb6', text: 'At least ₩100,000 in small notes kept at home' },
      { id: 'lb7', text: 'A carbon monoxide alarm (essential with a gas boiler)' },
      { id: 'lb8', text: 'Ice packs and a cool bag if anyone uses refrigerated medicine such as insulin' },
    ],
  },
  {
    id: 'car',
    order: 2.8,
    icon: '🚗',
    title: 'In the car: flooding, snowed in, roadside emergencies',
    summary: 'A sinking car must be left within a minute, and a snowed-in car needs its exhaust cleared first.',
    keyPoints: ['Do not drive into water above half the wheel (30 cm)', 'If flooding: window first, then break the glass', 'Snowed in: clear the exhaust, engine 10 minutes per hour', 'Stalled on a highway: get out and behind the guardrail'],
    steps: [
      { phase: 'Flooding', items: [
        'If water reaches half the wheel (about 30 cm), turn back. If you are already in, do not stop; drive through slowly. At 60 cm the car floats.',
        'If the car goes into water, unbuckle at once and lower the window (electric windows work for about a minute). The doors will not open against the water pressure.',
        'If the window will not open, pull out a headrest and strike the corner of a side window with the metal prongs. The windscreen will not break. Use a glass hammer if you have one.',
        'Once the car fills with water, the pressure equalises and the door opens. Take a deep breath and wait for that moment. Push children out first.',
        'Never enter an underpass with water in it. If you are in one and water rises, leave the car and walk out holding the wall rail.',
      ] },
      { phase: 'Snowed in', items: [
        'Stay with the car. Walking off in a blizzard and getting lost is more dangerous. Tie bright cloth to the antenna or wiper and text your location to 119.',
        'If snow blocks the exhaust, carbon monoxide comes into the cabin. Before starting the engine, always clear snow from around the exhaust and open a window 2 cm.',
        'Run the engine only 10 minutes per hour (fuel and carbon monoxide). Keep moving hands and feet, and wrap up in blankets, paper or seat covers.',
        'At night, leave the cabin light on so rescuers can see you. If the battery worries you, only while the engine runs.',
      ] },
      { phase: 'Roadside emergencies', items: [
        'If the car stops on a highway, switch on the hazards and get out and behind the guardrail at once. Most deaths come from being hit while standing in or behind the car. Put the warning triangle 100 m back.',
        'Tunnel fire: leave the car with the key in it and walk away from the smoke to an escape door (green signs, every 250 m).',
        'Driving during an earthquake or air raid: pull over slowly to the right; on a bridge, in a tunnel or on an overpass, get off it first, then stop.',
      ] },
    ],
    checklist: [
      { id: 'ca1', text: 'A glass hammer (with belt cutter) is within reach of the driver\'s seat' },
      { id: 'ca2', text: 'The car carries a blanket, 2 L of water, snacks, a power bank and a warning triangle' },
      { id: 'ca3', text: 'In winter: a snow shovel, sand (or cat litter) and chains' },
      { id: 'ca4', text: 'We never let the tank drop below half' },
    ],
  },
];
