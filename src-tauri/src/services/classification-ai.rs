//! Local CLIP inference. Scores are text/image affinities, never calibrated probabilities.
use crate::{
    domain::media_classification::{AnalysisMode, Sensitivity},
    errors::{AppError, AppResult},
};
use image::{imageops::FilterType, DynamicImage, Rgb, RgbImage};
use ort::{
    session::{builder::GraphOptimizationLevel, Session},
    value::{Tensor, TensorElementType, ValueType},
};
use serde::Deserialize;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const MODEL_FILE: &str = "vision_model_uint8.onnx";
pub const RUNTIME_FILE: &str = "onnxruntime.dll";
pub const EMBEDDINGS_FILE: &str = "category-embeddings.json";
pub const MODEL_VERSION: &str =
    "clip-vit-base-patch32:vision-uint8:text-fp16:whole-image-multiview-v3";
const MODEL_NAME: &str = "clip-vit-base-patch32";
const EDGE: u32 = 224;
const DIMENSIONS: usize = 512;
const MEAN: [f32; 3] = [0.481_454_66, 0.457_827_5, 0.408_210_73];
const STD: [f32; 3] = [0.268_629_54, 0.261_302_6, 0.275_777_1];
const CATEGORIES: [&str; 8] = [
    "people",
    "animals",
    "screenshots",
    "memes",
    "documents",
    "landscapes",
    "objects",
    "other",
];
static ACTIVE_RUNTIME: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Clone, Debug)]
pub struct CategoryScore {
    pub category: String,
    pub score: f32,
}

#[derive(Clone, Debug)]
pub struct Classification {
    pub candidates: Vec<CategoryScore>,
    pub categories: Vec<String>,
    pub uncertain: bool,
    /// Normalized visual feature, kept locally for guarded correction matching.
    /// Empty for score-only results, such as the legacy video score aggregator.
    pub embedding: Vec<f32>,
}

#[derive(Deserialize)]
struct EmbeddingFile {
    model: String,
    categories: Vec<PromptEmbeddings>,
}

#[derive(Deserialize)]
struct PromptEmbeddings {
    id: String,
    embeddings: Vec<Vec<f32>>,
}

struct CategoryEmbedding {
    id: String,
    vector: Vec<f32>,
}

/// One CPU session is reused and serialized. Assets must come from the application bundle.
pub struct Classifier {
    session: Mutex<Session>,
    embeddings: Vec<CategoryEmbedding>,
}

impl Classifier {
    pub fn load(model_path: &Path, runtime_path: &Path, embeddings_path: &Path) -> AppResult<Self> {
        let model_path = checked_asset(model_path, 192 * 1024 * 1024)?;
        let runtime_path = checked_asset(runtime_path, 96 * 1024 * 1024)?;
        let embeddings_path = checked_asset(embeddings_path, 2 * 1024 * 1024)?;
        let mut bytes = Vec::new();
        fs::File::open(embeddings_path)
            .map_err(|_| unavailable())?
            .take(2 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| unavailable())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err(invalid());
        }
        let embeddings = parse_embeddings(&bytes)?;

        // Explicit init_from prevents ORT_DYLIB_PATH and loader search paths choosing the DLL.
        // No other ort API is called until the bundled runtime and privacy options are set.
        let mut active = ACTIVE_RUNTIME
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        if let Some(path) = active.as_ref() {
            if path != &runtime_path {
                return Err(invalid());
            }
        } else {
            let committed = ort::init_from(&runtime_path)
                .map_err(|_| unavailable())?
                .with_name("Metaflow local classification")
                .with_telemetry(false)
                .commit();
            if !committed {
                return Err(invalid());
            }
            *active = Some(runtime_path);
        }
        drop(active);

