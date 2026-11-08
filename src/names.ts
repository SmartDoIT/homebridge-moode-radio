/**
 * HomeKit only likes letters, digits, spaces and apostrophes in names, starting and ending
 * with a letter or digit ("FluxFM - 80s" becomes "FluxFM 80s").
 */
export function homeName(name: string): string {
  const cleaned = name
    .replace(/[^\p{L}\p{N} ']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return cleaned || 'Radio';
}
