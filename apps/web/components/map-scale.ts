/** Mistura a cor de destaque com o fundo: quanto maior o percentual, mais forte. */
export const binColor = (mix: number) => `color-mix(in srgb, var(--accent) ${mix}%, var(--surface))`;
