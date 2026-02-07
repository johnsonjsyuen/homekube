//! ONNX-based Kokoro TTS inference module.
//!
//! This module loads the Kokoro ONNX model and voice embeddings,
//! then provides synthesis functionality returning PCM f32 audio at 24kHz.

use byteorder::{LittleEndian, ReadBytesExt};
use ndarray::{Array1, Array2};
use ort::session::Session;
use ort::value::Value;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Cursor, Read};
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

/// Maximum number of style token positions in voice embeddings
const MAX_STYLE_TOKENS: usize = 510;
/// Embedding dimension per style vector
const EMBEDDING_DIM: usize = 256;

/// Voice embedding data structure
/// Loaded from voices-v1.0.bin (NPZ format — ZIP archive of NumPy arrays)
/// Each voice has shape (510, 1, 256) — 510 style vectors indexed by token count
struct VoiceEmbeddings {
    /// Map from voice name to style matrix
    /// Outer Vec has 510 entries (one per token position), each is 256 floats
    embeddings: HashMap<String, Vec<Vec<f32>>>,
}

impl VoiceEmbeddings {
    fn load<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let file =
            File::open(path).map_err(|e| format!("Failed to open voices file: {}", e))?;

        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("Failed to read voices ZIP: {}", e))?;

        let mut embeddings = HashMap::new();

        for i in 0..archive.len() {
            let mut entry = archive
                .by_index(i)
                .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;

            let name = entry.name().to_string();
            // Strip .npy extension to get voice name
            let voice_name = name.strip_suffix(".npy").unwrap_or(&name).to_string();

            // Read the full NPY file into memory
            let mut npy_data = Vec::new();
            entry
                .read_to_end(&mut npy_data)
                .map_err(|e| format!("Failed to read NPY data for {}: {}", voice_name, e))?;

            // Parse NPY format
            let floats = parse_npy_f32(&npy_data)
                .map_err(|e| format!("Failed to parse NPY for {}: {}", voice_name, e))?;

            // Reshape from flat (510 * 1 * 256) into Vec<Vec<f32>> of 510 x 256
            let num_positions = floats.len() / EMBEDDING_DIM;
            let mut style_matrix = Vec::with_capacity(num_positions);
            for pos in 0..num_positions {
                let start = pos * EMBEDDING_DIM;
                let end = start + EMBEDDING_DIM;
                style_matrix.push(floats[start..end].to_vec());
            }

            embeddings.insert(voice_name, style_matrix);
        }

        tracing::info!("Loaded {} voice embeddings from NPZ", embeddings.len());
        Ok(Self { embeddings })
    }

    /// Get the style embedding for a voice, indexed by token count.
    /// The style vector is selected based on the number of tokens in the input,
    /// matching the Python behavior: `voice[len(tokens)]`
    fn get(&self, voice: &str, token_len: usize) -> Option<Vec<f32>> {
        let matrix = self.embeddings.get(voice)?;
        let idx = token_len.min(matrix.len() - 1);
        Some(matrix[idx].clone())
    }
}

