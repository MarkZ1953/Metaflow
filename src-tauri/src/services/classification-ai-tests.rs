use super::*;
use image::{Rgb, RgbImage};
use serde_json::json;

fn valid_embeddings() -> serde_json::Value {
    let mut vector = vec![0.0f32; DIMENSIONS];
    vector[0] = 1.0;
    json!({"model": MODEL_NAME, "categories": CATEGORIES.map(|id|
        json!({"id":id,"embeddings":[vector.clone()]}))})
}

#[test]
fn clip_preprocess_normalizes_rgb_channels_in_chw_order() {
    let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(224, 224, Rgb([255, 128, 0])));
    let values = preprocess(&image).unwrap();
    let plane = (EDGE * EDGE) as usize;
    assert_eq!(values.len(), plane * 3);
    assert!((values[0] - (1.0 - MEAN[0]) / STD[0]).abs() < 1e-6);
    assert!((values[plane] - (128.0 / 255.0 - MEAN[1]) / STD[1]).abs() < 1e-6);
    assert!((values[plane * 2] - (0.0 - MEAN[2]) / STD[2]).abs() < 1e-6);
    assert!(values.iter().all(|value| value.is_finite()));
}

#[test]
fn whole_image_retains_both_edges_and_bounds_extreme_panorama_allocations() {
    let mut pixels = RgbImage::from_pixel(672, 224, Rgb([255, 0, 0]));
    for y in 0..224 {
        for x in 224..448 {
            pixels.put_pixel(x, y, Rgb([0, 255, 0]));
        }
    }
    let values = preprocess(&DynamicImage::ImageRgb8(pixels)).unwrap();
    let plane = (EDGE * EDGE) as usize;
    let index = |x: usize| 112 * EDGE as usize + x;
    for x in [8, 216] {
        assert!((values[index(x)] - (1.0 - MEAN[0]) / STD[0]).abs() < 1e-6);
        assert!((values[plane + index(x)] - (0.0 - MEAN[1]) / STD[1]).abs() < 1e-6);
    }
    assert!((values[index(112)] - (0.0 - MEAN[0]) / STD[0]).abs() < 1e-6);
    assert!((values[plane + index(112)] - (1.0 - MEAN[1]) / STD[1]).abs() < 1e-6);
    // Padding is close to zero after CLIP normalization, rather than black bars.
    assert!(values[0].abs() < 0.01);
    let panorama = DynamicImage::ImageRgb8(RgbImage::from_pixel(16_384, 1, Rgb([3, 4, 5])));
    assert_eq!(
        preprocess(&panorama).unwrap().len(),
        (EDGE * EDGE * 3) as usize
    );
    assert_eq!(
        preprocess(&DynamicImage::ImageRgb8(RgbImage::new(0, 0)))
            .unwrap_err()
            .code,
        "MEDIA_INFERENCE_FAILED"
    );
}

#[test]
fn thorough_views_cover_ends_of_wide_and_tall_images_without_unbounded_crops() {
    assert_eq!(
        image_views(600, 600, AnalysisMode::Thorough).unwrap(),
        [ImageView::Whole]
    );
    assert_eq!(
        image_views(600, 400, AnalysisMode::Fast).unwrap(),
        [ImageView::Whole]
    );
    assert_eq!(
        image_views(600, 400, AnalysisMode::Thorough).unwrap(),
        [
            ImageView::Whole,
            ImageView::Square {
                x: 100,
                y: 0,
                edge: 400
            },
        ]
    );
    assert_eq!(
        image_views(300, 1200, AnalysisMode::Thorough).unwrap(),
        [
            ImageView::Whole,
            ImageView::Square {
                x: 0,
                y: 450,
                edge: 300
            },
            ImageView::Square {
                x: 0,
                y: 0,
                edge: 300
            },
            ImageView::Square {
                x: 0,
                y: 900,
                edge: 300
            },
        ]
    );
    let panorama = DynamicImage::ImageRgb8(RgbImage::from_pixel(16_384, 1, Rgb([3, 4, 5])));
    let views = image_views(panorama.width(), panorama.height(), AnalysisMode::Thorough).unwrap();
    assert_eq!(views.len(), 4);
    for view in views {
        assert_eq!(
            preprocess_view(&panorama, view).unwrap().len(),
            (EDGE * EDGE * 3) as usize
        );
    }
    assert!(image_views(0, 100, AnalysisMode::Thorough).is_err());
    assert!(preprocess_view(
        &panorama,
        ImageView::Square {
            x: 16_384,
            y: 0,
            edge: 1
        }
    )
    .is_err());
}

