//! Local Windows OCR supplies bounded hints; recognized text never enters the database.
use crate::errors::{AppError, AppResult};
use image::DynamicImage;

#[derive(Debug, Clone, Default)]
pub struct OcrAvailability {
    pub available: bool,
    pub languages: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct OcrSignals {
    pub line_count: usize,
    pub word_count: usize,
    pub text_coverage: f32,
    pub screen_terms: usize,
    pub meme_terms: usize,
    pub document_terms: usize,
}

fn terms(text: &str, vocabulary: &[&str]) -> usize {
    let words: std::collections::HashSet<_> = text
        .split(|character: char| !character.is_alphanumeric())
        .take(2_000)
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    vocabulary
        .iter()
        .filter(|word| words.contains(**word))
        .count()
}

fn signals(text: &str, line_count: usize, word_count: usize, text_coverage: f32) -> OcrSignals {
    OcrSignals {
        line_count: line_count.min(500),
        word_count: word_count.min(2_000),
        text_coverage: if text_coverage.is_finite() {
            text_coverage.clamp(0.0, 1.0)
        } else {
            0.0
        },
        screen_terms: terms(
            text,
            &[
                "whatsapp",
                "telegram",
                "instagram",
                "facebook",
                "settings",
                "configuración",
                "ajustes",
                "notificaciones",
                "notifications",
                "buscar",
                "search",
                "enviar",
                "send",
                "mensaje",
                "messages",
                "mensajes",
                "batería",
                "battery",
                "wifi",
                "contactos",
                "contacts",
                "inicio",
                "home",
                "publicar",
                "comentarios",
                "comments",
            ],
        ),
        meme_terms: terms(
            text,
            &[
                "pov",
                "meme",
                "memes",
                "jajaja",
                "jajajaja",
                "lol",
                "nadie",
                "cuando",
                "literal",
                "expectativa",
                "realidad",
                "expectation",
                "reality",
            ],
        ),
        document_terms: terms(
            text,
            &[
                "factura",
                "recibo",
                "invoice",
                "receipt",
                "subtotal",
                "importe",
                "impuesto",
                "tax",
                "documento",
                "document",
                "asunto",
                "subject",
                "firma",
                "signature",
                "contrato",
                "contract",
            ],
        ),
    }
}

/// Text alone cannot decide whether a file is a screenshot, meme or document.
/// Small affinity adjustments require multiple supporting hints and a visual candidate.
pub fn boost_text_scores(
    candidates: &mut [super::classification_ai::CategoryScore],
    signals: &OcrSignals,
    width: u32,
    height: u32,
) -> bool {
    if signals.word_count < 4 || signals.line_count < 2 || signals.text_coverage <= 0.001 {
        return false;
    }
    let portrait = width > 0 && f64::from(height) / f64::from(width) >= 1.5;
    let screen = signals.screen_terms >= 2
        || (signals.screen_terms >= 1 && portrait && signals.line_count >= 5);
    let document = (signals.document_terms >= 2 && signals.word_count >= 15)
        || (signals.line_count >= 9 && signals.word_count >= 45 && signals.text_coverage >= 0.08);
    let meme = signals.meme_terms >= 2 && signals.line_count <= 12 && signals.word_count <= 90;
    let mut influenced = false;
    for candidate in candidates {
        let boost = match candidate.category.as_str() {
            "screenshots" if screen => 0.04,
            "documents" if document => 0.035,
            "memes" if meme && !document && !screen => 0.03,
            _ => 0.0,
        };
        if boost > 0.0 && candidate.score.is_finite() && candidate.score >= 0.17 {
            candidate.score = (candidate.score + boost).clamp(0.0, 1.0);
            influenced = true;
        }
    }
    influenced
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::{mpsc, OnceLock};
    use std::time::{Duration, Instant};
    use windows::{
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::DataWriter,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };

    struct Apartment;
    impl Apartment {
        fn enter() -> AppResult<Self> {
            // Calls run on blocking worker threads, with no UI message pump dependency.
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
                .map_err(|_| AppError::new("OCR_UNAVAILABLE"))?;
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    fn engine() -> windows::core::Result<OcrEngine> {
        OcrEngine::TryCreateFromUserProfileLanguages().or_else(|_| {
            let languages = OcrEngine::AvailableRecognizerLanguages()?;
            OcrEngine::TryCreateFromLanguage(&languages.GetAt(0)?)
        })
    }
    fn failed(_: windows::core::Error) -> AppError {
        AppError::new("OCR_FAILED")
    }

    fn availability_initialized() -> OcrAvailability {
        let languages = OcrEngine::AvailableRecognizerLanguages()
            .and_then(|languages| {
                (0..languages.Size()?.min(32))
                    .map(|index| {
                        languages
                            .GetAt(index)?
                            .LanguageTag()
                            .map(|tag| tag.to_string())
                    })
                    .collect::<windows::core::Result<Vec<_>>>()
            })
            .unwrap_or_default();
        OcrAvailability {
            available: engine().is_ok(),
            languages,
        }
    }

    fn read_initialized(image: &DynamicImage) -> AppResult<OcrSignals> {
        let engine = engine().map_err(|_| AppError::new("OCR_UNAVAILABLE"))?;
        let edge = OcrEngine::MaxImageDimension().map_err(failed)?.min(1_600);
        if edge == 0 || image.width() == 0 || image.height() == 0 {
            return Err(AppError::new("OCR_FAILED"));
        }
        let mut pixels = image.thumbnail(edge, edge).to_rgba8();
        let (width, height) = pixels.dimensions();
        // OCR's native sample uses BGRA. Flatten transparency onto white so text
        // in transparent screenshots has a visible background.
        for pixel in pixels.pixels_mut() {
            let alpha = u32::from(pixel[3]);
            for channel in &mut pixel.0[..3] {
                *channel = ((u32::from(*channel) * alpha + 255 * (255 - alpha)) / 255) as u8;
            }
            pixel.0.swap(0, 2);
            pixel[3] = 255;
        }
        let writer = DataWriter::new().map_err(failed)?;
        writer.WriteBytes(pixels.as_raw()).map_err(failed)?;
        let buffer = writer.DetachBuffer().map_err(failed)?;
        let bitmap = SoftwareBitmap::CreateCopyFromBuffer(
            &buffer,
            BitmapPixelFormat::Bgra8,
            width as i32,
            height as i32,
        )
        .map_err(failed)?;
        let recognition = engine.RecognizeAsync(&bitmap).map_err(failed)?;
        let deadline = Instant::now() + Duration::from_secs(8);
        // AsyncStatus::Started is 0 in the WinRT ABI. GetResults reports cancellation/errors.
        while recognition.Status().map_err(failed)?.0 == 0 {
            if Instant::now() >= deadline {
                let _ = recognition.Cancel();
                return Err(AppError::new("OCR_TIMEOUT"));
            }
            std::thread::sleep(Duration::from_millis(15));
        }
        let result = recognition.GetResults().map_err(failed)?;
        let lines = result.Lines().map_err(failed)?;
        let count = lines.Size().map_err(failed)?.min(500);
        let mut text = String::new();
        let mut word_count = 0;
        let mut area = 0.0f32;
        for index in 0..count {
            let line = lines.GetAt(index).map_err(failed)?;
            let words = line.Words().map_err(failed)?;
            for index in 0..words.Size().map_err(failed)?.min(2_000 - word_count) {
                let word = words.GetAt(index).map_err(failed)?;
                let value = word.Text().map_err(failed)?.to_string();
                // Bound recognized text, including hostile dense inputs.
                if text.len().saturating_add(value.len()) <= 64 * 1_024 {
                    text.push_str(&value);
                    text.push(' ');
                }
                let rect = word.BoundingRect().map_err(failed)?;
                if rect.Width.is_finite() && rect.Height.is_finite() {
                    area += rect.Width.max(0.0) * rect.Height.max(0.0);
                }
                word_count += 1;
            }
        }
        let _ = bitmap.Close();
        let _ = writer.Close();
        Ok(signals(
            &text,
            count as usize,
            word_count as usize,
            area / (width as f32 * height as f32),
        ))
    }

    enum Request {
        Read(DynamicImage, mpsc::Sender<AppResult<OcrSignals>>),
    }

    struct Worker {
        sender: mpsc::SyncSender<Request>,
        availability: OcrAvailability,
    }

    fn worker() -> Option<&'static Worker> {
        static WORKER: OnceLock<Option<Worker>> = OnceLock::new();
        WORKER
            .get_or_init(|| {
                let (sender, receiver) = mpsc::sync_channel(8);
                let (initialized, ready) = mpsc::channel();
                std::thread::Builder::new()
                    .name("metaflow-local-ocr".into())
                    .spawn(move || {
                        // windows-rs caches WinRT activation factories. Keep their
                        // MTA alive for the process lifetime, including repeated
                        // settings queries and scans on different blocking threads.
                        let apartment = Apartment::enter();
                        let availability = if apartment.is_ok() {
                            availability_initialized()
                        } else {
                            OcrAvailability::default()
                        };
                        let _ = initialized.send(availability);
                        for request in receiver {
                            match request {
                                Request::Read(image, reply) => {
                                    let result = if apartment.is_ok() {
                                        read_initialized(&image)
                                    } else {
                                        Err(AppError::new("OCR_UNAVAILABLE"))
                                    };
                                    let _ = reply.send(result);
                                }
                            }
                        }
                    })
                    .ok()?;
                let availability = ready.recv_timeout(Duration::from_secs(10)).ok()?;
                Some(Worker {
                    sender,
                    availability,
                })
            })
            .as_ref()
    }

    pub fn availability() -> OcrAvailability {
        // Stable throughout this process, even while an OCR request is running.
        // Restart after installing language packs to refresh the cache profile.
        worker()
            .map(|worker| worker.availability.clone())
            .unwrap_or_default()
    }

    pub fn read(image: &DynamicImage) -> AppResult<OcrSignals> {
        let worker = worker().ok_or_else(|| AppError::new("OCR_UNAVAILABLE"))?;
        let (sender, receiver) = mpsc::channel();
        worker
            .sender
            .try_send(Request::Read(image.thumbnail(1_600, 1_600), sender))
            .map_err(|_| AppError::new("OCR_UNAVAILABLE"))?;
        receiver
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| AppError::new("OCR_TIMEOUT"))?
    }
}

pub fn availability() -> OcrAvailability {
    #[cfg(windows)]
    {
        platform::availability()
    }
    #[cfg(not(windows))]
    {
        OcrAvailability::default()
    }
}
pub fn read(image: &DynamicImage) -> AppResult<OcrSignals> {
    #[cfg(windows)]
    {
        platform::read(image)
    }
    #[cfg(not(windows))]
    {
        let _ = image;
        Err(AppError::new("OCR_UNAVAILABLE"))
    }
}

#[cfg(test)]
mod tests {
    use super::super::classification_ai::CategoryScore;
    use super::*;
    #[test]
    fn text_hints_do_not_turn_every_picture_with_text_into_a_screenshot() {
        let mut scores = vec![
            CategoryScore {
                category: "screenshots".into(),
                score: 0.22,
            },
            CategoryScore {
                category: "people".into(),
                score: 0.35,
            },
        ];
        let plain = signals("Summer holiday by the beach with my family", 2, 9, 0.1);
        assert!(!boost_text_scores(&mut scores, &plain, 640, 480));
        assert_eq!(scores[0].score, 0.22);
        let screen = signals("WhatsApp buscar contactos enviar mensajes", 6, 6, 0.12);
        assert!(boost_text_scores(&mut scores, &screen, 600, 1_200));
        assert!(scores[0].score > 0.22);
        assert_eq!(scores[1].score, 0.35);
    }
    #[test]
    fn cues_are_bounded_and_do_not_override_absent_visual_evidence() {
        let hints = signals("pov cuando nadie factura invoice subtotal", 5, 20, f32::NAN);
        assert_eq!(hints.text_coverage, 0.0);
        let mut weak = vec![CategoryScore {
            category: "documents".into(),
            score: 0.1,
        }];
        assert!(!boost_text_scores(
            &mut weak,
            &OcrSignals {
                text_coverage: 0.2,
                ..hints
            },
            640,
            480
        ));
        assert_eq!(weak[0].score, 0.1);
    }
    #[test]
    fn local_ocr_reports_supported_languages_and_reads_generated_fixture_when_available() {
        let availability = availability();
        eprintln!("OCR availability: {availability:?}");
        for _ in 0..20 {
            let repeated = super::availability();
            assert_eq!(repeated.available, availability.available);
            assert_eq!(repeated.languages, availability.languages);
        }
        if !availability.available {
            return;
        }
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join(".verification/classification-ui-v04/Fotos de prueba/Captura.png");
        if path.is_file() {
            let result = read(&image::open(path).unwrap()).unwrap();
            eprintln!("OCR fixture signals: {result:?}");
            assert!(result.word_count >= 4);
            assert!(result.text_coverage > 0.001);
        }
    }
}
