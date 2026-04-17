/**
 * Color system matching the mobile web view (mobile-stocktre.css).
 * Dark = Venta Black palette. Light = Soft blue-white palette.
 */

export const darkColors = {
  // Backgrounds
  bg0: '#0d0e10',       // screen / deepest
  bg1: '#131416',       // primary surface
  bg2: '#1a1b1e',       // elevated (cards)
  bg3: '#1f2022',       // components (inputs, pills)

  // Text
  t1: '#ffffff',        // primary
  t2: '#c3c5d8',        // secondary
  t3: '#5a5d6e',        // muted / placeholder

  // Accent
  blue: '#2962FF',
  blueLight: '#448AFF',
  blueDim: 'rgba(41,98,255,0.10)',
  blueBorder: 'rgba(41,98,255,0.20)',

  // Semantic
  green: '#00C853',
  greenDim: 'rgba(0,200,83,0.10)',
  red: '#FF3D00',
  redDim: 'rgba(255,61,0,0.10)',
  amber: '#f59e0b',

  // Borders
  border: 'rgba(255,255,255,0.06)',

  // Bottom nav
  bnavBg: 'rgba(13,14,16,0.85)',

  // FAB (blue)
  fabGradStart: '#2962FF',
  fabGradEnd: '#1e4bc7',
  fabShadow: 'rgba(41,98,255,0.45)',

  // Misc
  statusBar: '#0d0e10',
  barStyle: 'light-content' as 'light-content' | 'dark-content',
};

export const lightColors = {
  // Backgrounds
  bg0: '#eef2fb',
  bg1: '#f4f7ff',
  bg2: '#ffffff',
  bg3: '#f0f4ff',

  // Text
  t1: '#0d1526',
  t2: '#4a587a',
  t3: '#8a96b4',

  // Accent
  blue: '#3b6ef8',
  blueLight: '#2451d1',
  blueDim: 'rgba(59,110,248,0.10)',
  blueBorder: 'rgba(59,110,248,0.15)',

  // Semantic
  green: '#00a96e',
  greenDim: 'rgba(0,169,110,0.10)',
  red: '#e02020',
  redDim: 'rgba(224,32,32,0.10)',
  amber: '#d97706',

  // Borders
  border: 'rgba(59,110,248,0.10)',

  // Bottom nav
  bnavBg: '#ffffff',

  // FAB (blue)
  fabGradStart: '#3b6ef8',
  fabGradEnd: '#2451d1',
  fabShadow: 'rgba(59,110,248,0.25)',

  // Misc
  statusBar: '#eef2fb',
  barStyle: 'dark-content' as 'light-content' | 'dark-content',
};

export type ThemeColors = typeof darkColors;
