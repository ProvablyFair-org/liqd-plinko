import { createRequire } from 'module';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';

const require = createRequire(import.meta.url);
const chromeCookies = require('chrome-cookies-secure');

/**
 * Load cookies from Chrome's cookie store for qa.liqd.com.
 * @param {string} profile Chrome profile name (default: 'Default')
 */
export async function loadCookies(profile = 'Default') {
  return new Promise((resolve, reject) => {
    chromeCookies.getCookies('https://qa.liqd.com', 'header', (err, cookies) => {
      if (err) reject(new Error('chrome-cookies-secure failed: ' + err.message + '\n  → Is Chrome installed and have you visited qa.liqd.com while logged in?'));
      else if (!cookies || cookies.length < 10) reject(new Error('No cookies found for qa.liqd.com — visit the site in Chrome and log in first.'));
      else resolve(cookies);
    }, profile);
  });
}

/**
 * Build an API function pre-loaded with auth cookies.
 * @param {string} cookieHeader Full Cookie header string from loadCookies()
 */
export function makeApi(cookieHeader) {
  return async function api(method, path, body) {
    const url = 'https://qa.liqd.com/api/v1' + path;
    const headers = { 'Accept': 'application/json', 'Cookie': cookieHeader };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 || r.status === 403) {
      throw new Error(r.status + ' — auth lost. Re-login in Chrome and restart.');
    }
    const text = await r.text();
    try { return JSON.parse(text); }
    catch (e) { throw new Error(r.status + ': ' + text.slice(0, 200)); }
  };
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const randHex = (bytes) => randomBytes(bytes).toString('hex');

export function saveCheckpoint(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data), 'utf8');
}

export function loadCheckpoint(filePath) {
  if (!existsSync(filePath)) return null;
  try { return JSON.parse(readFileSync(filePath, 'utf8')); }
  catch (e) { return null; }
}

export function writeOutput(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log('Written: ' + filePath);
}
