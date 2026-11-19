export type Colors = {
  primary: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  success: string;
  danger: string;
  logout: string;
  bg: string;
  surface: string;
  surfaceMuted: string;
  border: string;
  text: string;
  textMuted: string;
  overlay: string;
};

export const lightColors: Colors = {
  primary: '#F6BE25',
  primarySoft: '#FDF1CC',
  onPrimary: '#1B1B1B',
  accent: '#1A5DD6',
  success: '#2E9E5B',
  danger: '#E53935',
  logout: '#FF4F2B',
  bg: '#FCFCFC',
  surface: '#FFFFFF',
  surfaceMuted: '#F2F2F2',
  border: '#ECECEC',
  text: '#1B1B1B',
  textMuted: '#6B6B6B',
  overlay: 'rgba(0,0,0,0.45)',
};

export const darkColors: Colors = {
  ...lightColors,
  primarySoft: '#3A3010',
  bg: '#121212',
  surface: '#1E1E1E',
  surfaceMuted: '#2A2A2A',
  border: '#333333',
  text: '#F2F2F2',
  textMuted: '#A0A0A0',
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;
export const radius = { row: 6, card: 8, pill: 24 } as const;
export const fontSize = { title: 20, body: 16, secondary: 14, label: 12 } as const;
export const MAX_WIDTH = 900;
