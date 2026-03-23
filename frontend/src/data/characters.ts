/** Character table — maps sprite IDs to canonical names and gender.
 *  Must stay in sync with backend/botc/scripts/data/characters.json */

export interface Character {
  spriteId: number;
  name: string;
  gender: 'male' | 'female';
}

export const CHARACTERS: Character[] = [
  { spriteId: 1160,  name: "Urswick",                gender: "male"   },
  { spriteId: 1161,  name: "Cindric",                gender: "male"   },
  { spriteId: 1162,  name: "Friar Bramble",          gender: "male"   },
  { spriteId: 1163,  name: "Rowan",                  gender: "male"   },
  { spriteId: 1164,  name: "Rosalind",               gender: "female" },
  { spriteId: 2045,  name: "Saffron",                gender: "female" },
  { spriteId: 2046,  name: "Froswick",               gender: "male"   },
  { spriteId: 2047,  name: "Gallowen",               gender: "male"   },
  { spriteId: 2048,  name: "The Whisper",            gender: "male"   },
  { spriteId: 2049,  name: "Bramwell",               gender: "male"   },
  { spriteId: 3312,  name: "Shellworth",             gender: "male"   },
  { spriteId: 3313,  name: "Aurelion",               gender: "male"   },
  { spriteId: 3314,  name: "Ondine",                 gender: "female" },
  { spriteId: 3315,  name: "Marigold",               gender: "female" },
  { spriteId: 4501,  name: "Damdric",                gender: "male"   },
  { spriteId: 4502,  name: "Pip",                    gender: "male"   },
  { spriteId: 4503,  name: "Peppercorn",             gender: "male"   },
  { spriteId: 4504,  name: "Digsworth",              gender: "male"   },
  { spriteId: 5678,  name: "Morgaine",               gender: "female" },
  { spriteId: 5679,  name: "Boggart",                gender: "male"   },
  { spriteId: 5680,  name: "Drosselmeyer",           gender: "male"   },
  { spriteId: 5681,  name: "Bandit",                 gender: "male"   },
  { spriteId: 6234,  name: "Lord Bariston",          gender: "male"   },
  { spriteId: 6235,  name: "Nana Ashwick",           gender: "female" },
  { spriteId: 6236,  name: "Mosshelm",               gender: "male"   },
  { spriteId: 7890,  name: "Clover",                 gender: "female" },
  { spriteId: 7891,  name: "Warden Holt",            gender: "male"   },
  { spriteId: 7892,  name: "Grimjaw",                gender: "male"   },
  { spriteId: 8456,  name: "Tinkercap",              gender: "male"   },
  { spriteId: 8457,  name: "Duchess Whiskerford",    gender: "female" },
  { spriteId: 8458,  name: "Renard",                 gender: "male"   },
  { spriteId: 9123,  name: "Constable Brockley",     gender: "male"   },
  { spriteId: 9124,  name: "Chrysalis",              gender: "female" },
  { spriteId: 9125,  name: "Cubbert",                gender: "male"   },
  { spriteId: 10567, name: "Talon",                  gender: "male"   },
  { spriteId: 10568, name: "Mosswhisker",            gender: "female" },
  { spriteId: 10569, name: "Brother Aldous",         gender: "male"   },
  { spriteId: 11234, name: "Dunstan",                gender: "male"   },
  { spriteId: 11235, name: "Professor Thornwick",    gender: "male"   },
  { spriteId: 11236, name: "Abbot Hazelnut",         gender: "male"   },
  { spriteId: 12890, name: "Varn",                   gender: "male"   },
  { spriteId: 12891, name: "Caspian",                gender: "male"   },
  { spriteId: 12892, name: "Ashclaw",                gender: "male"   },
  { spriteId: 13456, name: "Peep",                   gender: "female" },
  { spriteId: 13457, name: "Corvina",                gender: "female" },
  { spriteId: 14012, name: "Gristlethwaite",         gender: "male"   },
  { spriteId: 14013, name: "Captain Larcen",         gender: "male"   },
  { spriteId: 15678, name: "Twill",                  gender: "female" },
  { spriteId: 15679, name: "Grimhold",               gender: "male"   },
  { spriteId: 16234, name: "Nethara",                gender: "female" },
  { spriteId: 16235, name: "Sergeant Umber",         gender: "male"   },
  { spriteId: 17681, name: "Nyx",                    gender: "female" },
  { spriteId: 17682, name: "Thornsprout",            gender: "male"   },
  { spriteId: 17683, name: "Colette",                gender: "female" },
  { spriteId: 17684, name: "Lavender",               gender: "female" },
  { spriteId: 17685, name: "Cedric",                 gender: "male"   },
  { spriteId: 17890, name: "Tunnelwick",             gender: "male"   },
  { spriteId: 17891, name: "Reginald",               gender: "male"   },
  { spriteId: 18456, name: "Grizzle",                gender: "male"   },
  { spriteId: 18457, name: "Nimbleclaw",             gender: "male"   },
  { spriteId: 19123, name: "Clementine",             gender: "female" },
  { spriteId: 19124, name: "Thallus",                gender: "male"   },
  { spriteId: 20567, name: "Lord Malachar",          gender: "male"   },
  { spriteId: 20568, name: "Grumbledon",             gender: "male"   },
  { spriteId: 21000, name: "Hemlock",                gender: "male"   },
  { spriteId: 22000, name: "Mudsworth",              gender: "male"   },
  { spriteId: 23000, name: "Rattigan",               gender: "male"   },
  { spriteId: 24000, name: "Vesper",                 gender: "female" },
  { spriteId: 25000, name: "Chancellor Croaksworth", gender: "male"   },
  { spriteId: 26000, name: "Wrinkles",               gender: "male"   },
  { spriteId: 27000, name: "Violette",               gender: "female" },
  { spriteId: 28000, name: "Barkley",                gender: "male"   },
  { spriteId: 29000, name: "Snapjaw",                gender: "male"   },
];

/** Lookup by sprite ID */
export const CHARACTER_BY_ID = new Map(CHARACTERS.map(c => [c.spriteId, c]));

/** Sorted alphabetically for dropdown display */
export const CHARACTERS_SORTED = [...CHARACTERS].sort((a, b) => a.name.localeCompare(b.name));

/** All sprite IDs — must match TownMap.tsx SPRITE_IDS and backend _SPRITE_IDS exactly */
export const SPRITE_IDS = CHARACTERS.map(c => c.spriteId);

/** Seeded PRNG (mulberry32) — deterministic sprite selection per game */
function seededRandom(seed: number): () => number {
  let t = seed;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick N unique sprite IDs from the pool using a game-specific seed. */
export function pickSpriteIds(gameId: string, count: number): number[] {
  let hash = 0;
  for (let i = 0; i < gameId.length; i++) {
    hash = ((hash << 5) - hash + gameId.charCodeAt(i)) | 0;
  }
  const rng = seededRandom(hash);
  const pool = [...SPRITE_IDS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