        let session = Session::builder()
            .map_err(|_| invalid())?
            .with_optimization_level(GraphOptimizationLevel::All)
            .map_err(|_| invalid())?
            .with_intra_threads(2)
            .map_err(|_| invalid())?
            .with_inter_threads(1)
            .map_err(|_| invalid())?
            .with_parallel_execution(false)
            .map_err(|_| invalid())?
            .with_intra_op_spinning(false)
            .map_err(|_| invalid())?
            .with_inter_op_spinning(false)
            .map_err(|_| invalid())?
            .commit_from_file(model_path)
            .map_err(|_| invalid())?;
        let inputs = session.inputs();
        if inputs.len() != 1
            || inputs[0].name() != "pixel_values"
            || !matches!(
                inputs[0].dtype(),
                ValueType::Tensor { ty: TensorElementType::Float32, shape, .. }
                    if shape.len() == 4 && matches!(shape[0], 1 | -1)
                        && matches!(shape[1], 3 | -1)
                        && matches!(shape[2], 224 | -1)
                        && matches!(shape[3], 224 | -1)
            )
            || !session.outputs().iter().any(|outlet| {
                outlet.name() == "image_embeds"
                    && matches!(
                        outlet.dtype(),
                        ValueType::Tensor { ty: TensorElementType::Float32, shape, .. }
                            if shape.len() == 2 && matches!(shape[0], 1 | -1)
                                && shape[1] == DIMENSIONS as i64
                    )
            })
        {
            return Err(invalid());
        }
        Ok(Self {
            session: Mutex::new(session),
            embeddings,
        })
    }

    /// The caller decodes with size limits and applies EXIF orientation before this call.
    #[cfg(test)]
    pub fn classify(&self, image: &DynamicImage) -> AppResult<Classification> {
        self.classify_with_mode(image, AnalysisMode::Fast)
    }

    /// Always sees the entire image. Thorough mode also inspects a bounded set of
    /// square regions, so text or subjects near the ends of tall/wide media survive.
    pub fn classify_with_mode(
        &self,
        image: &DynamicImage,
        mode: AnalysisMode,
    ) -> AppResult<Classification> {
        let views = image_views(image.width(), image.height(), mode)?;
        let mut vectors = Vec::with_capacity(views.len());
        let mut scored_views = Vec::with_capacity(views.len());
        for view in views {
            let vector = self.encode(preprocess_view(image, view)?)?;
            scored_views.push(self.category_scores(&vector));
            vectors.push(vector);
        }
        let candidates = merge_view_scores(&scored_views);
        let mut result = score_categories(&candidates);
        result.embedding = merge_view_embeddings(&vectors)?;
        Ok(result)
    }

    fn encode(&self, pixels: Vec<f32>) -> AppResult<Vec<f32>> {
        let input = Tensor::from_array(([1usize, 3, EDGE as usize, EDGE as usize], pixels))
            .map_err(|_| inference_failed())?;
        let mut session = self
            .session
            .lock()
            .map_err(|_| AppError::new("INTERNAL_ERROR"))?;
        let outputs = session
            .run(ort::inputs!["pixel_values" => input])
            .map_err(|_| inference_failed())?;
        let (shape, output) = outputs
            .get("image_embeds")
            .ok_or_else(inference_failed)?
            .try_extract_tensor::<f32>()
            .map_err(|_| inference_failed())?;
        if shape.len() != 2 || shape[0] != 1 || shape[1] != DIMENSIONS as i64 {
            return Err(inference_failed());
        }
        let mut vector = output.to_vec();
        normalize(&mut vector).map_err(|_| inference_failed())?;
        Ok(vector)
    }

    fn category_scores(&self, vector: &[f32]) -> Vec<CategoryScore> {
        self.embeddings
            .iter()
            .map(|category| CategoryScore {
                category: category.id.clone(),
                score: vector
                    .iter()
                    .zip(&category.vector)
                    .map(|(image, text)| image * text)
                    .sum::<f32>()
                    .clamp(0.0, 1.0),
            })
            .collect()
    }
}

fn unavailable() -> AppError {
    AppError::new("MEDIA_MODEL_UNAVAILABLE")
}
fn invalid() -> AppError {
    AppError::new("MEDIA_MODEL_INVALID")
}
fn inference_failed() -> AppError {
    AppError::new("MEDIA_INFERENCE_FAILED")
}

fn checked_asset(path: &Path, max_size: u64) -> AppResult<PathBuf> {
    if !path.is_absolute() {
        return Err(invalid());
    }
    let metadata = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(invalid());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(invalid());
        }
    }
    if metadata.len() == 0 || metadata.len() > max_size {
        return Err(invalid());
    }
    dunce::canonicalize(path).map_err(|_| unavailable())
}