#[test]
fn isolated_local_evidence_cannot_replace_the_whole_image_and_embeddings_remain_normalized() {
    let score = |value| {
        vec![CategoryScore {
            category: "people".into(),
            score: value,
        }]
    };
    let merged = merge_view_scores(&[score(0.1), score(0.9), score(0.1), score(0.1)]);
    let people = merged
        .iter()
        .find(|value| value.category == "people")
        .unwrap();
    assert!(people.score < 0.28);
    assert!(people.score > 0.1);
    let mut whole = vec![0.0; DIMENSIONS];
    let mut detail = vec![0.0; DIMENSIONS];
    whole[0] = 1.0;
    detail[1] = 1.0;
    let merged = merge_view_embeddings(&[whole, detail]).unwrap();
    assert!((merged.iter().map(|value| value * value).sum::<f32>() - 1.0).abs() < 1e-6);
    assert!(merged[0] > merged[1]);
    assert!(merge_view_embeddings(&[]).is_err());
    assert!(merge_view_embeddings(&[vec![0.0; DIMENSIONS]]).is_err());
    assert!(merge_view_embeddings(&[vec![1.0; DIMENSIONS], vec![1.0; 10]]).is_err());
    assert!(merge_view_embeddings(&[vec![f32::NAN; DIMENSIONS]]).is_err());
}

