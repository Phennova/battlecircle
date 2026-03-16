const ADJECTIVES = [
  'Aggressive', 'Sneaky', 'Chaotic', 'Turbo', 'Cosmic', 'Reckless',
  'Stealthy', 'Grumpy', 'Dizzy', 'Crunchy', 'Wobbly', 'Spicy',
  'Frosty', 'Mighty', 'Salty', 'Chunky', 'Mystic', 'Rusty',
  'Bouncy', 'Crispy', 'Fluffy', 'Gritty', 'Hasty', 'Jumpy',
  'Lucky'
];

const NOUNS = [
  'Potato', 'Waffle', 'Goblin', 'Pickle', 'Noodle', 'Badger',
  'Cactus', 'Donut', 'Falcon', 'Hammer', 'Igloo', 'Jackal',
  'Kebab', 'Llama', 'Muffin', 'Narwhal', 'Otter', 'Pretzel',
  'Quokka', 'Raptor', 'Squid', 'Taco', 'Urchin', 'Vulture',
  'Walrus'
];

export function generateName(usedNames) {
  const available = [];
  for (const adj of ADJECTIVES) {
    for (const noun of NOUNS) {
      const name = adj + noun;
      if (!usedNames.has(name)) available.push(name);
    }
  }
  if (available.length === 0) return 'Player' + Math.floor(Math.random() * 9999);
  return available[Math.floor(Math.random() * available.length)];
}
