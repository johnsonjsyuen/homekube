//! Voice Activity Detection (VAD) module.
//!
//! Provides energy-based voice activity detection to segment continuous
//! audio streams into speech segments for transcription.

use std::time::{Duration, Instant};

/// Configuration for VAD behavior.
#[derive(Debug, Clone)]
pub struct VadConfig {
    /// RMS energy threshold to consider as speech (0.0-1.0 scale for PCM16).
    /// Values above this are considered speech.
    pub energy_threshold: f32,

    /// Duration of silence required to end a speech segment.
    pub silence_duration: Duration,

    /// Maximum duration of a speech segment before forcing transcription.
    pub max_speech_duration: Duration,

    /// Minimum speech duration to consider valid (filters noise bursts).
    pub min_speech_duration: Duration,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            energy_threshold: 0.01, // Fairly sensitive
            silence_duration: Duration::from_millis(500),
            max_speech_duration: Duration::from_secs(10),
            min_speech_duration: Duration::from_millis(250),
        }
    }
}

/// Current state of voice activity detection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadEvent {
    /// No speech detected, silence continues.
    Silence,
    /// Speech is currently being detected.
    Speaking,
    /// Speech segment just ended (silence detected after speech).
    SpeechEnded,
    /// Max duration reached, force segment end.
    MaxDurationReached,
}

/// Voice Activity Detector state machine.
#[derive(Debug)]
pub struct VadState {
    config: VadConfig,
    /// Whether we're currently in a speech segment.
    is_speaking: bool,
    /// When current speech segment started.
    speech_start: Option<Instant>,
    /// When silence started (if currently silent after speech).
    silence_start: Option<Instant>,
    /// Running average of energy for adaptive threshold.
    noise_floor: f32,
}

impl VadState {
    /// Create a new VAD state with the given configuration.
    pub fn new(config: VadConfig) -> Self {
        Self {
            config,
            is_speaking: false,
            speech_start: None,
            silence_start: None,
            noise_floor: 0.005,
        }
    }

    /// Create with default configuration.
    pub fn with_defaults() -> Self {
        Self::new(VadConfig::default())
    }

    /// Calculate RMS energy of PCM16 audio samples.
    pub fn calculate_energy(samples: &[i16]) -> f32 {
        if samples.is_empty() {
            return 0.0;
        }

        let sum_squares: f64 = samples
            .iter()
            .map(|&s| {
                let normalized = s as f64 / 32768.0;
                normalized * normalized
            })
            .sum();

        (sum_squares / samples.len() as f64).sqrt() as f32
    }

    /// Process an audio chunk and return the VAD event.
    ///
    /// This should be called with each incoming audio chunk (typically 20-100ms of audio).
    pub fn process(&mut self, samples: &[i16]) -> VadEvent {
        let energy = Self::calculate_energy(samples);
        let now = Instant::now();

        // Adaptive noise floor (slow update)
        if !self.is_speaking {
            self.noise_floor = self.noise_floor * 0.95 + energy * 0.05;
        }

        // Determine if this chunk contains speech
        let threshold = (self.config.energy_threshold).max(self.noise_floor * 2.0);
        let is_speech = energy > threshold;

        if is_speech {
            // Speech detected
            self.silence_start = None;

            if !self.is_speaking {
                // Transition: silence -> speech
                self.is_speaking = true;
                self.speech_start = Some(now);
                tracing::debug!(energy = %energy, threshold = %threshold, "VAD: Speech started");
            }

            // Check max duration
            if let Some(start) = self.speech_start {
                if now.duration_since(start) >= self.config.max_speech_duration {
                    tracing::debug!("VAD: Max speech duration reached");
                    self.is_speaking = false;
                    self.speech_start = None;
                    return VadEvent::MaxDurationReached;
                }
            }

            VadEvent::Speaking
        } else {
            // Silence detected
            if self.is_speaking {
                // We were speaking, now silence
                if self.silence_start.is_none() {
                    self.silence_start = Some(now);
                }

                // Check if silence duration exceeded
                if let Some(silence_start) = self.silence_start {
                    if now.duration_since(silence_start) >= self.config.silence_duration {
                        // Check minimum speech duration
                        let speech_duration = self
                            .speech_start
                            .map(|s| now.duration_since(s))
                            .unwrap_or_default();

                        if speech_duration >= self.config.min_speech_duration {
                            tracing::debug!(
                                duration_ms = %speech_duration.as_millis(),
                                "VAD: Speech ended"
                            );
                            self.is_speaking = false;
                            self.speech_start = None;
                            self.silence_start = None;
                            return VadEvent::SpeechEnded;
                        } else {
                            // Too short, treat as noise
                            tracing::debug!("VAD: Speech too short, ignoring");
                            self.is_speaking = false;
                            self.speech_start = None;
                            self.silence_start = None;
                        }
                    }
                }

                VadEvent::Speaking // Still considered speaking during silence grace period
            } else {
                VadEvent::Silence
            }
        }
    }

    /// Check if currently in a speech segment.
    pub fn is_speaking(&self) -> bool {
        self.is_speaking
    }

    /// Get the duration of the current speech segment, if any.
    pub fn speech_duration(&self) -> Option<Duration> {
        self.speech_start.map(|s| Instant::now().duration_since(s))
    }

    /// Reset the VAD state.
    pub fn reset(&mut self) {
        self.is_speaking = false;
        self.speech_start = None;
        self.silence_start = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_energy_calculation() {
        // Silence
        let silence = vec![0i16; 100];
        assert_eq!(VadState::calculate_energy(&silence), 0.0);

        // Max amplitude
        let loud = vec![i16::MAX; 100];
        let energy = VadState::calculate_energy(&loud);
        assert!(energy > 0.99, "Max amplitude should be near 1.0");
    }

    #[test]
    fn test_vad_transitions() {
        let config = VadConfig {
            energy_threshold: 0.1,
            silence_duration: Duration::from_millis(100),
            max_speech_duration: Duration::from_secs(10),
            min_speech_duration: Duration::from_millis(50),
        };
        let mut vad = VadState::new(config);

        // Initial silence
        let silence = vec![0i16; 100];
        assert_eq!(vad.process(&silence), VadEvent::Silence);
        assert!(!vad.is_speaking());

        // Speech starts
        let speech = vec![10000i16; 100];
        assert_eq!(vad.process(&speech), VadEvent::Speaking);
        assert!(vad.is_speaking());
    }
}