#[test]
fn embeddings_must_match_the_model_dimensions_and_unique_categories() {
    let valid = valid_embeddings();
    let parsed = parse_embeddings(&serde_json::to_vec(&valid).unwrap()).unwrap();
    assert_eq!(parsed.len(), 8);
    assert_eq!(parsed[0].vector[0], 1.0);
    let mut ensemble = valid.clone();
    let mut first = vec![0.0; DIMENSIONS];
    let mut second = vec![0.0; DIMENSIONS];
    first[0] = 3.0;
    second[1] = 7.0;
    ensemble["categories"][0]["embeddings"] = json!([first, second]);
    let ensemble = parse_embeddings(&serde_json::to_vec(&ensemble).unwrap()).unwrap();
    // Individual prompt magnitudes must not bias the averaged category prototype.
    assert!((ensemble[0].vector[0] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    assert!((ensemble[0].vector[1] - std::f32::consts::FRAC_1_SQRT_2).abs() < 1e-6);
    let mut duplicate = valid.clone();
    duplicate["categories"][1]["id"] = json!("people");
    assert_eq!(
        parse_embeddings(&serde_json::to_vec(&duplicate).unwrap())
            .err()
            .unwrap()
            .code,
        "MEDIA_MODEL_INVALID"
    );
    let mut wrong = valid.clone();
    wrong["categories"][0]["embeddings"] = json!([[0.0, 1.0]]);
    assert!(parse_embeddings(&serde_json::to_vec(&wrong).unwrap()).is_err());
    wrong = valid;
    wrong["model"] = json!("another-model");
    assert!(parse_embeddings(&serde_json::to_vec(&wrong).unwrap()).is_err());
    let mut nan = vec![0.0; DIMENSIONS];
    nan[0] = f32::NAN;
    assert!(normalize(&mut nan).is_err());
    assert!(normalize(&mut vec![0.0; DIMENSIONS]).is_err());
}

#[test]
fn weak_or_close_predictions_remain_uncertain_and_allow_multiple_categories() {
    let score = |id: &str, value| CategoryScore {
        category: id.into(),
        score: value,
    };
    let weak = score_categories(&[score("animals", 0.19)]);
    assert_eq!(weak.categories, ["other"]);
    assert!(weak.uncertain);
    let mixed = score_categories(&[score("people", 0.32), score("memes", 0.315)]);
    assert_eq!(mixed.categories, ["people", "memes"]);
    assert!(mixed.uncertain);
    let strong = score_categories(&[score("animals", 0.33), score("objects", 0.26)]);
    assert_eq!(strong.categories, ["animals"]);
    assert!(!strong.uncertain);
    let invalid_scores = score_categories(&[score("people", f32::NAN), score("unknown", 1.0)]);
    assert!(invalid_scores.uncertain);
    assert!(invalid_scores
        .candidates
        .iter()
        .all(|candidate| candidate.score.is_finite()));
}

#[test]
fn sensitivity_changes_suggestions_but_preserves_ambiguity_and_allows_overlapping_categories() {
    let scores = [
        CategoryScore {
            category: "screenshots".into(),
            score: 0.24,
        },
        CategoryScore {
            category: "documents".into(),
            score: 0.219,
        },
    ];
    let strict = score_categories_with_sensitivity(&scores, Sensitivity::Conservative);
    assert_eq!(strict.categories, ["other"]);
    assert!(strict.uncertain);
    let balanced = score_categories_with_sensitivity(&scores, Sensitivity::Balanced);
    assert_eq!(balanced.categories, ["screenshots"]);
    let broad = score_categories_with_sensitivity(&scores, Sensitivity::Broad);
    assert_eq!(broad.categories, ["screenshots", "documents"]);
    let ambiguous = [
        CategoryScore {
            category: "screenshots".into(),
            score: 0.3,
        },
        CategoryScore {
            category: "documents".into(),
            score: 0.299,
        },
    ];
    for sensitivity in [
        Sensitivity::Conservative,
        Sensitivity::Balanced,
        Sensitivity::Broad,
    ] {
        assert!(score_categories_with_sensitivity(&ambiguous, sensitivity).uncertain);
    }
}

#[test]
fn assets_are_explicit_and_missing_assets_do_not_fall_back_to_loader_search_paths() {
    assert_eq!(
        checked_asset(Path::new("onnxruntime.dll"), 10)
            .unwrap_err()
            .code,
        "MEDIA_MODEL_INVALID"
    );
    let temporary = tempfile::tempdir().unwrap();
    assert_eq!(
        checked_asset(&temporary.path().join("missing.dll"), 10)
            .unwrap_err()
            .code,
        "MEDIA_MODEL_UNAVAILABLE"
    );
    let oversized = temporary.path().join("oversized.bin");
    fs::write(&oversized, [1u8; 11]).unwrap();
    assert_eq!(
        checked_asset(&oversized, 10).unwrap_err().code,
        "MEDIA_MODEL_INVALID"
    );
}

/// Bundled-artifact smoke test; does not require or transmit user photos.
#[test]
#[ignore = "requires the downloaded bundled CLIP and ONNX Runtime artifacts"]
fn bundled_clip_runs_cpu_inference_offline() {
    let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/classification");
    let classifier = Classifier::load(
        &directory.join(MODEL_FILE),
        &directory.join(RUNTIME_FILE),
        &directory.join(EMBEDDINGS_FILE),
    )
    .unwrap();
    let image = DynamicImage::ImageRgb8(RgbImage::from_pixel(640, 480, Rgb([83, 137, 201])));
    let first = classifier.classify(&image).unwrap();
    let second = classifier.classify(&image).unwrap();
    assert_eq!(first.candidates.len(), 8);
    assert!(!first.categories.is_empty());
    assert_eq!(first.embedding.len(), DIMENSIONS);
    assert!(
        (first
            .embedding
            .iter()
            .map(|value| value * value)
            .sum::<f32>()
            - 1.0)
            .abs()
            < 1e-5
    );
    for (left, right) in first.candidates.iter().zip(second.candidates) {
        assert_eq!(left.category, right.category);
        assert!((left.score - right.score).abs() < 1e-5);
        assert!((0.0..=1.0).contains(&left.score));
    }
    // The desktop fixtures contain public-domain photographs and generated graphics.
    let fixture_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".verification/classification-ui-v04/Fotos de prueba");
    let mut fixture_failures = Vec::new();
    for (name, expected) in [
        ("Persona.jpg", "people"),
        ("Persona copia.jpg", "people"),
        ("Animal.png", "animals"),
        ("Captura.png", "screenshots"),
        ("Documento.jpg", "documents"),
        ("Meme.png", "memes"),
    ] {
        let path = fixture_directory.join(name);
        if path.is_file() {
            let image = image::open(path).unwrap();
            for mode in [AnalysisMode::Fast, AnalysisMode::Thorough] {
                let classified = classifier.classify_with_mode(&image, mode).unwrap();
                eprintln!(
                    "{name} {mode:?} scores: {:?}; labels: {:?}",
                    classified.candidates, classified.categories
                );
                if !classified
                    .categories
                    .iter()
                    .any(|category| category == expected)
                {
                    fixture_failures.push(format!("Missing {expected} for {name}/{mode:?}"));
                }
            }
        }
    }
    let edge_directory = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join(".verification/detection-v3-fixtures");
    for (name, expected) in [
        ("Borde Persona.jpg", "people"),
        ("Borde Animal.png", "animals"),
    ] {
        let path = edge_directory.join(name);
        if path.is_file() {
            let image = image::open(path).unwrap();
            for mode in [AnalysisMode::Fast, AnalysisMode::Thorough] {
                let classified = classifier.classify_with_mode(&image, mode).unwrap();
                eprintln!("{name} {mode:?} edge scores: {:?}", classified.candidates);
                if classified.candidates[0].category != expected {
                    fixture_failures
                        .push(format!("Missing leading border subject in {name}/{mode:?}"));
                }
                assert!(
                    classified.uncertain,
                    "Sparse border collage should still require review"
                );
            }
        }
    }
    assert!(
        fixture_failures.is_empty(),
        "{}",
        fixture_failures.join("; ")
    );
}
