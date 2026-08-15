/**
 * Static reference cards.
 *
 * Read-only on purpose. These are general preparedness notes, not instructions
 * for a specific incident, and the app is not an emergency service — see
 * EMERGENCY_NOTICE in ContentSafety.ts, which is pinned above this content.
 */

export type GuidanceCard = {
  id: string;
  title: string;
  source: string;
  body: string;
};

export const GUIDANCE_CARDS: readonly GuidanceCard[] = [
  {
    id: 'water',
    title: 'Water when supply is cut',
    source: 'General preparedness guidance',
    body:
      'Use stored and bottled water first. Water heaters and toilet cisterns hold usable water; the bowl does not. If you must use uncertain water, bring it to a rolling boil for one minute where you can do so safely.',
  },
  {
    id: 'power',
    title: 'Power outages',
    source: 'General preparedness guidance',
    body:
      'Keep fridge and freezer doors shut — a full freezer holds temperature for about 48 hours. Never run a generator, camping stove or barbecue indoors, in a garage, or near a window. Unplug sensitive electronics to protect them when power returns.',
  },
  {
    id: 'checkin',
    title: 'Checking on neighbours',
    source: 'General preparedness guidance',
    body:
      'Prioritise people living alone, older neighbours, anyone with mobility needs, and homes with medical equipment that needs mains power. Knock, announce yourself, and do not force entry — post a request here instead if nobody answers.',
  },
  {
    id: 'battery',
    title: 'Making a phone last',
    source: 'General preparedness guidance',
    body:
      'Drop screen brightness, turn off Wi-Fi and mobile data, and close background apps. Bluetooth stays on — it is what carries messages here, and it costs far less power than a mobile radio hunting for a signal that is not there.',
  },
  {
    id: 'sharing',
    title: 'What to share publicly',
    source: 'Common Thread',
    body:
      'Everyone nearby can read a public post. Describe roughly where you are rather than an exact address, and keep phone numbers and door codes out of it. Share the specifics privately once you have accepted an offer.',
  },
];
