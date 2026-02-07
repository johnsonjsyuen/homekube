//! Phonemizer module - converts text to IPA phonemes using espeak-ng.

use std::process::Command;

/// Split text into sentences for incremental synthesis
pub fn split_sentences(text: &str) -> Vec<String> {
    let mut sentences = Vec::new();
    let mut current = String::new();

    for c in text.chars() {
        current.push(c);

        // Split on sentence-ending punctuation followed by whitespace or end
        if matches!(c, '.' | '!' | '?' | '。' | '！' | '？') {
            let trimmed = current.trim().to_string();
            if !trimmed.is_empty() {
                sentences.push(trimmed);
            }
            current.clear();
        }
    }

    // Don't forget trailing text without punctuation
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        sentences.push(trimmed);
    }

    sentences
}

/// Convert text to IPA phonemes using espeak-ng
///
/// Returns phonemes in IPA notation suitable for Kokoro model
pub fn phonemize(text: &str, lang: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Ok(String::new());
    }

    let output = Command::new("espeak-ng")
        .args([
            "--ipa", // Output IPA
            "-q",    // Quiet mode (no audio)
            "-v", lang, text,
        ])
        .output()
        .map_err(|e| format!("Failed to run espeak-ng: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("espeak-ng failed: {}", stderr));
    }

    let phonemes = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Clean up phonemes - remove stress markers and spaces that Kokoro doesn't use
    let cleaned = clean_phonemes(&phonemes);

    Ok(cleaned)
}

/// Clean phonemes for Kokoro model compatibility
fn clean_phonemes(phonemes: &str) -> String {
    phonemes
        .chars()
        .filter(|c| {
            // Keep IPA characters, remove newlines and extra whitespace
            !matches!(c, '\n' | '\r')
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Estimate word timings from phonemes
///
/// Returns a list of (word, start_ms, end_ms) tuples
/// Timing is estimated proportionally based on phoneme length
pub fn estimate_word_timings(
    text: &str,
    phonemes: &str,
    total_samples: usize,
    sample_rate: u32,
) -> Vec<(String, u32, u32)> {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }

    let total_ms = (total_samples as f64 / sample_rate as f64 * 1000.0) as u32;
    let phoneme_len = phonemes.len().max(1);

    // Estimate phonemes per word proportionally to character count
    let total_chars: usize = words.iter().map(|w| w.len()).sum();
    if total_chars == 0 {
        return Vec::new();
    }

    let mut timings = Vec::with_capacity(words.len());
    let mut current_ms: u32 = 0;

    for word in words {
        let word_ratio = word.len() as f64 / total_chars as f64;
        let word_duration = (total_ms as f64 * word_ratio) as u32;

        let start_ms = current_ms;
        let end_ms = current_ms + word_duration;

        timings.push((word.to_string(), start_ms, end_ms));
        current_ms = end_ms;
    }

    timings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_sentences() {
        let text = "Hello world. This is a test! How are you?";
        let sentences = split_sentences(text);
        assert_eq!(sentences.len(), 3);
        assert_eq!(sentences[0], "Hello world.");
        assert_eq!(sentences[1], "This is a test!");
        assert_eq!(sentences[2], "How are you?");
    }

    #[test]
    fn test_split_sentences_no_punctuation() {
        let text = "Hello world";
        let sentences = split_sentences(text);
        assert_eq!(sentences.len(), 1);
        assert_eq!(sentences[0], "Hello world");
    }

    #[test]
    fn test_split_sentences_empty() {
        let sentences = split_sentences("");
        assert!(sentences.is_empty());
    }

    #[test]
    fn test_estimate_word_timings() {
        let text = "Hello world";
        let phonemes = "həˈloʊ wɜːld";
        // 24000 samples = 1 second = 1000ms
        let timings = estimate_word_timings(text, phonemes, 24000, 24000);

        assert_eq!(timings.len(), 2);
        assert_eq!(timings[0].0, "Hello");
        assert_eq!(timings[0].1, 0); // starts at 0
        assert_eq!(timings[1].0, "world");
        // Rough timing check - "Hello" is 5 chars, "world" is 5 chars, so ~50% each
        assert!(timings[1].1 > 400 && timings[1].1 < 600);
    }
}
