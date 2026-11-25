import type { Narration, Role } from './types';

// Add your in-jokes here. Each list is picked from at random so repeat games stay fresh.
// {name} and {role} are filled in by the game. No other code needs to change.

export interface PickRng {
  int(max: number): number;
}

const pick = <T>(list: T[], rng: PickRng): T => list[rng.int(list.length)] as T;

const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

const ROLE_NAMES: Record<Role, string> = {
  villager: 'Villager',
  mafia: 'Mafia',
  detective: 'Detective',
  doctor: 'Doctor',
};

const rolling = {
  roleReveal: [
    'Check your phones. Hold your card to see your role, and don\'t let anyone peek.',
    'Cards are dealt. Hold yours close to your chest, and your pint closer.',
    'Everyone has a role. Look at your phone, and keep your poker face on.',
  ],
  night: [
    'Last orders, lads. The lights are going down...',
    'The fire dies low and the bar goes quiet. Someone here is not what they seem...',
    'Time, please! Heads down, eyes shut, and mind your pint.',
    'The pub falls silent. Somewhere in the dark, the Traitors are choosing.',
  ],
  dawnKilled: [
    '{name} stepped out for a smoke and never came back.',
    'A stool sits empty at the bar. {name} was taken in the night.',
    'The barman found {name}\'s coat on the floor, and no sign of its owner.',
    '{name} went to change a keg in the cellar. The cellar kept them.',
  ],
  dawnSaved: [
    'Someone was nearly done for, but the barman got there first. Nobody was lost.',
    'A close call in the night. Somebody owes the Doctor a pint.',
    'The Traitors struck, but someone was watching over the bar. Everyone is still here.',
  ],
  dawnQuiet: [
    'A quiet night in the pub. Everyone is still on their stool.',
    'Nothing stirred but the cat. Every stool is still taken.',
    'The Traitors held back. Nobody was lost tonight.',
  ],
  day: [
    'The sun is up and the knives are out. Who is the Traitor?',
    'Morning at the bar. Talk it out, and watch who dodges the question.',
    'The pub is awake. Somebody here is lying to your face.',
  ],
  vote: [
    'Calling Time! Cast your vote.',
    'Time, gentle folk, please. Who gets barred?',
    'Drink up and decide. Who goes out the door?',
  ],
  verdictOut: [
    '{name} has been barred.',
    'The bar has spoken. {name} is shown the door.',
    '{name} is escorted out into the cold.',
  ],
  verdictNone: [
    'The pub could not agree. Nobody is barred today.',
    'A hung jury at the bar. Everyone keeps their stool.',
  ],
  winVillage: [
    'The pub is safe. Drinks are on the house!',
    'The Traitors are out on their ear. Pints all round!',
  ],
  winMafia: [
    'The Traitors own the pub now.',
    'Last orders for the village. The Traitors have the keys.',
  ],
};

export const narrate = {
  roleReveal: (rng: PickRng): Narration => ({ title: 'Cards dealt', text: pick(rolling.roleReveal, rng) }),
  night: (rng: PickRng): Narration => ({ title: 'Last orders', text: pick(rolling.night, rng) }),
  dawn: (
    rng: PickRng,
    o: { killedName?: string; killedRole?: Role; saved: boolean },
  ): Narration => {
    if (o.killedName) {
      let text = fill(pick(rolling.dawnKilled, rng), { name: o.killedName });
      if (o.killedRole) text += ` They were ${o.killedRole === 'villager' ? 'a' : 'the'} ${ROLE_NAMES[o.killedRole]}.`;
      return { title: 'Dawn', text };
    }
    if (o.saved) return { title: 'Dawn', text: pick(rolling.dawnSaved, rng) };
    return { title: 'Dawn', text: pick(rolling.dawnQuiet, rng) };
  },
  day: (rng: PickRng): Narration => ({ title: 'Morning', text: pick(rolling.day, rng) }),
  vote: (rng: PickRng): Narration => ({ title: 'Calling Time', text: pick(rolling.vote, rng) }),
  verdict: (rng: PickRng, o: { name?: string; role?: Role }): Narration => {
    if (!o.name) return { title: 'No verdict', text: pick(rolling.verdictNone, rng) };
    let text = fill(pick(rolling.verdictOut, rng), { name: o.name });
    if (o.role) text += ` They were ${o.role === 'villager' ? 'a' : 'the'} ${ROLE_NAMES[o.role]}.`;
    return { title: 'Barred', text };
  },
  win: (rng: PickRng, team: 'village' | 'mafia'): Narration =>
    team === 'village'
      ? { title: 'The village wins', text: pick(rolling.winVillage, rng) }
      : { title: 'The Traitors win', text: pick(rolling.winMafia, rng) },
};
