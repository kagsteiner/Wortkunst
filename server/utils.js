import { customAlphabet } from 'nanoid';

const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const nanoId10 = customAlphabet(alphabet, 10);
export const nanoId16 = customAlphabet(alphabet, 16);
export const nanoId22 = customAlphabet(alphabet, 22);

export function shuffleArrayInPlace(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

export function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}