/// Parse a NumPy .npy file and extract f32 data.
/// NPY format: magic (\x93NUMPY) + version (2 bytes) + header_len + header string + raw data
fn parse_npy_f32(data: &[u8]) -> Result<Vec<f32>, String> {
    if data.len() < 10 {
        return Err("NPY file too short".to_string());
    }

    // Verify magic number: \x93NUMPY
    if &data[0..6] != b"\x93NUMPY" {
        return Err("Invalid NPY magic number".to_string());
    }

    let major = data[6];
    let _minor = data[7];

    // Header length depends on version
    let (header_len, header_offset) = if major == 1 {
        // Version 1.0: 2-byte header length (little-endian)
        let hl = u16::from_le_bytes([data[8], data[9]]) as usize;
        (hl, 10)
    } else {
        // Version 2.0+: 4-byte header length (little-endian)
        if data.len() < 12 {
            return Err("NPY v2 file too short for header".to_string());
        }
        let hl = u32::from_le_bytes([data[8], data[9], data[10], data[11]]) as usize;
        (hl, 12)
    };

    let data_start = header_offset + header_len;
    if data_start > data.len() {
        return Err(format!(
            "NPY header extends beyond file: header_offset={}, header_len={}, file_len={}",
            header_offset,
            header_len,
            data.len()
        ));
    }

    // Read raw f32 little-endian data
    let raw = &data[data_start..];
    let num_floats = raw.len() / 4;
    let mut cursor = Cursor::new(raw);
    let mut floats = Vec::with_capacity(num_floats);
    for _ in 0..num_floats {
        let f = cursor
            .read_f32::<LittleEndian>()
            .map_err(|e| format!("Failed to read f32: {}", e))?;
        floats.push(f);
    }

    Ok(floats)
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
        // Convert phonemes to tokens first (needed for style lookup)
        let tokens = self.phonemes_to_tokens(phonemes);
        let seq_len = tokens.len();

        if seq_len < 3 {
            return Ok(Vec::new()); // Too short to synthesize
        }

        if seq_len > MAX_STYLE_TOKENS {
            return Err(format!(
                "Token sequence too long ({} > {}). Split into shorter sentences.",
                seq_len, MAX_STYLE_TOKENS
            ));
        }

        // Get voice embedding indexed by token count
        let voice_embedding = self
            .voices
            .get(voice, seq_len)
            .ok_or_else(|| format!("Unknown voice: {}", voice))?;

        // Prepare input tensors
        // tokens: [batch=1, seq_len]
        let tokens_array = Array2::from_shape_vec((1, seq_len), tokens)
            .map_err(|e| format!("Failed to create tokens array: {}", e))?;

        // style: [batch=1, 256]
        let style_array = Array2::from_shape_vec((1, EMBEDDING_DIM), voice_embedding)
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

    /// Integration test: downloads voices-v1.0.bin and verifies NPZ loading.
    /// If kokoro-v1.0.onnx is also available, runs a full synthesis.
    ///
    /// Run with: cargo test test_voice_loading_and_synthesis -- --ignored --nocapture
    #[test]
    #[ignore] // Ignored by default since it downloads files
    fn test_voice_loading_and_synthesis() {
        let voices_path = std::path::PathBuf::from("/tmp/test-voices-v1.0.bin");
        let model_path = std::path::PathBuf::from("/tmp/test-kokoro-v1.0.onnx");

        // Download voices if not present
        if !voices_path.exists() {
            println!("Downloading voices-v1.0.bin...");
            let resp = reqwest::blocking::get(
                "https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/voices-v1.0.bin",
            )
            .expect("Failed to download voices");
            let bytes = resp.bytes().expect("Failed to read response");
            std::fs::write(&voices_path, &bytes).expect("Failed to write voices file");
            println!("Downloaded {} bytes", bytes.len());
        }

        // Test 1: Voice embeddings load correctly from NPZ
        println!("Loading voice embeddings...");
        let voices = VoiceEmbeddings::load(&voices_path).expect("Failed to load voices");
        println!("Loaded {} voices", voices.embeddings.len());

        assert_eq!(voices.embeddings.len(), 50, "Expected 50 voices");

        // Test 2: All expected voices are present
        let expected_voices = ["af_heart", "af_bella", "af_nicole", "af_sky",
                               "bm_daniel", "bm_george", "bm_lewis"];
        for name in &expected_voices {
            assert!(
                voices.embeddings.contains_key(*name),
                "Missing voice: {}",
                name
            );
        }

        // Test 3: Each voice has correct dimensions (510 positions x 256 floats)
        for (name, matrix) in &voices.embeddings {
            assert_eq!(
                matrix.len(),
                MAX_STYLE_TOKENS,
                "Voice {} has {} positions, expected {}",
                name,
                matrix.len(),
                MAX_STYLE_TOKENS
            );
            for (i, vec) in matrix.iter().enumerate() {
                assert_eq!(
                    vec.len(),
                    EMBEDDING_DIM,
                    "Voice {} position {} has {} dims, expected {}",
                    name,
                    i,
                    vec.len(),
                    EMBEDDING_DIM
                );
            }
        }

        // Test 4: Style lookup by token length works
        let style = voices.get("af_heart", 10).expect("Failed to get af_heart style");
        assert_eq!(style.len(), EMBEDDING_DIM);

        // Verify different token lengths give different style vectors
        let style_5 = voices.get("af_heart", 5).unwrap();
        let style_50 = voices.get("af_heart", 50).unwrap();
        assert_ne!(style_5, style_50, "Different token lengths should give different styles");

        // Test 5: Clamping works for out-of-range token lengths
        let style_max = voices.get("af_heart", 999).unwrap();
        let style_509 = voices.get("af_heart", 509).unwrap();
        assert_eq!(style_max, style_509, "Out-of-range should clamp to last position");

        println!("All voice loading tests passed!");

        // Test 6: Full synthesis (only if ONNX model is available)
        if !model_path.exists() {
            println!("Skipping synthesis test (kokoro-v1.0.onnx not found at {:?})", model_path);
            println!("To run full test, download: wget -q -O /tmp/test-kokoro-v1.0.onnx https://github.com/nazdridoy/kokoro-tts/releases/download/v1.0.0/kokoro-v1.0.onnx");
            return;
        }

        println!("Loading ONNX model...");
        let model = KokoroModel::load(&model_path, &voices_path)
            .expect("Failed to load Kokoro model");

        // Simple phoneme test (IPA for "hello")
        let phonemes = "hɛˈloʊ";
        println!("Synthesizing phonemes: {}", phonemes);
        let audio = model
            .synthesize(phonemes, "af_heart", 1.0)
            .expect("Synthesis failed");

        assert!(!audio.is_empty(), "Synthesis produced no audio");
        println!(
            "Synthesis produced {} samples ({:.2}s at {}Hz)",
            audio.len(),
            audio.len() as f64 / SAMPLE_RATE as f64,
            SAMPLE_RATE
        );

        // Verify audio is valid (not all zeros, in reasonable range)
        let max_val = audio.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
        assert!(max_val > 0.001, "Audio appears to be silence (max={:.6})", max_val);
        assert!(max_val < 10.0, "Audio values out of range (max={:.6})", max_val);

        println!("Full synthesis test passed!");
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
