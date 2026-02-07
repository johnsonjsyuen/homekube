//! ONNX-based Kokoro TTS inference module.
//!
//! This module loads the Kokoro ONNX model and voice embeddings,
//! then provides synthesis functionality returning PCM f32 audio at 24kHz.

use ndarray::{Array1, Array2};
use ort::session::Session;
use ort::value::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Sample rate for Kokoro output audio
pub const SAMPLE_RATE: u32 = 24000;

/// Phoneme to token ID mapping (from kokoro tokenizer.json)
/// This is a subset of IPA symbols used by the model
fn build_vocab() -> HashMap<char, i64> {
    // Phoneme vocabulary - IPA symbols used by Kokoro model
    // Using concat! to handle special characters cleanly
    let vocab_chars: &str = concat!(
        "$;:,.!?¡¿—…\"«»\" ",
        "()[]{}",
        "abcdefghijklmnopqrstuvwxyz",
        "ɑɐɒæɓʙβɔɕçɗɖðʤəɘɚɛɜɝɞɟʄɡɠɢʛɦɧħɥʜɨɪʝɭɬɫɮʟɱɯɰŋɳɲɴøɵɸθœɶʘɹɺɾɻʀʁɽʂʃʈʧʉʊʋⱱʌɣɤʍχʎʏʑʐʒʔʡʕʢǀǁǂǃˈˌːˑʼʴʰʱʲʷˠˤ˞↓↑→↗↘'̈"
    );

    let mut vocab = HashMap::new();
    for (i, c) in vocab_chars.chars().enumerate() {
        vocab.insert(c, i as i64);
    }
    vocab
}

/// Voice embedding data structure
/// Loaded from voices-v1.0.bin
struct VoiceEmbeddings {
    /// Map from voice name to embedding data
    /// Each embedding is 256 floats
    embeddings: HashMap<String, Vec<f32>>,
}

impl VoiceEmbeddings {
    fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let mut file =
            File::open(path).map_err(|e| format!("Failed to open voices file: {}", e))?;
        let mut data = Vec::new();
        file.read_to_end(&mut data)
            .map_err(|e| format!("Failed to read voices file: {}", e))?;

        // The voices-v1.0.bin format:
        // For each voice: [name_len: u8][name: bytes][embedding: 256 * f32]
        let mut embeddings = HashMap::new();
        let mut offset = 0;

        while offset < data.len() {
            if offset + 1 > data.len() {
                break;
            }
            let name_len = data[offset] as usize;
            offset += 1;

            if offset + name_len > data.len() {
                break;
            }
            let name = String::from_utf8_lossy(&data[offset..offset + name_len]).to_string();
            offset += name_len;

            // 256 floats = 1024 bytes
            if offset + 1024 > data.len() {
                break;
            }
            let mut embedding = Vec::with_capacity(256);
            for i in 0..256 {
                let start = offset + i * 4;
                let bytes: [u8; 4] = data[start..start + 4].try_into().unwrap();
                embedding.push(f32::from_le_bytes(bytes));
            }
            offset += 1024;

            embeddings.insert(name, embedding);
        }

        tracing::info!("Loaded {} voice embeddings", embeddings.len());
        Ok(Self { embeddings })
    }

    fn get(&self, voice: &str) -> Option<&Vec<f32>> {
        self.embeddings.get(voice)
    }
}

/// Kokoro TTS model
pub struct KokoroModel {
    session: Mutex<Session>,
    voices: VoiceEmbeddings,
    vocab: HashMap<char, i64>,
}

impl KokoroModel {
    /// Load the Kokoro ONNX model and voice embeddings
    pub fn load<P: AsRef<Path>>(model_path: P, voices_path: P) -> Result<Arc<Self>, String> {
        tracing::info!("Loading Kokoro ONNX model...");

        let session = Session::builder()
            .map_err(|e| format!("Failed to create ORT session builder: {}", e))?
            .with_intra_threads(4)
            .map_err(|e| format!("Failed to set thread count: {}", e))?
            .commit_from_file(model_path)
            .map_err(|e| format!("Failed to load ONNX model: {}", e))?;

        let voices = VoiceEmbeddings::load(voices_path)?;
        let vocab = build_vocab();

        tracing::info!("Kokoro model loaded successfully");
        Ok(Arc::new(Self {
            session: Mutex::new(session),
            voices,
            vocab,
        }))
    }