fn parse_embeddings(bytes: &[u8]) -> AppResult<Vec<CategoryEmbedding>> {
    let file: EmbeddingFile = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    if file.model != MODEL_NAME || file.categories.len() != CATEGORIES.len() {
        return Err(invalid());
    }
    let mut seen = HashSet::new();
    file.categories
        .into_iter()
        .map(|category| {
            if !CATEGORIES.contains(&category.id.as_str())
                || !seen.insert(category.id.clone())
                || category.embeddings.is_empty()
                || category.embeddings.len() > 32
            {
                return Err(invalid());
            }
            let mut average = vec![0.0; DIMENSIONS];
            for mut prompt in category.embeddings {
                normalize(&mut prompt)?;
                for (value, term) in average.iter_mut().zip(prompt) {
                    *value += term;
                }
            }
            normalize(&mut average)?;
            Ok(CategoryEmbedding {
                id: category.id,
                vector: average,
            })
        })
        .collect()
}

fn normalize(vector: &mut [f32]) -> AppResult<()> {
    if vector.len() != DIMENSIONS || vector.iter().any(|value| !value.is_finite()) {
        return Err(invalid());
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if !norm.is_finite() || norm < 1e-8 {
        return Err(invalid());
    }
    for value in vector {
        *value /= norm;
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ImageView {
    Whole,
    Square { x: u32, y: u32, edge: u32 },
}

fn image_views(width: u32, height: u32, mode: AnalysisMode) -> AppResult<Vec<ImageView>> {
    if width == 0 || height == 0 {
        return Err(inference_failed());
    }
    let mut views = vec![ImageView::Whole];
    let shortest = width.min(height);
    let longest = width.max(height);
    // Near-square images already retain almost the same detail in the whole view.
    if mode == AnalysisMode::Fast || u64::from(longest) * 100 < u64::from(shortest) * 112 {
        return Ok(views);
    }
    views.push(ImageView::Square {
        x: (width - shortest) / 2,
        y: (height - shortest) / 2,
        edge: shortest,
    });
    if u64::from(longest) * 100 >= u64::from(shortest) * 180 {
        views.push(ImageView::Square {
            x: 0,
            y: 0,
            edge: shortest,
        });
        views.push(ImageView::Square {
            x: width - shortest,
            y: height - shortest,
            edge: shortest,
        });
    }
    Ok(views)
}

#[cfg(test)]
fn preprocess(image: &DynamicImage) -> AppResult<Vec<f32>> {
    preprocess_view(image, ImageView::Whole)
}

/// Letterbox at the CLIP mean, rather than discarding the image's edges. Every
/// resize output is at most 224 square, including one-pixel-wide panoramas.
fn preprocess_view(image: &DynamicImage, view: ImageView) -> AppResult<Vec<f32>> {
    let (width, height) = (image.width(), image.height());
    if width == 0 || height == 0 {
        return Err(inference_failed());
    }
    let rgb = image.to_rgb8();
    let resized: RgbImage = match view {
        ImageView::Whole => {
            let longest = width.max(height);
            let target_width =
                (u64::from(width) * u64::from(EDGE) / u64::from(longest)).max(1) as u32;
            let target_height =
                (u64::from(height) * u64::from(EDGE) / u64::from(longest)).max(1) as u32;
            let scaled =
                image::imageops::resize(&rgb, target_width, target_height, FilterType::CatmullRom);
            let fill = Rgb(MEAN.map(|value| (value * 255.0).round() as u8));
            let mut padded = RgbImage::from_pixel(EDGE, EDGE, fill);
            image::imageops::replace(
                &mut padded,
                &scaled,
                i64::from((EDGE - target_width) / 2),
                i64::from((EDGE - target_height) / 2),
            );
            padded
        }
        ImageView::Square { x, y, edge } => {
            if edge == 0 || x.saturating_add(edge) > width || y.saturating_add(edge) > height {
                return Err(inference_failed());
            }
            let crop = image::imageops::crop_imm(&rgb, x, y, edge, edge);
            image::imageops::resize(&*crop, EDGE, EDGE, FilterType::CatmullRom)
        }
    };
    let plane = (EDGE * EDGE) as usize;
    let mut tensor = vec![0.0f32; plane * 3];
    for (index, pixel) in resized.pixels().enumerate() {
        for channel in 0..3 {
            tensor[channel * plane + index] =
                (f32::from(pixel[channel]) / 255.0 - MEAN[channel]) / STD[channel];
        }
    }
    Ok(tensor)
}

fn merge_view_scores(views: &[Vec<CategoryScore>]) -> Vec<CategoryScore> {
    CATEGORIES
        .iter()
        .map(|category| {
            let values = views
                .iter()
                .map(|view| {
                    view.iter()
                        .find(|score| score.category == *category)
                        .map_or(0.0, |score| score.score)
                })
                .collect::<Vec<_>>();
            let whole = values.first().copied().unwrap_or(0.0);
            let score = if values.len() <= 1 {
                whole
            } else {
                let detail = &values[1..];
                let average = detail.iter().sum::<f32>() / detail.len() as f32;
                let strongest = detail.iter().copied().fold(0.0, f32::max);
                // Keep 80% whole-image evidence; local regions contribute 10% mean
                // and 10% strongest detail, rather than an isolated maximum.
                whole * 0.80 + average * 0.10 + strongest * 0.10
            };
            CategoryScore {
                category: (*category).to_owned(),
                score,
            }
        })
        .collect()
}

fn merge_view_embeddings(views: &[Vec<f32>]) -> AppResult<Vec<f32>> {
    if views
        .iter()
        .any(|view| view.len() != DIMENSIONS || view.iter().any(|value| !value.is_finite()))
    {
        return Err(inference_failed());
    }
    let mut result = views.first().cloned().ok_or_else(inference_failed)?;
    if views.len() > 1 {
        for (index, value) in result.iter_mut().enumerate() {
            let detail =
                views[1..].iter().map(|view| view[index]).sum::<f32>() / (views.len() - 1) as f32;
            *value = *value * 0.80 + detail * 0.20;
        }
    }
    normalize(&mut result).map_err(|_| inference_failed())?;
    Ok(result)
}

/// Conservative suggestions, also used when merging a video's sampled frames.
/// Similarity values are model affinities and cannot express a certainty percentage.
pub fn score_categories(scores: &[CategoryScore]) -> Classification {
    score_categories_with_sensitivity(scores, Sensitivity::Balanced)
}

/// Sensitivity changes suggestion cutoffs, never a deletion decision. These
/// thresholds operate on model affinities and are not probability estimates.
pub fn score_categories_with_sensitivity(
    scores: &[CategoryScore],
    sensitivity: Sensitivity,
) -> Classification {
    let (minimum, uncertain_minimum, uncertain_margin, secondary_margin) = match sensitivity {
        Sensitivity::Conservative => (0.255, 0.27, 0.024, 0.015),
        // Letterboxed fixtures retain weak but useful suggestions at 0.225;
        // the stricter uncertainty cutoff still flags them for human review.
        Sensitivity::Balanced => (0.225, 0.24, 0.018, 0.025),
        Sensitivity::Broad => (0.21, 0.23, 0.015, 0.04),
    };
    let mut candidates = CATEGORIES
        .iter()
        .map(|id| CategoryScore {
            category: (*id).to_owned(),
            score: scores
                .iter()
                .filter(|candidate| candidate.category == *id && candidate.score.is_finite())
                .map(|candidate| candidate.score.clamp(0.0, 1.0))
                .fold(0.0, f32::max),
        })
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        right
            .score
            .total_cmp(&left.score)
            .then_with(|| left.category.cmp(&right.category))
    });
    let best = &candidates[0];
    let margin = best.score - candidates[1].score;
    let uncertain =
        best.score < uncertain_minimum || margin < uncertain_margin || best.category == "other";
    let categories = if best.score < minimum || best.category == "other" {
        vec!["other".to_owned()]
    } else {
        candidates
            .iter()
            .filter(|candidate| {
                candidate.category != "other"
                    && candidate.score >= minimum
                    && candidate.score >= best.score - secondary_margin
            })
            .take(3)
            .map(|candidate| candidate.category.clone())
            .collect()
    };
    Classification {
        candidates,
        categories,
        uncertain,
        embedding: Vec::new(),
    }
}

#[cfg(test)]
#[path = "classification-ai-tests.rs"]
mod tests;
