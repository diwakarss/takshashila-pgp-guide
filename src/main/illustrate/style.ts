// The ian-xiaohei method, ported to English + our use (PRD §8.9). We carry the
// style DNA (pure-white, wobbly hand-drawn black line, a recurring deadpan
// character that PERFORMS the idea, sparse annotations, one idea per image,
// 16:9) — not the original Chinese-text runtime. Every generated illustration
// prepends this so the planner only supplies the concept-specific composition.
export const STYLE_DNA = `One standalone 16:9 horizontal hand-drawn CONCEPT ILLUSTRATION for a public-policy study app.
Visual DNA: pure WHITE background, minimalist BLACK hand-drawn slightly-wobbly pen line art, LOTS of empty white space (at least 35% blank), clean absurd product-sketch feeling. Absolutely NO gradients, NO shadows, NO paper texture, NO PPT infographic, NO cute mascot, NO children's illustration, NO realistic UI, NO photo-real.
Recurring character 'the analyst': a small solid-black deadpan figure with white dot eyes and thin legs, serious not cute. The analyst must PERFORM the core idea, not decorate the scene.
Colour (sparse): black for the main line art and the analyst; orange for the main flow / path / arrows; red only for a key warning, problem or result; blue only for a secondary note or system state. Use colour sparingly — rather too little than too much.
Labels: a few short HANDWRITTEN ENGLISH labels (4-6, each 2-4 words). Do NOT write a title in any corner. Do not name the structure type on the image.
Constraints: ONE image explains only ONE core idea. Keep the main subject 40-60% of the canvas. Clean, strange, scholarly, not childish.`

/** Build the full image brief from the planner's concept spec. */
export function buildIllustrationBrief(title: string, composition: string): string {
  return `${STYLE_DNA}\n\nTheme: ${title}\nComposition: ${composition}`
}
