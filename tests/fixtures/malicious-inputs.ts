/**
 * Shared hostile inputs used by unit, API, component and E2E tests.
 * Every test that uses these asserts the input is rejected, or stored and shown as plain text.
 */

export const XSS_PAYLOADS = [
  '<script>alert("xss")</script>',
  '<img src=x onerror=alert(1)>',
  '"><svg onload=alert(1)>',
  '<iframe src="javascript:alert(1)"></iframe>',
  '<a href="javascript:alert(1)">click me</a>',
  "';alert(String.fromCharCode(88,83,83))//",
] as const;

export const SQL_INJECTION_PAYLOADS = [
  "' OR 1=1 --",
  "' OR '1'='1",
  "'; DROP TABLE \"User\"; --",
  "admin'--",
  "' UNION SELECT password FROM \"User\" --",
  '1; SELECT * FROM "User"',
] as const;

/** LIKE wildcards: harmless as SQL, but they widen a `contains` search if not escaped. */
export const LIKE_WILDCARDS = ['%', '_', '%%', '\\'] as const;

export const OVERSIZED_STRINGS = {
  tenKilobytes: 'a'.repeat(10_000),
  oneMegabyte: 'x'.repeat(1_000_000),
} as const;

export const PATH_TRAVERSAL_FILENAMES = [
  '../../etc/passwd',
  '..\\..\\windows\\system32\\config\\sam',
  '/etc/shadow',
  '....//....//etc/passwd',
  '%2e%2e%2fetc%2fpasswd',
  'avatar.php',
  'avatar.jpg.exe',
  'shell.php%00.jpg',
  'payload.svg',
] as const;

export const PATH_TRAVERSAL_IDS = ['../../admin', '../', 'user/../../root', 'a b;rm -rf /', 'C:\\Windows'] as const;

/** Values sent where the API expects a numeric id. */
export const BAD_NUMERIC_IDS = ['abc', 'NaN', '1 OR 1=1', '../2', ''] as const;

export const UNICODE_NAMES = ['Kēhau', 'ʻAkana', 'Pōmaikaʻi', 'Mālama ʻĀina', '李小龍', 'Zoë', '👩🏽‍💻'] as const;
