import { SLUG_PATTERN } from '@mynto/shared';
import { customAlphabet } from 'nanoid';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const generate = customAlphabet(ALPHABET, 12);

export function generateSlug(): string {
  return generate();
}

// Réexporté depuis @mynto/shared : le web valide le même format sur les
// slugs qu'il reçoit de ce service.
export { SLUG_PATTERN };
