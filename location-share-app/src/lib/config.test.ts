import { describe, it, expect } from 'vitest';
import { config } from './config';

describe('config', () => {
    it('has correct default keycloak config', () => {
        expect(config.keycloak.url).toBe('https://auth.johnsonyuen.com');
        expect(config.keycloak.realm).toBe('homekube');
        expect(config.keycloak.clientId).toBe('homepage');
    });

    it('has correct default TTS config', () => {
        expect(config.tts.baseUrl).toBe('https://tts.johnsonyuen.com');
        expect(config.tts.wsUrl).toBe('wss://tts.johnsonyuen.com/ws/live');
    });

    it('has correct default STT config', () => {
        expect(config.stt.wsUrl).toBe('wss://stt.johnsonyuen.com/transcribe');
    });

    it('has correct default location config', () => {
        expect(config.location.baseUrl).toBe('https://location.johnsonyuen.com');
    });
});
