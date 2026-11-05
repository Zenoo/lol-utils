const labels: Record<string, string> = {
  hp: 'Health',
  movespeed: 'Movement speed',
  armor: 'Armor',
  spellblock: 'Magic resistance',
  attackrange: 'Attack range',
  hpregen: 'Health regeneration per 5 seconds',
  crit: 'Critical strike chance',
  attackdamage: 'Attack damage',
  attackspeed: 'Attack speed',
};

export function championStatLabel(key: string, resource: string): string {
  if (key === 'mp' || key === 'mpregen') {
    const name = resource.toLowerCase() === 'none' ? 'Resource' : resource;

    return key === 'mp' ? name : `${name} regeneration per 5 seconds`;
  }

  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
}
