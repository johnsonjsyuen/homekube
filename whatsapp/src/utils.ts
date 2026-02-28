export function phoneToJid(phone: string): string {
    // Strip non-digits, normalize AU local numbers, and add @s.whatsapp.net
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0') && digits.length === 10) {
        digits = '61' + digits.slice(1);
    }
    return `${digits}@s.whatsapp.net`;
}
