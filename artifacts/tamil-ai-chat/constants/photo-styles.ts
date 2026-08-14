export type PhotoStyle = {
  id: string;
  label: string;
  color: string;
};

// Canonical built-in style folders used by the Cloudinary camera library.
// Keep these IDs stable: they are part of the existing Cloudinary paths.
export const PHOTO_STYLES: readonly PhotoStyle[] = [
  { id: 'breast',     label: 'Breast Show',  color: '#E91E63' },
  { id: 'buttocks',   label: 'Buttocks',     color: '#9C27B0' },
  { id: 'cleavage',   label: 'Cleavage',     color: '#E53935' },
  { id: 'halfbreast', label: 'Half Breast',  color: '#F44336' },
  { id: 'highslit',   label: 'High Slit',    color: '#FF5722' },
  { id: 'legs',       label: 'Legs Spread',  color: '#FF9800' },
  { id: 'lingerie',   label: 'Lingerie',     color: '#8E24AA' },
  { id: 'lowneck',    label: 'Low Neckline', color: '#E91E63' },
  { id: 'normal',     label: 'Normal Photo', color: '#546E7A' },
  { id: 'nude',       label: 'Nude',         color: '#C62828' },
  { id: 'seductive',  label: 'Seductive',    color: '#AD1457' },
  { id: 'seminude',   label: 'Semi Nude',    color: '#6A1B9A' },
  { id: 'sleeping',   label: 'Sleeping',     color: '#4527A0' },
  { id: 'wet',        label: 'Wet Clothes',  color: '#1565C0' },
  { id: 'saree',      label: 'Saree Tuck',   color: '#00897B' },
];
