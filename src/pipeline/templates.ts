import type { Language } from './types.js';

const HOLDING: Record<Language, string> = {
  id: 'Terima kasih kak, pesannya sudah kami terima. Admin kami akan lanjut bantu langsung di chat ini secepatnya ya.',
  en: 'Thanks for your message. One of our team will continue this chat with you shortly.',
};

const GREETING: Record<Language, string> = {
  id: 'Halo kak, terima kasih sudah menghubungi Sekar Dekorasi. Ada yang bisa kami bantu soal paket, tanggal, atau booking?',
  en: 'Hi, thanks for contacting Sekar Dekorasi. How can we help with packages, dates, or bookings?',
};

export function holdingMessage(language: Language): string {
  return HOLDING[language];
}

export function greetingMessage(language: Language): string {
  return GREETING[language];
}
