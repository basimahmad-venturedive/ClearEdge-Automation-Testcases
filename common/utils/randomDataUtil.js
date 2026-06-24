/**
 * Random data generator for test data.
 */

const randomString = (length = 8) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const randomEmail = (domain = 'example.com') =>
  `test.user.${randomString(6)}@${domain}`;

export const randomPassword = (length = 12) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};

export const randomInt = (min = 1, max = 100) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

export const randomFromArray = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const uniqueId = (prefix = 'id') => `${prefix}_${Date.now()}_${randomString(4)}`;
