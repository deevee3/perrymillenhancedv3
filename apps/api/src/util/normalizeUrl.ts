import normalize from 'normalize-url';

export function normalizeUrl(input: string): string {
  try {
    return normalize(input, {
      stripWWW: false,
      removeTrailingSlash: true,
      sortQueryParameters: true
    });
  } catch {
    return input;
  }
}