    /// Convert text phonemes to token IDs
    fn phonemes_to_tokens(&self, phonemes: &str) -> Vec<i64> {
        phonemes_to_tokens(&self.vocab, phonemes)
    }

    /// Synthesize audio from phonemes
    ///
    /// Returns PCM f32 samples at 24kHz sample rate
    pub fn synthesize(&self, phonemes: &str, voice: &str, speed: f32) -> Result<Vec<f32>, String> {
        // Get voice embedding
        let voice_embedding = self
            .voices
            .get(voice)
            .ok_or_else(|| format!("Unknown voice: {}", voice))?;

        // Convert phonemes to tokens
        let tokens = self.phonemes_to_tokens(phonemes);
        let seq_len = tokens.len();

        if seq_len < 3 {
            return Ok(Vec::new()); // Too short to synthesize
        }

        // Prepare input tensors
        // tokens: [batch=1, seq_len]
        let tokens_array = Array2::from_shape_vec((1, seq_len), tokens)
            .map_err(|e| format!("Failed to create tokens array: {}", e))?;

        // style: [batch=1, 256]
        let style_array = Array2::from_shape_vec((1, 256), voice_embedding.clone())
            .map_err(|e| format!("Failed to create style array: {}", e))?;

        // speed: scalar
        let speed_array = Array1::from_vec(vec![speed]);

        // Run inference
        let tokens_value = Value::from_array(tokens_array)
            .map_err(|e| format!("Failed to create tokens tensor: {}", e))?;
        let style_value = Value::from_array(style_array)
            .map_err(|e| format!("Failed to create style tensor: {}", e))?;
        let speed_value = Value::from_array(speed_array)
            .map_err(|e| format!("Failed to create speed tensor: {}", e))?;

        let mut session = self
            .session
            .lock()
            .map_err(|e| format!("Failed to lock session: {}", e))?;

        let outputs = session
            .run(ort::inputs!["tokens" => tokens_value, "style" => style_value, "speed" => speed_value])
            .map_err(|e| format!("ONNX inference failed: {}", e))?;

        // Extract audio output
        // Output shape: [batch=1, samples]
        let output = outputs.get("audio").ok_or("No audio output from model")?;

        let audio_array = output
            .try_extract_array::<f32>()
            .map_err(|e| format!("Failed to extract audio tensor: {}", e))?;

        let audio: Vec<f32> = audio_array.iter().copied().collect();

        Ok(audio)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vocab_build() {
        let vocab = build_vocab();
        // Should have the basic phonemes
        assert!(vocab.contains_key(&'a'));
        assert!(vocab.contains_key(&'ə')); // schwa
        assert!(vocab.contains_key(&'$')); // start/end token
    }

    #[test]
    fn test_phonemes_to_tokens() {
        let vocab = build_vocab();

        // Test basic phonemes
        let tokens = super::phonemes_to_tokens(&vocab, "a");
        assert_eq!(tokens.len(), 3); // start + 'a' + end
        assert_eq!(tokens[0], 0);
        assert_eq!(tokens[2], 0);

        // Test unknown char
        let tokens = super::phonemes_to_tokens(&vocab, "a@"); // @ is unknown
        assert_eq!(tokens.len(), 3); // start + 'a' + end
    }
}

/// Convert text phonemes to token IDs
fn phonemes_to_tokens(vocab: &HashMap<char, i64>, phonemes: &str) -> Vec<i64> {
    let mut tokens = Vec::with_capacity(phonemes.len() + 2);

    // Start token
    tokens.push(0); // $ = start of sequence

    for c in phonemes.chars() {
        if let Some(&id) = vocab.get(&c) {
            tokens.push(id);
        }
        // Skip unknown characters
    }

    // End token
    tokens.push(0); // $ = end of sequence

    tokens
}
