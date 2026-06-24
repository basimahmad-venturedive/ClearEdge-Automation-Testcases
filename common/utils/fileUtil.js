import fs from 'fs';
import path from 'path';

/**
 * File utility for reading/writing test artifacts.
 */
export const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

export const readJsonFile = (filePath) => {
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
};

export const writeJsonFile = (filePath, data) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
};

export const fileExists = (filePath) => fs.existsSync(filePath);

export const readFile = (filePath) => fs.readFileSync(filePath, 'utf-8');

export const writeFile = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf-8');
};
