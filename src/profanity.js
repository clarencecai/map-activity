import { Profanity } from '@2toad/profanity';

const profanityFilter = new Profanity({
  languages: ['en'],
  wholeWord: false,
});

const letterOrNumberPattern = /[\p{L}\p{N}\p{M}]/u;

function isLetterOrNumber(char = '') {
  return letterOrNumberPattern.test(char);
}

function shouldCensorMatch(text, start, end) {
  const previousChar = text[start - 1] || '';
  const nextChar = text[end] || '';

  return !(isLetterOrNumber(previousChar) && isLetterOrNumber(nextChar));
}

export function censorProfanity(value = '') {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  const regex = profanityFilter.getRegex(['en']);
  const lowercaseValue = value.toLowerCase();
  regex.lastIndex = 0;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(lowercaseValue)) !== null) {
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;
    const originalMatch = value.slice(matchStart, matchEnd);
    const replacement = shouldCensorMatch(lowercaseValue, matchStart, matchEnd)
      ? '*'.repeat(originalMatch.length)
      : originalMatch;

    parts.push(value.slice(lastIndex, matchStart), replacement);
    lastIndex = matchEnd;
  }

  if (lastIndex === 0) {
    return value;
  }

  parts.push(value.slice(lastIndex));
  return parts.join('');
}
