import { z } from 'zod';
import { hudLayoutSchema } from './schema.js';

const elementSchema = z.object({
  Position: z.object({
    UIRect: z.object({
      Position: z.tuple([z.number(), z.number()]),
      Size: z.tuple([z.number().positive(), z.number().positive()]),
      SourceResolutionWidth: z.number().positive(),
      SourceResolutionHeight: z.number().positive(),
    }),
    Anchors: z.object({ Anchor: z.tuple([z.number(), z.number()]) }),
  }),
});

/** Extract the ordinary QWER hit/visual rectangles, not level-up text or passive/summoner slots. */
export function extractHudLayout(raw: Record<string, unknown>) {
  const slots = (['Q', 'W', 'E', 'R'] as const).map((key, index) => {
    const path = `ClientStates/Gameplay/UX/LoL/PlayerFrame/UIBase/Player_Frame_Root/PlayerSpells/Ability${index}/Ability${index}_IconLoc`;
    const { UIRect, Anchors } = elementSchema.parse(raw[path]).Position;

    return { key, rect: UIRect, anchor: Anchors.Anchor };
  });
  const first = slots[0];
  if (
    slots.some(
      ({ rect, anchor }) =>
        rect.SourceResolutionWidth !== first.rect.SourceResolutionWidth ||
        rect.SourceResolutionHeight !== first.rect.SourceResolutionHeight ||
        anchor.some((value, i) => value !== first.anchor[i]),
    )
  ) {
    throw new Error('Ability slots do not share one reference resolution and anchor');
  }

  return hudLayoutSchema.parse({
    referenceWidth: first.rect.SourceResolutionWidth,
    referenceHeight: first.rect.SourceResolutionHeight,
    anchor: first.anchor,
    slots: slots.map(({ key, rect }) => ({ key, position: rect.Position, size: rect.Size })),
  });
}
