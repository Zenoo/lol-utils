/** Script-only aliases have no formula node. Bind them to the archived spell's
 * named parameters/calculations; live counters remain symbolic outside a match.
 * No numbers here: patch values always come from the matching game archive.
 */
export const scriptTooltipBindings: Record<string, Record<string, string>> = {
  XinZhaoE: {
    f1: '{{ asmod*100 }} + {{ aptoasratio*100 }}% AP + {{ permanentastoasratio*100 }}% permanent bonus attack speed',
  },
  Obduracy: {
    f1: '{{ bonusarmorpassive*100 }}% pre-buff armor',
    f2: '{{ bonusarmorpassive*300 }}% pre-buff armor',
  },
  GarenE: {
    f1: '{{ numberofstrikes }} + floor(permanent bonus attack speed / {{ aspertick*100 }}%)',
  },
  SyndraW: { f2: '{{ slowduration }}' },
  KaisaQ: { f11: 'current bonus AD' },
  KaisaW: { f2: 'current AP' },
  KaisaE: { f10: 'current bonus attack speed' },
  BelvethQ: { f1: '{{ persidecooldown }} (before attack-speed reduction)' },
  BelvethE: { f2: '{{ totalstrikes }}' },
  BardW: { f1: 'current active shrines', f2: '{{ maxpacks }}' },
  SettW: { f1: '{{ damagecalc }} + {{ maxdamage }}' },
};

/** These localized branches are absent from Data Dragon's tooltip export.
 * Expand the archived spell parameters instead of exposing a localization key.
 * Aphelios has no selected weapon in the encyclopedia, so show all five effects.
 */
export const nestedTooltipBindings: Record<string, string> = {
  GangplankQWrapper:
    'Gangplank shoots a target, dealing <physicalDamage>{{ shotdamage }} physical damage</physicalDamage>. Kills grant {{ goldproc }} bonus gold and {{ ssproc }} Silver Serpents.',
  AkshanW:
    '<spellPassive>Passive:</spellPassive> Enemy champions who kill allies become Scoundrels for {{ vengeanceduration }} seconds. Taking down a Scoundrel grants {{ goldreward }} bonus gold and revives allies they killed.<br /><br /><spellActive>Active:</spellActive> Akshan becomes camouflaged, extending the effect near terrain or in brush. Moving toward Scoundrels grants {{ msvalue }} movement speed and restores {{ missingmanaregen*100 }}% missing Mana.',
  ApheliosR:
    'Aphelios fires a concentrated blast that explodes on champions, dealing <physicalDamage>{{ maxdamage }} physical damage</physicalDamage>, then attacks champions hit with his main-hand weapon.<br /><br />Calibrum: marks grant {{ calibrumrmarkbonusdamage }} additional damage.<br />Severum: restores {{ severumrhealbonus }} Health.<br />Gravitum: {{ gravitumrbonusslow }} slow; roots last {{ gravitumrrootduration }} seconds.<br />Infernum: {{ infernumrbonusdamage }} additional explosion damage.<br />Crescendum: grants {{ crescendumrbonusminis }} additional chakrams.',
};
