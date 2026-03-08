// Backend service URLs - configurable via environment variables
// In production, these point to the external endpoints of K8s services

export const config = {
    keycloak: {
        url: import.meta.env.VITE_KEYCLOAK_URL || 'https://auth.johnsonyuen.com',
        realm: import.meta.env.VITE_KEYCLOAK_REALM || 'homekube',
        clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'homepage',
    },
    tts: {
        baseUrl: import.meta.env.VITE_TTS_URL || 'https://tts.johnsonyuen.com',
        wsUrl: import.meta.env.VITE_TTS_WS_URL || 'wss://tts.johnsonyuen.com/ws/live',
    },
    stt: {
        wsUrl: import.meta.env.VITE_STT_WS_URL || 'wss://stt.johnsonyuen.com/transcribe',
    },
    location: {
        baseUrl: import.meta.env.VITE_LOCATION_URL || 'https://location.johnsonyuen.com',
        defaultCenter: { lat: -37.8136, lng: 144.9631 }, // Melbourne CBD
        gpsIntervalMs: 30_000,
        pollIntervalMs: 15_000,
        syncBatchSize: 100,
    },
};
